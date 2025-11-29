# Ref

pending deployment of latest update to api rate limiting management

npm run dev starts it all from scratch

## Price API

curl http://localhost:4000/price?token=USDC&fiat=USD
curl http://localhost:4000/price?token=USDC&fiat=COP
curl http://localhost:4000/price?token=USDC&fiat=NGN
curl http://localhost:4000/price?token=USDC&fiat=VES

## Monitor Dolar
https://monitordolarvenezuela.com/api-dolar-venezuela

## CoinRanking

curl http://localhost:4000/api-usage

### reset
#### manual
// Reset to a specific value (e.g., 1 to match Coinranking showing 4999 remaining)
redis-cli set api-usage-monthly 1

// Verify the reset
curl http://localhost:4000/api-usage

#### using endpoint
// Reset to a specific value
curl -X POST http://localhost:4000/api-usage/reset \
  -H "Content-Type: application/json" \
  -d '{"value": 1}'

// Reset to 0 (if you want to start fresh)
curl -X POST http://localhost:4000/api-usage/reset \
  -H "Content-Type: application/json" \
  -d '{}'
  
### USDC Price in USD
❯ curl -H "x-access-token: x" "https://api.coinranking.com/v2/coin/aKzUVe4Hh_CON/price" | jq '.'

{
  "status": "success",
  "data": {
    "price": "1.0006732321404195",
    "timestamp": 1743181740
  }
}

### COP Price in USD

curl -H "x-access-token: x" \
     "https://api.coinranking.com/v2/coin/yhjMzLPhuIDl/price?referenceCurrencyUuid=Y7N-jnLhqYiW" | jq '.'