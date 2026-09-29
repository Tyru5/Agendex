import type { PlanReceiptStatus } from '@agendex/shared/receipts';

/** Shape-coded status glyph, always paired with a text label so status never rests on color. */
export function ReceiptStatusIcon({
  status,
  size = 12,
}: {
  status: PlanReceiptStatus;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="receipt-status-icon"
    >
      {status === 'planned' ? (
        <circle cx="8" cy="8" r="6" strokeDasharray="2.4 2.2" />
      ) : (
        <circle cx="8" cy="8" r="6" />
      )}
      {status === 'landed' && <path d="M5.4 8.2l1.8 1.8 3.4-3.7" />}
      {status === 'in-progress' && <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" />}
      {status === 'stalled' && <path d="M6.6 6v4M9.4 6v4" />}
      {status === 'unavailable' && <path d="M4 12l8-8" />}
    </svg>
  );
}
