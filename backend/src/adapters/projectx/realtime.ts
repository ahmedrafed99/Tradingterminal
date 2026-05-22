/**
 * ProjectX realtime — previously a SignalR proxy.
 *
 * SignalR is now owned by backend/src/services/realtimeService.ts which holds
 * the sole connection and forwards events to frontend clients via /ws/realtime.
 * This file is retained only so the adapter registry and ExchangeAdapter shape
 * still compile; no proxy logic remains here.
 */

export const projectXRealtime = undefined;
