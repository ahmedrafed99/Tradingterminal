#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# claude-tools.sh — Trading terminal helper functions
# ═══════════════════════════════════════════════════════════════════════════════
#
# SETUP
#   source backend/claude-tools.sh
#
# ACCOUNTS
#   Default account is PRACTICE. Switch with:
#     usepractice       — switch to practice account
#     usechallenge      — switch to challenge account
#     ACCT=12345 ...    — one-off override for a single command
#
# CONTRACT
#   DEFAULT_CONTRACT is the active MNQ front-month. Override per-command by
#   passing the contract ID as the last argument to most functions.
#
# ── MARKET DATA ──────────────────────────────────────────────────────────────
#   price                         current price (H/L/V of last bar)
#   bars [count] [unit] [n]       raw OHLCV bars (unit: 1=sec 2=min 3=hr 4=day)
#   status                        price + position + orders + balance
#
# ── ORDERS ───────────────────────────────────────────────────────────────────
#   market buy|sell [size]                    market order
#   marketb  buy|sell slTicks tpTicks [size]  market + native SL/TP bracket
#                                             (ticks: 1 pt = 4 ticks for MNQ)
#                                             long: slTicks<0, tpTicks>0
#                                             short: slTicks>0, tpTicks<0
#   marketbt buy|sell slTicks tpTicks [size]  market + trailing-stop bracket
#                                             same tick convention as marketb
#   marketmulti buy|sell size sl_pts tp:sz... [trail] [contractId]
#                                             market + manual multi-TP bracket
#                                             tp format: points:contracts (e.g. 30:1)
#                                             trail → trailing stop instead of hard stop
#                                             Examples:
#                                               marketmulti buy 3 20 30:1 60:1 90:1
#                                               marketmulti buy 3 20 30:1 60:2 trail
#   limit  buy|sell price [size]              limit order
#   limitb buy|sell price slTicks tpTicks     limit + native SL/TP bracket
#   stop   buy|sell price [size]              stop order
#   cancel <orderId>                          cancel one order
#   cancelall                                 cancel all open orders
#   flatten                                   close open position at market
#
# ── DRAWINGS ─────────────────────────────────────────────────────────────────
#   hline price [color] [label] [strokeWidth] horizontal line
#   support price [label]                     green support line
#   resist  price [label]                     red resistance line
#   entry_line price [label]                  blue entry line
#   sl_line    price [label]                  red SL line
#   tp_line    price [label]                  green TP line
#   or_range   high low                       opening range (two yellow lines)
#   cleardrawings                             clear pending drawing queue
#
# ── MONITORING ───────────────────────────────────────────────────────────────
#   pos                           open positions
#   orders                        open orders
#   bal                           account balance
#   trades [accountId] [since]    recent fills
#   watch_snapshot                save state snapshot for watch_check
#   watch_check                   diff current state vs snapshot (fills/closes)
#   alert_price <price> above|below   background price alert (run as: alert_price ... &)
#   alert_fill  [accountId]           background fill alert
#
# ═══════════════════════════════════════════════════════════════════════════════

BASE="http://localhost:3001"

# Default accounts — override with ACCT env var
PRACTICE=23310630
CHALLENGE=23212177
ACCT="${ACCT:-$PRACTICE}"
DEFAULT_CONTRACT="CON.F.US.MNQ.M26"

# Fetch recent bars
# bars [count] [unit] [unitNumber] [contractId]
# unit: 1=Second, 2=Minute, 3=Hour, 4=Day
# Examples: bars 10  |  bars 30 2  |  bars 5 3
bars() {
  local count="${1:-10}"
  local unit="${2:-2}"
  local unitNum="${3:-1}"
  local contract="${4:-$DEFAULT_CONTRACT}"
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
  local contract="${3:-$DEFAULT_CONTRACT}"
  curl -s -X POST "$BASE/orders/place" -H "Content-Type: application/json" \
    -d "{\"accountId\":\"$ACCT\",\"contractId\":\"$contract\",\"type\":2,\"side\":$side,\"size\":$size}"
}

