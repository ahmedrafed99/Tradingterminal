#!/bin/bash
# Claude trading helper functions
# Usage: source claude-tools.sh

BASE="http://localhost:3001"

# Default accounts — override with ACCT env var
PRACTICE=20130833
CHALLENGE=20292418
ACCT="${ACCT:-$PRACTICE}"

# Fetch recent bars
# bars [count] [unit] [unitNumber] [contractId]
# unit: 1=Second, 2=Minute, 3=Hour, 4=Day
# Examples: bars 10  |  bars 30 2  |  bars 5 3
bars() {
  local count="${1:-10}"
  local unit="${2:-2}"
  local unitNum="${3:-1}"
  local contract="${4:-CON.F.US.MNQ.H26}"
  local now=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  curl -s -X POST "$BASE/market/bars" -H "Content-Type: application/json" \
    -d "{\"contractId\":\"$contract\",\"live\":false,\"unit\":$unit,\"unitNumber\":$unitNum,\"startTime\":\"2026-03-13T00:00:00.000Z\",\"endTime\":\"$now\",\"limit\":$count,\"includePartialBar\":true}"
}

# Get current price (last bar close)
price() {
  bars 1 | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const b=JSON.parse(d).bars[0]||{};console.log('Price:',b.c,'| H:',b.h,'| L:',b.l,'| V:',b.v)})"
}

# Check open positions
pos() {
  curl -s "$BASE/positions/open?accountId=${1:-$ACCT}"
}

# Check open orders
orders() {
  curl -s "$BASE/orders/open?accountId=${1:-$ACCT}"
}

# Check account balance
bal() {
  curl -s "$BASE/accounts"
}

# Place market order: market buy|sell [size] [contractId]
market() {
  local side=0
  [[ "$1" == "sell" ]] && side=1
  local size="${2:-1}"
  local contract="${3:-CON.F.US.MNQ.H26}"
  curl -s -X POST "$BASE/orders/place" -H "Content-Type: application/json" \
    -d "{\"accountId\":\"$ACCT\",\"contractId\":\"$contract\",\"type\":2,\"side\":$side,\"size\":$size}"
}

# Place market order with bracket: marketb buy|sell slTicks tpTicks [size] [contractId]
# LONG: slTicks negative, tpTicks positive. SHORT: slTicks positive, tpTicks negative.
# Tick math: points / 0.25 = ticks (e.g., 25pts = 100 ticks)
marketb() {
  local side=0
  [[ "$1" == "sell" ]] && side=1
  local slTicks="$2"
  local tpTicks="$3"
  local size="${4:-1}"
  local contract="${5:-CON.F.US.MNQ.H26}"
  curl -s -X POST "$BASE/orders/place" -H "Content-Type: application/json" \
    -d "{\"accountId\":\"$ACCT\",\"contractId\":\"$contract\",\"type\":2,\"side\":$side,\"size\":$size,\"stopLossBracket\":{\"ticks\":$slTicks,\"type\":4},\"takeProfitBracket\":{\"ticks\":$tpTicks,\"type\":1}}"
}

# Place stop order: stop buy|sell price [size]
stop() {
  local side=0
  [[ "$1" == "sell" ]] && side=1
  local stopPrice="$2"
  local size="${3:-1}"
  local contract="${4:-CON.F.US.MNQ.H26}"
  curl -s -X POST "$BASE/orders/place" -H "Content-Type: application/json" \
    -d "{\"accountId\":\"$ACCT\",\"contractId\":\"$contract\",\"type\":4,\"side\":$side,\"size\":$size,\"stopPrice\":$stopPrice}"
}

# Place limit order: limit buy|sell price [size]
limit() {
  local side=0
  [[ "$1" == "sell" ]] && side=1
  local limitPrice="$2"
  local size="${3:-1}"
  local contract="${4:-CON.F.US.MNQ.H26}"
  curl -s -X POST "$BASE/orders/place" -H "Content-Type: application/json" \
    -d "{\"accountId\":\"$ACCT\",\"contractId\":\"$contract\",\"type\":1,\"side\":$side,\"size\":$size,\"limitPrice\":$limitPrice}"
}

