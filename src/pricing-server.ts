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
    currencies.forEach((currency) => {
      currencyUuids[currency.symbol] = currency.uuid;
    });
    await client.set('reference-currencies', JSON.stringify(currencyUuids), { EX: 30 * 24 * 60 * 60 });
    console.log('Reference currencies fetched and cached:', currencyUuids);
  } catch (error) {
    console.error('Error fetching reference currencies:', error);
  }
}

// Fetch price from Coinranking
async function fetchCoinrankingPrice(token: string, fiat: string): Promise<CoinrankingPriceResponse['data']> {
  const fiatUuid = currencyUuids[fiat] || currencyUuids['USD'];
  const url = `https://api.coinranking.com/v2/coin/${coinUuids[token]}/price`;
  const response = await axios.get<CoinrankingPriceResponse>(url, {
    headers: { 'x-access-token': process.env.COINRANKING_API_KEY },
    params: { referenceCurrencyUuid: fiatUuid },
  });
  console.log(`Coinranking response for ${token}/${fiat} (UUID: ${fiatUuid}):`, response.data);
  return response.data.data;
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

    const callsRemaining = await getRemainingAPICalls();
    if (callsRemaining < tokens.length * fiats.length) {
      console.warn('Approaching API limit, skipping Coinranking fetch');
      return;
    }

    for (const token of tokens) {
      for (const fiat of fiats) {
        const key = `price:${token}:${fiat}`;
        let data: any;

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
    }
    console.log('Prices refreshed');
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