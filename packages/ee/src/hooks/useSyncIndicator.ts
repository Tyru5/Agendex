import { useEffect, useRef, useState } from 'react';

const MIN_DISPLAY_MS = 2000;

export function useSyncIndicator(plans: { id: string; updatedAt: string }[], loading: boolean) {
  const [isSyncing, setIsSyncing] = useState(false);
  const prevFingerprint = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fingerprint = loading
    ? null
    : `${plans.length}:${plans.reduce((max, p) => (p.updatedAt > max ? p.updatedAt : max), '')}`;

  useEffect(() => {
    if (fingerprint === null) return;

    if (prevFingerprint.current === null) {
      prevFingerprint.current = fingerprint;
      return;
    }

    if (fingerprint !== prevFingerprint.current) {
      prevFingerprint.current = fingerprint;
      setIsSyncing(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setIsSyncing(false), MIN_DISPLAY_MS);
    }

    return () => clearTimeout(timerRef.current);
  }, [fingerprint]);

  return isSyncing;
}
