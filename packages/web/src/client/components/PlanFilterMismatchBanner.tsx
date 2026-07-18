export function PlanFilterMismatchBanner({
  onShowInFilters,
  onKeepViewing,
}: {
  onShowInFilters: () => void;
  onKeepViewing: () => void;
}) {
  return (
    <div className="plan-filter-mismatch-banner" role="status">
      <span className="plan-filter-mismatch-dot" aria-hidden="true" />
      <span className="plan-filter-mismatch-label">Not in current filters</span>
      <div className="plan-filter-mismatch-actions">
        <button type="button" className="plan-filter-mismatch-action" onClick={onShowInFilters}>
          Show in filters
        </button>
        <button
          type="button"
          className="plan-filter-mismatch-action plan-filter-mismatch-action--muted"
          onClick={onKeepViewing}
        >
          Keep viewing
        </button>
      </div>
    </div>
  );
}
