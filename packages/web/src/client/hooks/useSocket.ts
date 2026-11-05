import { useCallback, useEffect, useRef } from 'react';

type Listener = (data: unknown) => void;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

const listeners = new Map<string, Set<Listener>>();
let socket: WebSocket | null = null;
let refCount = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;

function debugLog(...args: unknown[]) {
  if (import.meta.env.DEV) console.log(...args);
}

/**
 * Full-jitter exponential backoff: a random delay in [0, min(cap, base * 2^attempt)],
 * floored at the base so a flapping server is never hammered.
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, attempt));
  return Math.max(RECONNECT_BASE_MS, Math.round(random() * ceiling));
}

function getWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const token = localStorage.getItem('agendex_token');
  const base = import.meta.env.DEV
    ? `${proto}://${location.hostname}:4890`
    : `${proto}://${location.host}`;
  return `${base}/api/v1/ws?token=${encodeURIComponent(token ?? '')}`;
}

function detach(ws: WebSocket) {
  ws.onopen = null;
  ws.onmessage = null;
  ws.onclose = null;
  ws.onerror = null;
}

function scheduleReconnect() {
  if (refCount === 0 || reconnectTimer) return;
  const delay = reconnectDelay(reconnectAttempt);
  reconnectAttempt++;
  debugLog(`[ws] reconnecting in ${delay}ms`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;

  const url = getWsUrl();
  debugLog('[ws] connecting to', url.replace(/token=[^&]+/, 'token=***'));
  const ws = new WebSocket(url);
  socket = ws;

  ws.onopen = () => {
    debugLog('[ws] connected');
    reconnectAttempt = 0;
    const fns = listeners.get('connection');
    if (fns) for (const fn of fns) fn(undefined);
  };

  ws.onmessage = (e) => {
    try {
      msgCount++;
      const msg = JSON.parse(e.data) as { event: string; data: unknown };
      debugLog('[ws] event:', msg.event);
      const fns = listeners.get(msg.event);
      if (fns) for (const fn of fns) fn(msg.data);
    } catch {
      // ignore malformed messages
    }
  };

  ws.onclose = () => {
    debugLog('[ws] disconnected');
    detach(ws);
    if (socket === ws) socket = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    debugLog('[ws] error');
    ws.close();
  };
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempt = 0;
  if (socket) {
    // Detach first so the stale socket's close event cannot schedule a reconnect.
    detach(socket);
    socket.close();
  }
  socket = null;
}

let msgCount = 0;
if (import.meta.env.DEV) {
  // @ts-expect-error debug
  window.__wsDebug = () => ({
    readyState: socket?.readyState,
    refCount,
    listeners: [...listeners.keys()],
    msgCount,
    reconnectAttempt,
  });
}

export function useSocketEvent(event: string, handler: () => void, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const stableHandler = useCallback((_data: unknown) => {
    handlerRef.current();
  }, []);

  useEffect(() => {
    if (!enabled) return;

    refCount++;
    if (refCount === 1) connect();

    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(stableHandler);

    return () => {
      set?.delete(stableHandler);
      if (set?.size === 0) listeners.delete(event);
      refCount--;
      if (refCount === 0) disconnect();
    };
  }, [event, stableHandler, enabled]);
}
