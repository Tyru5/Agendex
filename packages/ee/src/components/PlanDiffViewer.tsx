import { useMemo } from 'react';

type DiffLine = {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
};

// Myers' diff algorithm — O(n*d) time, O(n) space
function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const n = oldLines.length;
  const m = newLines.length;
  const max = n + m;

  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const idx = k + max;
      let x: number;
      if (k === -d || (k !== d && v[idx - 1]! < v[idx + 1]!)) {
        x = v[idx + 1]!;
      } else {
        x = v[idx - 1]! + 1;
      }
      let y = x - k;
      while (x < n && y < m && oldLines[x] === newLines[y]) {
        x++;
        y++;
      }
      v[idx] = x;
      if (x >= n && y >= m) {
        const result: DiffLine[] = [];
        let cx = n;
        let cy = m;
        for (let bd = d; bd > 0; bd--) {
          const prev = trace[bd - 1]!;
          const bk = cx - cy;
          const bIdx = bk + max;
          let px: number;
          if (bk === -bd || (bk !== bd && prev[bIdx - 1]! < prev[bIdx + 1]!)) {
            px = prev[bIdx + 1]!;
          } else {
            px = prev[bIdx - 1]! + 1;
          }
          const py = px - bk;
          while (cx > px && cy > py) {
            cx--;
            cy--;
            result.push({ type: 'unchanged', content: oldLines[cx]! });
          }
          if (cx > px) {
            cx--;
            result.push({ type: 'removed', content: oldLines[cx]! });
          } else if (cy > py) {
            cy--;
            result.push({ type: 'added', content: newLines[cy]! });
          }
        }
        while (cx > 0 && cy > 0) {
          cx--;
          cy--;
          result.push({ type: 'unchanged', content: oldLines[cx]! });
        }
        result.reverse();
        return result;
      }
    }
  }

  return [];
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
      <div className="p-5 text-[12.5px] text-tertiary text-center">
        No differences between these versions.
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden text-[12.5px] font-['SF_Mono','JetBrains_Mono',monospace] leading-[1.6]">
      {lines.map((line, idx) => (
        <div
          key={idx}
          className="px-3 py-px whitespace-pre-wrap break-words"
          style={{
            borderBottom: idx < lines.length - 1 ? '1px solid rgba(128,128,128,0.06)' : undefined,
            ...lineStyles[line.type],
          }}
        >
          <span className="inline-block w-4 text-center mr-2 opacity-60 select-none">
            {prefixes[line.type]}
          </span>
          {line.content || '\u00A0'}
        </div>
      ))}
    </div>
  );
}
