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
    <span className="inline-flex items-center gap-1 py-0.5 px-2 text-[11.5px] font-medium font-[inherit] rounded-[5px] border border-border bg-surface text-text leading-[1.4] whitespace-nowrap">
      <span
        className="w-[7px] h-[7px] rounded-full shrink-0"
        style={{ background: color || 'var(--tertiary)' }}
      />
      {name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="p-0 border-none bg-transparent text-tertiary cursor-pointer text-[13px] leading-none flex items-center ml-0.5"
        >
          ×
        </button>
      )}
    </span>
  );
}
