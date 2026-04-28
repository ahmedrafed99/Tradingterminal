import TelegramBot from 'node-telegram-bot-api';
import { listConnected, getAdapter, removeAdapter, getDefaultExchangeId } from '../adapters/registry';
import { broadcast } from './eventsService';

let bot: TelegramBot | null = null;

function handleDisconnect(chatId: number): void {
  const connected = listConnected();
  if (connected.length === 0) {
    bot!.sendMessage(chatId, 'Already disconnected.');
    return;
  }
  for (const id of connected) {
    getAdapter(id).auth.disconnect();
    removeAdapter(id);
  }
  broadcast({ type: 'disconnect' });
  bot!.sendMessage(chatId, `Disconnected from: ${connected.join(', ')}`);
}

function handleStatus(chatId: number): void {
  const connected = listConnected();
  if (connected.length === 0) {
    bot!.sendMessage(chatId, 'Status: Not connected.');
    return;
  }
  const defaultId = getDefaultExchangeId();
  const lines = connected.map((id) => {
    const status = getAdapter(id).auth.getStatus();
    const label = id === defaultId ? `${id} (default)` : id;
    return `• ${label}: ${JSON.stringify(status)}`;
  });
  bot!.sendMessage(chatId, `Status: Connected\n${lines.join('\n')}`);
}

export function start(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  bot = new TelegramBot(token, { polling: true });

  bot.on('polling_error', (err) => {
    console.error('[telegram] Polling error:', err.message);
  });

  bot.onText(/\/disconnect/, (msg) => {
    handleDisconnect(msg.chat.id);
  });

  bot.onText(/\/status/, (msg) => {
    handleStatus(msg.chat.id);
  });

  console.log('[telegram] Bot started.');
}

export function stop(): void {
  if (bot) {
    bot.stopPolling();
    bot = null;
  }
}
