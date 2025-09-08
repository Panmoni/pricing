# YapBay & LocalSolana Pricing Server

A lightweight Express.js server that provides cryptocurrency price feeds with support for multiple fiat currencies. The server caches prices using Redis and updates them periodically via the Coinranking API.

The primary repo for this project is at: [https://github.com/Panmoni/yapbay](https://github.com/Panmoni/yapbay).

## Features

- Real-time USDC pricing in multiple currencies (USD, EUR, COP, NGN, VES)
- Redis caching for improved performance
- 15-minute automatic price updates
- Custom handling for VES (Venezuelan Bolivar) using hardcoded rates
- RESTful API endpoint for price queries

## Prerequisites

- Node.js
- Redis server
- Coinranking API key

## Setup

1. Clone the repository
2. Install dependencies:
```bash
npm install
```
3. Create a `.env` file with the following variables:
```env
PORT=4000
REDIS_URL=redis://localhost:6379
COINRANKING_API_KEY=your_api_key_here
HARDCODED_VES_USD=103.99
CR_USDC_UUID=aKzUVe4Hh_CON
CR_COP_UUID=Y7N-jnLhqYiW
CR_NGN_UUID=znnRJjGM4nVb
```

## Usage

1. Start the Redis server
2. Run the application:
```bash
npm start
```

## API Endpoint

GET `/price`

Query Parameters:
- `token`: Cryptocurrency token (e.g., USDC)
- `fiat`: Fiat currency (USD, EUR, COP, NGN, VES)

Example:
```
GET /price?token=USDC&fiat=USD
```

Response:
```json
{
  "status": "success",
  "data": {
    "price": "1.00",
    "timestamp": 1679890000
  }
}
```
