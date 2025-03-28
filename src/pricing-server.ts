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

interface BinanceP2PResponse {
  data: Array<{
    adv: {
      price: string;
    };
  }>;
}

interface BinanceP2PPrice {
  min: number;
  median: number;
  max: number;
}

// Currency and Coin UUIDs (to be populated dynamically)
const currencyUuids: Record<string, string> = {
  USD: 'yhjMzLPhuIDl',
  // Add more dynamically from /reference-currencies
};
const coinUuids: Record<string, string> = {
  USDC: 'razxDUgYGNAdQ',
  // Add more as needed
};

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
    currencies.forEach((currency) => {
      currencyUuids[currency.symbol] = currency.uuid;
    });
    await client.set('reference-currencies', JSON.stringify(currencyUuids), { EX: 30 * 24 * 60 * 60 }); // Cache for 30 days
    console.log('Reference currencies fetched and cached');
  } catch (error) {
    console.error('Error fetching reference currencies:', error);
  }
}

// Price fetching functions
async function fetchCoinrankingPrice(token: string, fiat: string): Promise<CoinrankingPriceResponse['data']> {
  const url = `https://api.coinranking.com/v2/coin/${coinUuids[token]}/price`;
  const response = await axios.get<CoinrankingPriceResponse>(url, {
    headers: { 'x-access-token': process.env.COINRANKING_API_KEY },
    params: { referenceCurrencyUuid: currencyUuids[fiat] },
  });
  return response.data.data;
}

async function fetchBinanceP2PPrice(token: string, fiat: string, type: 'BUY' | 'SELL'): Promise<BinanceP2PPrice> {
  const response = await axios.post<BinanceP2PResponse>(process.env.BINANCE_API_URL as string, {
    fiat,
    page: 1,
    rows: 10,
    asset: token,
    tradeType: type,
    searchType: 'FAST',
  });
  const prices = response.data.data.map((ad) => parseFloat(ad.adv.price)).sort((a, b) => a - b);
  return {
    min: prices[0],
    median: prices[Math.floor(prices.length / 2)],
    max: prices[prices.length - 1],
  };
}

// Cache helpers
async function getPrice(key: string): Promise<any> {
  const cached = await client.get(key);
  return cached ? JSON.parse(cached) : null;
}

async function setPrice(key: string, value: any, ttl: number = 900): Promise<void> {
  await client.setEx(key, ttl, JSON.stringify(value));
}

// Refresh prices with API limit awareness
async function refreshPrices(): Promise<void> {
  try {
    console.log('Refreshing prices...');
    const tokens = ['USDC'];
    const fiats = ['USD', 'COP', 'EUR', 'NGN', 'VES'];

    // Check remaining API calls (pseudo-code; implement based on dashboard or tracking)
    const callsRemaining = await getRemainingAPICalls();
    if (callsRemaining < tokens.length * (fiats.length - 2)) { // -2 for NGN, VES (Binance)
      console.warn('Approaching API limit, skipping Coinranking fetch');
      return;
    }

    for (const token of tokens) {
      for (const fiat of fiats) {
        if (['NGN', 'VES'].includes(fiat)) {
          for (const type of ['BUY', 'SELL'] as const) {
            const prices = await fetchBinanceP2PPrice(token, fiat, type);
            await setPrice(`price:${token}:${fiat}:${type}`, prices);
          }
        } else {
          const data = await fetchCoinrankingPrice(token, fiat);
          await setPrice(`price:${token}:${fiat}`, { price: data.price, timestamp: data.timestamp });
        }
      }
    }
    console.log('Prices refreshed');
  } catch (error) {
    console.error('Error refreshing prices:', error);
  }
}

// API endpoint
app.get('/price', async (req: Request, res: Response): Promise<void> => {
  const { token, fiat, source = 'coinranking', type } = req.query as {
    token?: string;
    fiat?: string;
    source?: string;
    type?: string;
  };

  if (!token || !fiat) {
    res.status(400).json({ status: 'error', message: 'Token and fiat are required' });
    return;
  }

  try {
    let key: string, data: any;
    if (source === 'binance' || ['NGN', 'VES'].includes(fiat)) {
      if (!type) {
        res.status(400).json({ status: 'error', message: 'Type (BUY/SELL) required for Binance' });
        return;
      }
      key = `price:${token}:${fiat}:${type}`;
      data = await getPrice(key);
      if (!data) {
        data = await fetchBinanceP2PPrice(token, fiat, type as 'BUY' | 'SELL');
        await setPrice(key, data);
      }
    } else {
      key = `price:${token}:${fiat}`;
      data = await getPrice(key);
      if (!data) {
        data = await fetchCoinrankingPrice(token, fiat);
        await setPrice(key, data);
      }
    }
    res.json({ status: 'success', data });
  } catch (error) {
    console.error('Error fetching price:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch price' });
  }
});

// Placeholder for API call tracking
async function getRemainingAPICalls(): Promise<number> {
  return 5000; // Replace with actual logic
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
    cron.schedule('*/15 * * * *', refreshPrices); // Every 15 minutes
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});