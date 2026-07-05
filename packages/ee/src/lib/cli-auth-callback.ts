export type CliAuthCallbackRejectReason = 'bad-url' | 'non-loopback-callback';

export type CliAuthCallback =
  | {
      readonly ok: true;
      readonly callbackUrl: string;
    }
  | {
      readonly ok: false;
      readonly reason: CliAuthCallbackRejectReason;
    };

export function parseCliAuthCallback(callbackUrl: string): CliAuthCallback {
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch (error) {
    if (error instanceof TypeError) return { ok: false, reason: 'bad-url' };
    throw error;
  }

  if (url.protocol !== 'http:' || !isLoopbackHost(url.hostname)) {
    return { ok: false, reason: 'non-loopback-callback' };
  }

  return { ok: true, callbackUrl };
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}
