export function TagChip({
  name,
  color,
  onRemove,
}: {
  name: string;
  color?: string;
  onRemove?: () => void;
}) {
  return (
    <span
      className="flex items-center gap-1"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        fontSize: '11.5px',
        fontWeight: 500,
        fontFamily: 'inherit',
        borderRadius: '5px',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        color: 'var(--text)',
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: color || 'var(--tertiary)',
          flexShrink: 0,
        }}
      />
      {name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          style={{
            padding: 0,
            border: 'none',
            background: 'transparent',
            color: 'var(--tertiary)',
            cursor: 'pointer',
            fontSize: '13px',
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
            marginLeft: '2px',
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}
