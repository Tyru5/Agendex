import type { CSSProperties, ReactNode } from 'react';

type PlanActionButtonProps = {
  readonly label: string;
  readonly tooltip?: string;
  readonly pressed?: boolean;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly children: ReactNode;
  readonly style?: CSSProperties;
  readonly controls?: string;
  readonly expanded?: boolean;
  readonly hasPopup?: 'dialog' | 'grid' | 'listbox' | 'menu' | 'tree';
};

export function PlanActionButton({
  label,
  tooltip = label,
  pressed,
  disabled,
  onClick,
  children,
  style,
  controls,
  expanded,
  hasPopup,
}: PlanActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={typeof pressed === 'boolean' ? pressed : undefined}
      aria-controls={controls}
      aria-expanded={typeof expanded === 'boolean' ? expanded : undefined}
      aria-haspopup={hasPopup}
      disabled={disabled}
      data-tooltip={tooltip}
      className="plan-action-button"
      style={style}
    >
      {children}
    </button>
  );
}
