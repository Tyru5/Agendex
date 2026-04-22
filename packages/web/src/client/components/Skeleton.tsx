interface SkeletonProps {
  width?: string;
  height?: string;
  borderRadius?: string;
  style?: React.CSSProperties;
}

export function Skeleton({
  width = '100%',
  height = '14px',
  borderRadius = '6px',
  style,
}: SkeletonProps) {
  return (
    <div
      className="skeleton-pulse bg-border"
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
    />
  );
}

export function SkeletonLine({ width = '100%' }: { width?: string }) {
  return <Skeleton width={width} height="12px" />;
}

export function SkeletonBlock({ lines = 3 }: { lines?: number }) {
  const widths = ['100%', '92%', '78%', '85%', '60%'];
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: lines }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton lines never reorder
        <SkeletonLine key={i} width={widths[i % widths.length]} />
      ))}
    </div>
  );
}