# Place limit order with bracket: limitb buy|sell price slTicks tpTicks [size]
limitb() {
  local side=0
  [[ "$1" == "sell" ]] && side=1
  local limitPrice="$2"
  local slTicks="$3"
  local tpTicks="$4"
  local size="${5:-1}"
  local contract="${6:-CON.F.US.MNQ.H26}"
  curl -s -X POST "$BASE/orders/place" -H "Content-Type: application/json" \
    -d "{\"accountId\":\"$ACCT\",\"contractId\":\"$contract\",\"type\":1,\"side\":$side,\"size\":$size,\"limitPrice\":$limitPrice,\"stopLossBracket\":{\"ticks\":$slTicks,\"type\":4},\"takeProfitBracket\":{\"ticks\":$tpTicks,\"type\":1}}"
}

# Cancel order by ID
cancel() {
  curl -s -X POST "$BASE/orders/cancel" -H "Content-Type: application/json" \
    -d "{\"accountId\":\"$ACCT\",\"orderId\":\"$1\"}"
}

# Cancel all open orders
cancelall() {
  local ids=$(orders | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const o=JSON.parse(d);(o.orders||[]).forEach(x=>console.log(x.id))})")
  for id in $ids; do cancel "$id"; done
}

# Close position (flatten): flatten [size override]
# type: 1=long, 2=short. Close long with sell, close short with buy.
flatten() {
  local posData=$(pos)
  local info=$(echo "$posData" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      const p=JSON.parse(d).positions||[];
      if(!p.length){console.log('NONE');return}
      const pos=p[0];
      console.log(pos.size+'|'+(pos.type===1?'sell':'buy'))
    })")
  if [[ "$info" == "NONE" ]]; then echo "No position"; return; fi
  local sz="${info%%|*}"
  local closeSide="${info##*|}"
  market "$closeSide" "$sz"
}

# Full status: price + position + orders + balance
status() {
  echo "=== PRICE ==="
  price
  echo -e "\n=== POSITION ==="
  pos
  echo -e "\n=== ORDERS ==="
  orders
  echo -e "\n=== BALANCE ==="
  bal
}

# Get recent trades for account
trades() {
  local start="${2:-$(date -u -d '1 day ago' +%Y-%m-%dT00:00:00Z 2>/dev/null || date -u +%Y-%m-%dT00:00:00Z)}"
  curl -s "$BASE/trades/search?accountId=${1:-$ACCT}&startTimestamp=$start"
}

# Switch to challenge account
usechallenge() { export ACCT=$CHALLENGE; echo "Switched to CHALLENGE account $ACCT"; }
# Switch to practice account
usepractice() { export ACCT=$PRACTICE; echo "Switched to PRACTICE account $ACCT"; }

# ─── Drawing Tools ────────────────────────────────────────────────────────────
# Draw horizontal line: hline price [color] [label] [strokeWidth]
# Colors: red=#ef5350 green=#26a69a blue=#2962ff yellow=#f0a830 white=#ffffff muted=#787b86
hline() {
  local price="$1"
  local color="${2:-#787b86}"
  local label="${3:-}"
  local sw="${4:-1}"
  local contract="${5:-CON.F.US.MNQ.H26}"
  local text="null"
  if [[ -n "$label" ]]; then
    text="{\"content\":\"$label\",\"color\":\"$color\",\"fontSize\":12,\"bold\":false,\"italic\":false,\"hAlign\":\"left\",\"vAlign\":\"bottom\"}"
  fi
  curl -s -X POST "$BASE/drawings/add" -H "Content-Type: application/json" \
    -d "{\"type\":\"hline\",\"price\":$price,\"color\":\"$color\",\"strokeWidth\":$sw,\"text\":$text,\"contractId\":\"$contract\",\"startTime\":0,\"extendLeft\":true}"
}

# Draw support level (green line)
support() { hline "$1" "#26a69a" "${2:-Support}"; }

# Draw resistance level (red line)
resist() { hline "$1" "#ef5350" "${2:-Resistance}"; }

# Draw entry level (blue line)
entry_line() { hline "$1" "#2962ff" "${2:-Entry}"; }

# Draw SL level (red)
sl_line() { hline "$1" "#ef5350" "${2:-SL}"; }

# Draw TP level (green)
tp_line() { hline "$1" "#26a69a" "${2:-TP}"; }

# Mark opening range: or_range high low
or_range() {
  hline "$1" "#f0a830" "OR High"
  hline "$2" "#f0a830" "OR Low"
}

