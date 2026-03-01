import { useCallback, useEffect, useRef, useState } from 'react';

export type BackendStatus = 'checking' | 'online' | 'offline';

const DEFAULT_POLL_INTERVAL_MS = 5000;

export function useBackendStatus(pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, enabled = true) {
  const [status, setStatus] = useState<BackendStatus>(enabled ? 'checking' : 'offline');
  const checkingRef = useRef(false);

  const checkBackend = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;

    try {
      const res = await fetch('/api/v1/health');
      setStatus(res.ok ? 'online' : 'offline');
    } catch {
      setStatus('offline');
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus('offline');
      return;
    }
    void checkBackend();
    const intervalId = window.setInterval(() => {
      void checkBackend();
    }, pollIntervalMs);

    return () => window.clearInterval(intervalId);
  }, [checkBackend, pollIntervalMs, enabled]);

  useEffect(() => {
    if (!enabled) return;

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
  }, [checkBackend, enabled]);

  return status;
}
