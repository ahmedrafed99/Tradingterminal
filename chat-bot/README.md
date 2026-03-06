# Chat Bot

An AI-powered chat panel inside the trading terminal. Talk to it, ask it to draw levels, execute trades, or discuss price action strategy.

---

## Overview

A sliding chat panel (similar to the order panel) where the user can converse with Claude. The bot has access to chart data, drawings, orders, and positions through tool use — it can both **discuss** and **act**.

Messages route through the Express proxy (`POST /api/chat`) which holds the Anthropic API key server-side. The frontend never sees the key.

---

## Capabilities

### Execution
- **Draw levels** — mark support/resistance lines on the chart (`HLineDrawing`)
- **Place orders** — market, limit, stop (with user confirmation before execution)
- **Cancel/modify orders** — adjust or remove open orders
- **Read state** — current position, open orders, recent bars, drawn levels

### Analysis & Discussion
- Analyze recent price action using OHLCV bar data
- Comment on user-drawn levels (strength, validity, R:R)
- Review session trades and spot behavioral patterns
- Discuss methodology — Wyckoff, ICT, supply/demand, whatever the user trades

### Custom System Prompt
The user can define their trading methodology in a system prompt (stored in settings). Claude uses this as context for all feedback, so advice aligns with the user's own rules rather than generic guidance.

---

## Tools Exposed to Claude

| Tool | Purpose |
|------|---------|
| `get_bars(count)` | Read recent OHLCV candles |
| `get_drawings()` | See levels/drawings on the chart |
| `get_position()` | Current open position |
| `get_open_orders()` | All working orders |
| `get_trades_today()` | Session fill history |
| `get_current_price()` | Latest quote |
| `draw_level(price, color, label)` | Draw an HLine on the chart |
| `place_order(side, type, size, price)` | Submit an order (requires confirmation) |
| `cancel_order(orderId)` | Cancel a working order |
| `modify_order(orderId, price)` | Move an order |

---

## Architecture

```
Browser (ChatPanel component)
    | POST /api/chat  { messages, tools }
    v
Express proxy (ANTHROPIC_API_KEY in env)
    | Anthropic SDK — Claude API with tool definitions
    v
Claude responds (text + tool_use blocks)
    | tool calls returned to frontend
    v
Frontend executes tool calls against existing services
    | orderService, drawing store, marketDataService
    v
Results sent back as tool_result in next request
```

---

## Configuration

- **Anthropic API key** — added to the settings modal alongside the trading API key, stored server-side only
- **Model** — Claude Sonnet (default) or Opus for deeper analysis
- **System prompt** — user-editable trading methodology, persisted in settings