# Clear all pending drawings from queue
cleardrawings() {
  curl -s -X DELETE "$BASE/drawings/clear"
}

# ─── Trade Watcher (file-based, no backend changes) ──────────────────────────
WATCH_DIR="$HOME/.claude-trade-watcher"

# Save current state snapshot: watch [accountId]
watch_snapshot() {
  mkdir -p "$WATCH_DIR"
  local acct="${1:-$ACCT}"
  curl -s "$BASE/positions/open?accountId=$acct" > "$WATCH_DIR/${acct}_pos.json"
  curl -s "$BASE/orders/open?accountId=$acct" > "$WATCH_DIR/${acct}_ord.json"
}

# Compare current state to last snapshot, print events: watch_check [accountId]
# Syncs to :01 or :31 of each minute (1s after candle close / mid-candle)
watch_check() {
  local sec=$(date +%S | sed 's/^0//')
  local target
  if (( sec < 1 )); then target=1
  elif (( sec < 31 )); then target=31
  else target=61; fi
  local wait=$(( target - sec ))
  if (( wait > 0 && wait < 30 )); then sleep "$wait"; fi

  local acct="${1:-$ACCT}"
  mkdir -p "$WATCH_DIR"
  local prev_pos="$WATCH_DIR/${acct}_pos.json"
  local prev_ord="$WATCH_DIR/${acct}_ord.json"
  local cur_pos=$(curl -s "$BASE/positions/open?accountId=$acct")
  local cur_ord=$(curl -s "$BASE/orders/open?accountId=$acct")

  # If no previous snapshot, save and return
  if [[ ! -f "$prev_pos" ]]; then
    echo "$cur_pos" > "$prev_pos"
    echo "$cur_ord" > "$prev_ord"
    echo "WATCH: first snapshot saved"
    return
  fi

  # Compare using node
  local prev_pos_win=$(cygpath -w "$prev_pos" 2>/dev/null || echo "$prev_pos")
  local prev_ord_win=$(cygpath -w "$prev_ord" 2>/dev/null || echo "$prev_ord")
  node -e "
    const prev_pos = JSON.parse(require('fs').readFileSync(String.raw\`$prev_pos_win\`,'utf8'));
    const prev_ord = JSON.parse(require('fs').readFileSync(String.raw\`$prev_ord_win\`,'utf8'));
    const cur_pos = $cur_pos;
    const cur_ord = $cur_ord;
    const prevIds = new Set((prev_pos.positions||[]).map(p=>String(p.id)));
    const curIds = new Set((cur_pos.positions||[]).map(p=>String(p.id)));
    const prevOrdIds = new Set((prev_ord.orders||[]).map(o=>String(o.id)));
    const curOrdIds = new Set((cur_ord.orders||[]).map(o=>String(o.id)));
    // New positions = fills
    for(const p of (cur_pos.positions||[])){
      if(!prevIds.has(String(p.id))) console.log('EVENT: POSITION_OPENED '+(p.type===1?'LONG':'SHORT')+' size='+p.size+' price='+p.averagePrice);
    }
    // Closed positions
    for(const p of (prev_pos.positions||[])){
      if(!curIds.has(String(p.id))) console.log('EVENT: POSITION_CLOSED '+(p.type===1?'LONG':'SHORT')+' price='+p.averagePrice);
    }
    // Disappeared orders (filled or canceled)
    for(const o of (prev_ord.orders||[])){
      if(!curOrdIds.has(String(o.id))){
        const tag=o.customTag||'';
        if(tag.includes('-SL')&&prevIds.size>0&&curIds.size===0) console.log('EVENT: SL_HIT price='+o.stopPrice);
        else if(tag.includes('-TP')&&prevIds.size>0&&curIds.size===0) console.log('EVENT: TP_HIT price='+o.limitPrice);
        else if(!tag.includes('AutoBracket')) console.log('EVENT: ORDER_FILLED id='+o.id+' limit='+o.limitPrice);
      }
    }
    if(cur_pos.positions?.length===prev_pos.positions?.length && cur_ord.orders?.length===prev_ord.orders?.length) console.log('NO_CHANGE');
  "

  # Update snapshot
  echo "$cur_pos" > "$prev_pos"
  echo "$cur_ord" > "$prev_ord"
}
