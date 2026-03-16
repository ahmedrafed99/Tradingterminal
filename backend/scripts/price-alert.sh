#!/bin/bash
# Price alert — runs in background, exits when price crosses target
# Usage: bash price-alert.sh <target> <direction> [contractId]
#   direction: "above" or "below"
#   Example: bash price-alert.sh 24700 below   → alerts when price drops to/below 24700
#   Example: bash price-alert.sh 24740 above   → alerts when price rises to/above 24740

BASE="http://localhost:3001"
TARGET="$1"
DIR="${2:-below}"
CONTRACT="${3:-CON.F.US.MNQ.H26}"

if [[ -z "$TARGET" || -z "$DIR" ]]; then
  echo "Usage: bash price-alert.sh <target> <above|below> [contractId]"
  exit 1
fi

echo "Watching for price $DIR $TARGET..."

while true; do
  sleep 5
  BAR=$(curl -s -X POST "$BASE/market/bars" -H "Content-Type: application/json" \
    -d "{\"contractId\":\"$CONTRACT\",\"live\":false,\"unit\":2,\"unitNumber\":1,\"startTime\":\"2000-01-01T00:00:00.000Z\",\"endTime\":\"2099-01-01T00:00:00.000Z\",\"limit\":1,\"includePartialBar\":true}" 2>/dev/null)

  PRICE=$(echo "$BAR" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const b=JSON.parse(d).bars[0];console.log(b.c)}catch{console.log('ERR')}})" 2>/dev/null)

  [[ "$PRICE" == "ERR" || -z "$PRICE" ]] && continue

  if [[ "$DIR" == "below" ]]; then
    HIT=$(node -e "console.log($PRICE <= $TARGET ? 'YES' : 'NO')" 2>/dev/null)
  else
    HIT=$(node -e "console.log($PRICE >= $TARGET ? 'YES' : 'NO')" 2>/dev/null)
  fi

  if [[ "$HIT" == "YES" ]]; then
    echo "PRICE ALERT: $PRICE hit $DIR $TARGET"
    exit 0
  fi
done
