import WebSocket from 'ws';

const clients = new Set<WebSocket>();

export function addClient(ws: WebSocket): void {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
}

export function broadcast(event: Record<string, unknown>): void {
  const payload = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}
