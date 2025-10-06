import express, { Request, Response } from 'express';
import { createClient, RedisClientType } from 'redis';
import axios from 'axios';
import cron from 'node-cron';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const port: number = parseInt(process.env.PORT || '4000', 10);
const client: RedisClientType = createClient({ url: process.env.REDIS_URL });

// Interfaces for API responses
interface CoinrankingPriceResponse {
  status: string;
  data: {
    price: string;
    timestamp: number;
  };
}

interface ReferenceCurrenciesResponse {
  status: string;
  data: {
    currencies: Array<{
      uuid: string;
      symbol: string;
    }>;
  };
}

// Currency and Coin UUIDs from .env
const currencyUuids: Record<string, string> = {
  USD: 'yhjMzLPhuIDl',
  COP: process.env.CR_COP_UUID || 'Y7N-jnLhqYiW',
  NGN: process.env.CR_NGN_UUID || 'znnRJjGM4nVb',
  VES: 'not_present', // VES not available in Coinranking, using hardcoded value
  EUR: '5k-_VTxqtCEI',
};

const coinUuids: Record<string, string> = {
  USDC: process.env.CR_USDC_UUID || 'aKzUVe4Hh_CON',
  USD: 'yhjMzLPhuIDl', // For USD-to-fiat conversions
};

// Hardcoded VES/USD rate from .env
const hardcodedVesUsd = parseFloat(process.env.HARDCODED_VES_USD || '106');

// Connect to Redis
async function connectRedis(): Promise<void> {
  try {
    await client.connect();
    console.log('Connected to Redis');
  } catch (error) {
    console.error('Redis connection failed:', error);
    process.exit(1);
  }
}

// Fetch and cache reference currencies once
async function fetchReferenceCurrencies(): Promise<void> {
  try {
    const response = await axios.get<ReferenceCurrenciesResponse>(
      'https://api.coinranking.com/v2/reference-currencies',
      {
        headers: { 'x-access-token': process.env.COINRANKING_API_KEY },
      }
    );
    const currencies = response.data.data.currencies;
    currencies.forEach((currency: { symbol: string; uuid: string }) => {
      currencyUuids[currency.symbol] = currency.uuid;
    });
    await client.set('reference-currencies', JSON.stringify(currencyUuids), { EX: 30 * 24 * 60 * 60 });
    console.log('Reference currencies fetched and cached:', currencyUuids);
  } catch (error) {
    console.error('Error fetching reference currencies:', error);
  }
}

// Fetch price from Coinranking with rate limiting
async function fetchCoinrankingPrice(token: string, fiat: string): Promise<CoinrankingPriceResponse['data']> {
  // Check if we have remaining API calls
  const remaining = await getRemainingAPICalls();
  if (remaining <= 0) {
    throw new Error('Monthly API limit reached. Please try again next month.');
  }

  // Additional safety check - don't make calls if we're very close to the limit
  if (remaining <= 10) {
    console.warn(`Only ${remaining} API calls remaining this month. Skipping ${token}/${fiat} fetch.`);
    throw new Error(`Only ${remaining} API calls remaining this month.`);
  }

  const fiatUuid = currencyUuids[fiat] || currencyUuids['USD'];
  const url = `https://api.coinranking.com/v2/coin/${coinUuids[token]}/price`;
  
  console.log(`Making API call for ${token}/${fiat} (${remaining} calls remaining)`);
  
  const response = await axios.get<CoinrankingPriceResponse>(url, {
    headers: { 'x-access-token': process.env.COINRANKING_API_KEY },
    params: { referenceCurrencyUuid: fiatUuid },
  });
  
  // Track this API call
  await incrementAPICalls();
  
  console.log(`Coinranking response for ${token}/${fiat} (UUID: ${fiatUuid}):`, response.data);
  return response.data.data;
}

// Cache helpers
async function getPrice(key: string): Promise<any> {
  const cached = await client.get(key);
  return cached ? JSON.parse(cached) : null;
}

async function setPrice(key: string, value: any, ttl: number = 3600): Promise<void> {
  await client.setEx(key, ttl, JSON.stringify(value));
}

// Refresh prices with API limit awareness
async function refreshPrices(): Promise<void> {
  try {
    console.log('Refreshing prices...');
    const tokens = ['USDC'];
    const fiats = ['USD', 'COP', 'EUR', 'NGN', 'VES'];

    const callsRemaining = await getRemainingAPICalls();
    const requiredCalls = tokens.length * fiats.length;
    
    console.log(`API calls remaining: ${callsRemaining}, required for refresh: ${requiredCalls}`);
    
    if (callsRemaining < requiredCalls) {
      console.warn(`Insufficient API calls remaining (${callsRemaining}/${requiredCalls}). Skipping price refresh.`);
      return;
    }

    // Check if we have recent cached data to avoid unnecessary API calls
    const cacheAgeThreshold = 30 * 60; // 30 minutes in seconds
    let apiCallsMade = 0;

    for (const token of tokens) {
      for (const fiat of fiats) {
        const key = `price:${token}:${fiat}`;
        
        // Check if we have recent cached data
        const cachedData = await getPrice(key);
        if (cachedData && cachedData.timestamp) {
          const ageSeconds = (Date.now() / 1000) - cachedData.timestamp;
          if (ageSeconds < cacheAgeThreshold) {
            console.log(`Skipping ${token}/${fiat} - recent cache available (${Math.floor(ageSeconds/60)} minutes old)`);
            continue;
          }
        }

        let data: any;

        if (fiat === 'VES') {
          // Use hardcoded VES/USD rate - only need USD price
          const usdcUsd = await fetchCoinrankingPrice(token, 'USD');
          data = {
            price: (parseFloat(usdcUsd.price) * hardcodedVesUsd).toString(),
            timestamp: usdcUsd.timestamp,
          };
          apiCallsMade++;
        } else {
          data = await fetchCoinrankingPrice(token, fiat);
          apiCallsMade++;
        }

        await setPrice(key, data);
      }
    }
    console.log(`Prices refreshed. API calls made: ${apiCallsMade}`);
  } catch (error) {
    console.error('Error refreshing prices:', error);
  }
}

