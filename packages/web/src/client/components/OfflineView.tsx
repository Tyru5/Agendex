import { useEffect, useState } from 'react';

export function OfflineView() {
  const [elapsed, setElapsed] = useState(0);
  const [dots, setDots] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed((e) => e + 1);
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timestamp = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return (
    <div className="offline-view">
      <div className="offline-scan-line" />
      <div className="offline-noise" />

      <div className="offline-content">
        <div className="offline-signal">
          <svg viewBox="0 0 48 48" fill="none" className="offline-signal-icon">
            <path d="M24 36h.02" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
            <path
              d="M18.36 30.36a8 8 0 0 1 11.28 0"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              className="offline-signal-ring-1"
            />
            <path
              d="M12.72 24.72a16 16 0 0 1 22.56 0"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              className="offline-signal-ring-2"
            />
            <path
              d="M7.08 19.08a24 24 0 0 1 33.84 0"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              className="offline-signal-ring-3"
            />
            <line
              x1="10"
              y1="10"
              x2="38"
              y2="38"
              stroke="var(--offline-accent)"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="offline-signal-slash"
            />
          </svg>
        </div>

        <div className="offline-badge">CONNECTION LOST</div>

        <h2 className="offline-title">Local server unreachable</h2>

        <p className="offline-desc">
          The Agendex daemon isn't responding. Plans will reload automatically when it reconnects.
        </p>

        <div className="offline-diagnostics">
          <div className="offline-diag-row">
            <span className="offline-diag-label">STATUS</span>
            <span className="offline-diag-value offline-diag-alert">Disconnected</span>
          </div>
          <div className="offline-diag-row">
            <span className="offline-diag-label">POLLING</span>
            <span className="offline-diag-value">Every 5s{dots}</span>
          </div>
          <div className="offline-diag-row">
            <span className="offline-diag-label">ELAPSED</span>
            <span className="offline-diag-value offline-diag-mono">{timestamp}</span>
          </div>
        </div>

        <div className="offline-hint">
          <span className="offline-hint-icon">
            <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
              <path
                d="M8 1.33a6.67 6.67 0 1 0 0 13.34A6.67 6.67 0 0 0 8 1.33ZM8 5v3.33M8 10.67h.007"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>
            Run <code>agendex start</code> or <code>bun run dev</code> to reconnect
          </span>
        </div>
      </div>
    </div>
  );
}
