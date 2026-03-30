# Chat Bot

An AI-powered chat panel inside the trading terminal. Talk to it, ask it to draw levels, execute trades, or discuss price action strategy.

---

## Overview

A sliding chat panel (similar to the order panel) where the user can converse with an LLM. The bot has access to chart data, drawings, orders, and positions through tool use — it can both **discuss** and **act**.

Messages route through the Express proxy (`POST /api/chat`) which holds the API key server-side. The frontend never sees the key.

---

## Provider-Agnostic Design

The backend uses the **OpenAI SDK** pointed at a configurable base URL. Since most LLM providers now expose an OpenAI-compatible chat completions API, the same integration works across all of them:

| Provider | Base URL | Example Models | Cost |
|----------|----------|----------------|------|
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash`, `gemini-2.5-pro` | Generous free tier |
| Ollama (local) | `http://localhost:11434/v1` | `qwen3`, `llama4`, `mistral` | Free (runs on your GPU) |
| Alibaba Qwen | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `qwen3-max`, `qwen3-coder-plus` | ~$1.20/M input |
| OpenAI | `https://api.openai.com/v1` | `gpt-4.1-mini`, `gpt-4.1` | Pay-per-use |
| Anthropic | `https://api.anthropic.com/v1` | `claude-sonnet-4-20250514` | Pay-per-use |

Switching providers is a settings change — no code modifications needed.

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
The user can define their trading methodology in a system prompt (stored in settings). The model uses this as context for all feedback, so advice aligns with the user's own rules rather than generic guidance.

---

## Tools Exposed to the Model

### Read-only tools (always available)

| Tool | Purpose |
|------|---------|
| `get_bars(count)` | Read recent OHLCV candles |
| `get_drawings()` | See levels/drawings on the chart |
| `get_position()` | Current open position |
| `get_open_orders()` | All working orders |
| `get_trades_today()` | Session fill history |
| `get_current_price()` | Latest quote |
| `draw_level(price, color, label)` | Draw an HLine on the chart |

### Trading tools (require "Can Trade" toggle)

| Tool | Purpose |
|------|---------|
| `place_order(side, type, size, price)` | Submit an order (requires confirmation) |
| `cancel_order(orderId)` | Cancel a working order |
| `modify_order(orderId, price)` | Move an order |

A **"Can Trade"** checkbox in the chat panel toolbar controls whether trading tools are included in requests. When unchecked, these tools are **not sent to the model at all** — it cannot attempt to place, cancel, or modify orders. Defaults to off.

---

## Architecture

```
Browser (ChatPanel component)
    | POST /api/chat  { messages }
    v
Express proxy (API key from .env)
    | OpenAI SDK → configured base URL
    v
LLM responds (text + tool_call blocks)
    | tool calls returned to frontend
    v
Frontend executes tool calls against existing services
    | orderService, drawing store, marketDataService
    v
Results sent back as tool_result in next request
```

---

## Chat Persistence

Conversations are stored on disk under `backend/data/chats/`:

```
data/chats/
  index.json          — list of conversations (id, title, createdAt, updatedAt)
  {id}.json           — full message history for one conversation
```

Backend routes:
- `GET /api/chats` — list all conversations
- `GET /api/chats/:id` — load a conversation
- `DELETE /api/chats/:id` — delete a conversation
- Conversations are created/updated automatically as the user chats.

---

## Configuration

- **API key** — stored in `.env` file (`LLM_API_KEY`), never exposed to the browser
- **Base URL** — configurable in settings (determines which provider is used)
- **Model** — configurable in settings (e.g. `gemini-2.5-flash`, `qwen3-max`, `gpt-4.1-mini`)
- **System prompt** — user-editable trading methodology, persisted in `user-settings.json`