# Place market order with multiple TPs: marketmulti buy|sell total_size sl_pts tp1_pts:size1 [tp2_pts:size2 ...] [trail] [contractId]
# Example: marketmulti buy 2 20 40:1 80:1
# Example: marketmulti buy 2 20 40:1 80:1 trail
# Example: marketmulti sell 3 25 30:1 60:1 90:1 CON.F.US.ES.H26
# SL type: pass "trail" anywhere after sl_pts to use trailing stop (type 5) instead of stop (type 4)
marketmulti() {
  local direction="$1"
  local total_size="${2:-1}"
  local sl_pts="${3:-20}"
  shift 3

  local side=0
  [[ "$direction" == "sell" ]] && side=1
  local opp_side=1
  [[ "$side" == "1" ]] && opp_side=0

  # Collect TP specs (tp_pts:size) — "trail" sets SL type, anything else without a colon is the contract
  local -a tp_specs=()
  local contract="$DEFAULT_CONTRACT"
  local sl_type=4  # 4=Stop, 5=TrailingStop
  for arg in "$@"; do
    if [[ "$arg" == *:* ]]; then tp_specs+=("$arg")
    elif [[ "$arg" == "trail" ]]; then sl_type=5
    else contract="$arg"; fi
  done

  local sl_label="Stop"
  [[ "$sl_type" == "5" ]] && sl_label="TrailingStop"

  # Get current price
  local cur_price=$(curl -s -X POST "$BASE/market/bars" -H "Content-Type: application/json" \
    -d "{\"contractId\":\"$contract\",\"live\":false,\"unit\":2,\"unitNumber\":1,\"startTime\":\"2020-01-01T00:00:00Z\",\"endTime\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"limit\":1,\"includePartialBar\":true}" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).bars?.[0]?.c||0))")
  echo "Current price: $cur_price"

  # Place entry
  local entry_resp=$(curl -s -X POST "$BASE/orders/place" -H "Content-Type: application/json" \
    -d "{\"accountId\":\"$ACCT\",\"contractId\":\"$contract\",\"type\":2,\"side\":$side,\"size\":$total_size}")
  echo "Entry: $entry_resp"

  # Wait for fill, then get actual fill price from position
  sleep 0.5
  local fill_price=$(curl -s "$BASE/positions/open?accountId=$ACCT" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
        const p=(JSON.parse(d).positions||[]).find(x=>String(x.contractId).includes('$contract'.split('.').pop())||String(x.contractId)==='$contract');
        console.log(p?.averagePrice||$cur_price);
      })")
  echo "Fill price: $fill_price"

  # Place SL — Stop uses stopPrice (absolute), TrailingStop uses trailPrice (distance in ticks, 1pt=4ticks for MNQ)
  local sl_resp
  if [[ "$sl_type" == "5" ]]; then
    # trailPrice = trail distance in ticks (NOT an absolute price). MNQ tick=0.25 → 1pt=4tks.
    local sl_ticks=$(node -e "console.log(Math.round($sl_pts * 4))")
    sl_resp=$(curl -s -X POST "$BASE/orders/place" -H "Content-Type: application/json" \
      -d "{\"accountId\":\"$ACCT\",\"contractId\":\"$contract\",\"type\":5,\"side\":$opp_side,\"size\":$total_size,\"trailPrice\":$sl_ticks}")
    echo "SL trail ${sl_pts}pts (${sl_ticks}tks, TrailingStop): $sl_resp"
  else
    local sl_price=$(node -e "const p=$fill_price,s=$sl_pts,d=$side===0?-1:1;console.log(Math.round((p+d*s)*100)/100)")
    sl_resp=$(curl -s -X POST "$BASE/orders/place" -H "Content-Type: application/json" \
      -d "{\"accountId\":\"$ACCT\",\"contractId\":\"$contract\",\"type\":4,\"side\":$opp_side,\"size\":$total_size,\"stopPrice\":$sl_price}")
    echo "SL @ $sl_price (${sl_pts}pts, $sl_label): $sl_resp"
  fi

  # Place each TP
  local i=1
  for spec in "${tp_specs[@]}"; do
    local tp_pts="${spec%%:*}"
    local tp_size="${spec##*:}"
    local tp_price=$(node -e "const p=$fill_price,t=$tp_pts,d=$side===0?1:-1;console.log(Math.round((p+d*t)*100)/100)")
    local tp_resp=$(curl -s -X POST "$BASE/orders/place" -H "Content-Type: application/json" \
      -d "{\"accountId\":\"$ACCT\",\"contractId\":\"$contract\",\"type\":1,\"side\":$opp_side,\"size\":$tp_size,\"limitPrice\":$tp_price}")
    echo "TP$i @ $tp_price (${tp_pts}pts, ${tp_size}ct): $tp_resp"
    (( i++ ))
  done
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
  local contract="${5:-$DEFAULT_CONTRACT}"
  curl -s -X POST "$BASE/orders/place" -H "Content-Type: application/json" \
    -d "{\"accountId\":\"$ACCT\",\"contractId\":\"$contract\",\"type\":2,\"side\":$side,\"size\":$size,\"stopLossBracket\":{\"ticks\":$slTicks,\"type\":4},\"takeProfitBracket\":{\"ticks\":$tpTicks,\"type\":1}}"
}

