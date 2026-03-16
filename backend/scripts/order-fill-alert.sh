#!/bin/bash
# Order fill alert — runs in background, exits when any open order fills or position changes
# Usage: bash order-fill-alert.sh <accountId>
#   Example: bash order-fill-alert.sh 20130833

BASE="http://localhost:3001"
ACCT="${1:-20130833}"

# Take initial snapshot
INIT_POS=$(curl -s "$BASE/positions/open?accountId=$ACCT")
INIT_ORD=$(curl -s "$BASE/orders/open?accountId=$ACCT")

INIT_POS_IDS=$(echo "$INIT_POS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const p=JSON.parse(d).positions||[];console.log(p.map(x=>x.id).sort().join(','))})" 2>/dev/null)
INIT_ORD_IDS=$(echo "$INIT_ORD" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const o=JSON.parse(d).orders||[];console.log(o.map(x=>x.id).sort().join(','))})" 2>/dev/null)

echo "Watching account $ACCT — positions:[$INIT_POS_IDS] orders:[$INIT_ORD_IDS]"

while true; do
  sleep 5
  CUR_POS=$(curl -s "$BASE/positions/open?accountId=$ACCT" 2>/dev/null)
  CUR_ORD=$(curl -s "$BASE/orders/open?accountId=$ACCT" 2>/dev/null)

  CUR_POS_IDS=$(echo "$CUR_POS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const p=JSON.parse(d).positions||[];console.log(p.map(x=>x.id).sort().join(','))})" 2>/dev/null)
  CUR_ORD_IDS=$(echo "$CUR_ORD" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const o=JSON.parse(d).orders||[];console.log(o.map(x=>x.id).sort().join(','))})" 2>/dev/null)

  # If positions or orders changed, report and exit
  if [[ "$CUR_POS_IDS" != "$INIT_POS_IDS" || "$CUR_ORD_IDS" != "$INIT_ORD_IDS" ]]; then
    echo "$CUR_POS" | node -e "
      let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
        const init='$INIT_POS_IDS'.split(',').filter(Boolean);
        const cur=JSON.parse(d).positions||[];
        const initSet=new Set(init);
        const curSet=new Set(cur.map(p=>String(p.id)));
        for(const p of cur){if(!initSet.has(String(p.id)))console.log('ORDER FILLED → POSITION_OPENED '+(p.type===1?'LONG':'SHORT')+' size='+p.size+' price='+p.averagePrice)}
        for(const id of init){if(!curSet.has(id))console.log('POSITION_CLOSED id='+id)}
        if(init.length===cur.length&&init.length>0)console.log('POSITION UNCHANGED')
      })" 2>/dev/null

    echo "$CUR_ORD" | node -e "
      let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
        const init='$INIT_ORD_IDS'.split(',').filter(Boolean);
        const cur=JSON.parse(d).orders||[];
        const curSet=new Set(cur.map(o=>String(o.id)));
        for(const id of init){if(!curSet.has(id))console.log('ORDER GONE id='+id)}
      })" 2>/dev/null

    exit 0
  fi
done
