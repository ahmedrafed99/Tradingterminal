# Telegram Bot

Remote control of the trading terminal via Telegram. Send commands to disconnect the session or check connection status from anywhere.

---

## Setup

1. Create a bot via [@BotFather](https://t.me/BotFather) and copy the token
2. Add to `backend/.env`:

```env
TELEGRAM_BOT_TOKEN=your-bot-token
```

The bot starts automatically with the backend. No webhook or public URL needed — it uses long polling.

---

## Commands

| Command | Description |
|---------|-------------|
| `/disconnect` | Disconnects all exchanges — identical to clicking Disconnect in Settings |
| `/status` | Shows current connection state and exchange info |

---

## Architecture

```
Telegram → bot polling → telegramBot.ts
                              |
                    registry: disconnect adapters
                              |
                    eventsService: broadcast { type: 'disconnect' }
                              |
                    ws://localhost:3001/ws/events
                              |
                    App.tsx WebSocket listener
                              |
                    realtimeService.disconnect() + store reset
```

The frontend holds a persistent WebSocket connection to `/ws/events`. When the bot triggers a disconnect, the backend broadcasts the event and the UI tears down instantly — same result as clicking disconnect in Settings.

---

## Files

| File | Role |
|------|------|
| `backend/src/services/telegramBot.ts` | Bot instance, command handlers |
| `backend/src/services/eventsService.ts` | WebSocket broadcaster (backend → frontend) |
| `backend/src/index.ts` | Wires up `/ws/events` upgrade + starts/stops bot |
| `frontend/src/App.tsx` | Listens on `/ws/events` and reacts to disconnect event |