# Place market order with trailing-stop bracket: marketbt buy|sell slTicks tpTicks [size] [contractId]
# Like marketb but SL is a trailing stop (type 5) instead of a fixed stop.
# Tick math: points / 0.25 = ticks (e.g., 20pts = 80 ticks)
marketbt() {
  local side=0
  [[ "$1" == "sell" ]] && side=1
  local slTicks="$2"
  local tpTicks="$3"
  local size="${4:-1}"
  local contract="${5:-$DEFAULT_CONTRACT}"
  curl -s -X POST "$BASE/orders/place" -H "Content-Type: application/json" \
    -d "{\"accountId\":\"$ACCT\",\"contractId\":\"$contract\",\"type\":2,\"side\":$side,\"size\":$size,\"stopLossBracket\":{\"ticks\":$slTicks,\"type\":5},\"takeProfitBracket\":{\"ticks\":$tpTicks,\"type\":1}}"
}

# Place stop order: stop buy|sell price [size]
stop() {
  local side=0
  [[ "$1" == "sell" ]] && side=1
  local stopPrice="$2"
  local size="${3:-1}"
  local contract="${4:-$DEFAULT_CONTRACT}"
  curl -s -X POST "$BASE/orders/place" -H "Content-Type: application/json" \
    -d "{\"accountId\":\"$ACCT\",\"contractId\":\"$contract\",\"type\":4,\"side\":$side,\"size\":$size,\"stopPrice\":$stopPrice}"
}

# Place limit order: limit buy|sell price [size]
limit() {
  local side=0
  [[ "$1" == "sell" ]] && side=1
  local limitPrice="$2"
  local size="${3:-1}"
  local contract="${4:-$DEFAULT_CONTRACT}"
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
  local contract="${6:-$DEFAULT_CONTRACT}"
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
  local contract="${5:-$DEFAULT_CONTRACT}"
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

# ─── Background Alerts ───────────────────────────────────────────────────────
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts"

# Price alert (background): alert_price <target> <above|below>
# Exits when price crosses target. Run in background.
alert_price() {
  bash "$SCRIPTS_DIR/price-alert.sh" "$1" "$2" "${3:-$DEFAULT_CONTRACT}"
}

# Order fill alert (background): alert_fill [accountId]
# Exits when any order fills or position changes. Run in background.
alert_fill() {
  bash "$SCRIPTS_DIR/order-fill-alert.sh" "${1:-$ACCT}"
}
