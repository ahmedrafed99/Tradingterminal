# Claude Trading Strategies

Algorithmic strategies for NQ (Nasdaq-100 futures) backtested against 5.78M 1-minute candles.

## Strategy Index

| Strategy | Pass% | Blow% | Max DD | Median Days | Contracts |
|----------|-------|-------|--------|-------------|-----------|
| [London Sniper 5:1](londonSniper/README.md) | **53.1%** | **0%** | **$1,764** | 12d | 18 MNQ |

## Shared Specs

- **Instrument**: MNQ (Micro NQ Futures), $2/point per contract
- **Timeframe**: 1-minute candle data
- **Session**: RTH only (9:30am–4:00pm ET)
- **Execution**: Fully mechanical — no discretion needed
- **Consistency rule**: All configs pass the 50% single-trade cap
- **Data source**: `backend/data/candles.db`
