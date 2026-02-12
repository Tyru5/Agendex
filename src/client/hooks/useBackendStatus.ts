import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';

export type BackendStatus = 'checking' | 'online' | 'offline';

const DEFAULT_POLL_INTERVAL_MS = 5000;

export function useBackendStatus(pollIntervalMs = DEFAULT_POLL_INTERVAL_MS) {
  const [status, setStatus] = useState<BackendStatus>('checking');
  const checkingRef = useRef(false);

  const checkBackend = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;

    try {
      await api.getHealth();
      setStatus('online');
    } catch (error) {
      if (error instanceof Error && error.message === 'unauthorized') return;
      setStatus('offline');
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void checkBackend();
    const intervalId = window.setInterval(() => {
      void checkBackend();
    }, pollIntervalMs);

    return () => window.clearInterval(intervalId);
  }, [checkBackend, pollIntervalMs]);

  useEffect(() => {
    function checkWhenVisible() {
      if (document.visibilityState === 'visible') {
        void checkBackend();
      }
    }

    function checkOnFocus() {
      void checkBackend();
    }

    document.addEventListener('visibilitychange', checkWhenVisible);
    window.addEventListener('focus', checkOnFocus);
    return () => {
      document.removeEventListener('visibilitychange', checkWhenVisible);
      window.removeEventListener('focus', checkOnFocus);
    };
  }, [checkBackend]);

  return status;
}
