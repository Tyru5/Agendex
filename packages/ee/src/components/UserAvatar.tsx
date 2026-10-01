import { useEffect, useState } from 'react';

const RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000];

/**
 * Profile photo with an initials fallback.
 *
 * The photo is a third-party OAuth avatar (GitHub / Google). A failed load is
 * never retried by the browser, so when the desktop app boots before the
 * network is reachable the `<img>` stays a broken-image icon for the whole
 * session. On error we show the initial instead and re-probe in the background
 * (on reconnect and with backoff), swapping the photo back in once it loads.
 *
 * `no-referrer`: Google's avatar CDN rejects some referrers (e.g. the desktop
 * app's `http://localhost:<port>` origin).
 */
export function UserAvatar({
  src,
  initial,
  className,
  fallbackClassName,
}: {
  src: string | null | undefined;
  initial: string;
  className: string;
  fallbackClassName: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = Boolean(src) && failedSrc === src;

  useEffect(() => {
    if (!src || failedSrc !== src) return;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let probe: HTMLImageElement | null = null;

    const retry = () => {
      clearTimeout(timer);
      if (probe) probe.onload = probe.onerror = null;
      probe = new Image();
      probe.referrerPolicy = 'no-referrer';
      probe.onload = () => setFailedSrc(null);
      probe.onerror = schedule;
      probe.src = src;
    };
    function schedule() {
      const delay = RETRY_DELAYS_MS[attempt++];
      if (delay !== undefined) timer = setTimeout(retry, delay);
    }

    schedule();
    window.addEventListener('online', retry);
    return () => {
      clearTimeout(timer);
      if (probe) probe.onload = probe.onerror = null;
      window.removeEventListener('online', retry);
    };
  }, [src, failedSrc]);

  if (!src || failed) {
    return <div className={fallbackClassName}>{initial}</div>;
  }
  return (
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      className={className}
      onError={() => setFailedSrc(src)}
    />
  );
}
