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
    <span className="plan-tag-chip">
      <span className="plan-tag-chip-dot" style={{ background: color || 'var(--tertiary)' }} />
      {name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="plan-tag-chip-remove"
        >
          ×
        </button>
      )}
    </span>
  );
}
