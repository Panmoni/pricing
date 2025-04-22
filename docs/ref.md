# Ref

npm run dev starts it all from scratch

## Price API

curl http://localhost:4000/price?token=USDC&fiat=USD
curl http://localhost:4000/price?token=USDC&fiat=COP
curl http://localhost:4000/price?token=USDC&fiat=NGN
curl http://localhost:4000/price?token=USDC&fiat=VES

## CoinRanking
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