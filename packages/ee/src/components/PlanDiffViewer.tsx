import { useMemo } from 'react';

type DiffLine = {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
};

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const m = oldLines.length;
  const n = newLines.length;

  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = new Array(n + 1).fill(0);
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'unchanged', content: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'added', content: newLines[j - 1] });
      j--;
    } else {
      result.unshift({ type: 'removed', content: oldLines[i - 1] });
      i--;
    }
  }

  return result;
}

const lineStyles: Record<DiffLine['type'], React.CSSProperties> = {
  added: {
    background: 'rgba(34,197,94,0.10)',
    color: '#16a34a',
  },
  removed: {
    background: 'rgba(239,68,68,0.10)',
    color: '#ef4444',
    textDecoration: 'line-through',
    textDecorationColor: 'rgba(239,68,68,0.3)',
  },
  unchanged: {
    color: 'var(--tertiary)',
  },
};

const prefixes: Record<DiffLine['type'], string> = {
  added: '+',
  removed: '-',
  unchanged: ' ',
};

export function PlanDiffViewer({
  oldContent,
  newContent,
}: {
  oldContent: string;
  newContent: string;
}) {
  const lines = useMemo(() => computeDiff(oldContent, newContent), [oldContent, newContent]);

  const hasChanges = lines.some((l) => l.type !== 'unchanged');

  if (!hasChanges) {
    return (
      <div
        style={{
          padding: '20px',
          fontSize: '12.5px',
          color: 'var(--tertiary)',
          textAlign: 'center',
        }}
      >
        No differences between these versions.
      </div>
    );
  }

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: '8px',
        overflow: 'hidden',
        fontSize: '12.5px',
        fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
        lineHeight: 1.6,
      }}
    >
      {lines.map((line, idx) => (
        <div
          key={idx}
          style={{
            padding: '1px 12px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            borderBottom: idx < lines.length - 1 ? '1px solid rgba(128,128,128,0.06)' : undefined,
            ...lineStyles[line.type],
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: '16px',
              textAlign: 'center',
              marginRight: '8px',
              opacity: 0.6,
              userSelect: 'none',
            }}
          >
            {prefixes[line.type]}
          </span>
          {line.content || '\u00A0'}
        </div>
      ))}
    </div>
  );
}
