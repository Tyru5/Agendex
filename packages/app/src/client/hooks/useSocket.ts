import { useCallback, useEffect, useRef } from 'react';

type Listener = (data: unknown) => void;

const listeners = new Map<string, Set<Listener>>();
let socket: WebSocket | null = null;
let refCount = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function getWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const token = localStorage.getItem('agendex_token');
  const base = import.meta.env.DEV
    ? `${proto}://${location.hostname}:4890`
    : `${proto}://${location.host}`;
  return `${base}/api/v1/ws?token=${encodeURIComponent(token ?? '')}`;
}

function connect() {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;

  const url = getWsUrl();
  console.log('[ws] connecting to', url.replace(/token=[^&]+/, 'token=***'));
  socket = new WebSocket(url);

  socket.onopen = () => {
    console.log('[ws] connected');
    const fns = listeners.get('connection');
    if (fns) for (const fn of fns) fn(undefined);
  };

  socket.onmessage = (e) => {
    try {
      msgCount++;
      const msg = JSON.parse(e.data) as { event: string; data: unknown };
      console.log('[ws] event:', msg.event);
      const fns = listeners.get(msg.event);
      if (fns) for (const fn of fns) fn(msg.data);
    } catch {
      // ignore malformed messages
    }
  };

  socket.onclose = () => {
    console.log('[ws] disconnected');
    if (refCount > 0) {
      reconnectTimer = setTimeout(connect, 3000);
    }
  };

  socket.onerror = () => {
    console.log('[ws] error');
    socket?.close();
  };
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  socket?.close();
  socket = null;
}

let msgCount = 0;
// @ts-expect-error debug
window.__wsDebug = () => ({
  readyState: socket?.readyState,
  refCount,
  listeners: [...listeners.keys()],
  msgCount,
});

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