// API endpoint
app.get('/price', async (req: Request, res: Response): Promise<void> => {
  const { token, fiat } = req.query as {
    token?: string;
    fiat?: string;
  };

  if (!token || !fiat) {
    res.status(400).json({ status: 'error', message: 'Token and fiat are required' });
    return;
  }

  try {
    const key = `price:${token}:${fiat}`;
    let data = await getPrice(key);

    if (!data) {
      if (fiat === 'VES') {
        // Use hardcoded VES/USD rate
        const usdcUsd = await fetchCoinrankingPrice(token, 'USD');
        data = {
          price: (parseFloat(usdcUsd.price) * hardcodedVesUsd).toString(),
          timestamp: usdcUsd.timestamp,
        };
      } else {
        data = await fetchCoinrankingPrice(token, fiat);
      }
      await setPrice(key, data);
    }

    res.json({ status: 'success', data });
  } catch (error) {
    console.error('Error fetching price:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch price' });
  }
});

// API usage monitoring endpoint
app.get('/api-usage', async (req: Request, res: Response): Promise<void> => {
  try {
    const used = await getMonthlyAPICalls();
    const remaining = await getRemainingAPICalls();
    res.json({
      status: 'success',
      data: {
        used,
        remaining,
        limit: MONTHLY_API_LIMIT,
        percentage: Math.round((used / MONTHLY_API_LIMIT) * 100)
      }
    });
  } catch (error) {
    console.error('Error fetching API usage:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch API usage' });
  }
});

// API call tracking and rate limiting
const MONTHLY_API_LIMIT = 3000;
const API_USAGE_KEY = 'api-usage-monthly';
const API_MONTH_KEY = 'api-usage-month';

// Helper function to get current month identifier (YYYY-MM format)
function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Helper function to calculate seconds until next month starts
function getSecondsUntilNextMonth(): number {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const diffMs = nextMonth.getTime() - now.getTime();
  return Math.floor(diffMs / 1000);
}

// Check if we need to reset the counter due to month change
async function checkAndResetMonthlyCounter(): Promise<void> {
  const currentMonth = getCurrentMonth();
  const storedMonth = await client.get(API_MONTH_KEY);
  
  if (storedMonth !== currentMonth) {
    console.log(`Month changed from ${storedMonth} to ${currentMonth}. Resetting API counter.`);
    await client.del(API_USAGE_KEY);
    await client.set(API_MONTH_KEY, currentMonth);
    console.log('API usage counter reset for new month');
  }
}

async function getMonthlyAPICalls(): Promise<number> {
  // Check for month change first
  await checkAndResetMonthlyCounter();
  
  const usage = await client.get(API_USAGE_KEY);
  return usage ? parseInt(usage, 10) : 0;
}

async function incrementAPICalls(): Promise<void> {
  // Check for month change first
  await checkAndResetMonthlyCounter();
  
  const currentUsage = await getMonthlyAPICalls();
  const newUsage = currentUsage + 1;
  
  // Only set TTL if this is the first call of the month
  if (currentUsage === 0) {
    const secondsUntilNextMonth = getSecondsUntilNextMonth();
    await client.setEx(API_USAGE_KEY, secondsUntilNextMonth, newUsage.toString());
    console.log(`API counter initialized for month ${getCurrentMonth()}, expires in ${Math.floor(secondsUntilNextMonth / 86400)} days`);
  } else {
    // Just increment the counter without changing TTL
    await client.set(API_USAGE_KEY, newUsage.toString());
  }
  
  console.log(`API calls this month: ${newUsage}/${MONTHLY_API_LIMIT}`);
}

async function getRemainingAPICalls(): Promise<number> {
  const used = await getMonthlyAPICalls();
  return Math.max(0, MONTHLY_API_LIMIT - used);
}

// Start server and cron
async function startServer(): Promise<void> {
  await connectRedis();
  const cachedCurrencies = await getPrice('reference-currencies');
  if (!cachedCurrencies) await fetchReferenceCurrencies();
  else Object.assign(currencyUuids, cachedCurrencies);

  app.listen(port, () => {
    console.log(`Pricing server running on port ${port}`);
    refreshPrices(); // Initial fetch
    cron.schedule('0 * * * *', refreshPrices); // Every hour
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});