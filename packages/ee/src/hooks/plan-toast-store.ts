type ClearAllHandler = () => void;

let activeCount = 0;
let clearAllHandler: ClearAllHandler | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const cb of listeners) cb();
}

export function subscribePlanToastStore(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getActivePlanToastCount(): number {
  return activeCount;
}

export function setActivePlanToastCount(count: number): void {
  const next = Math.max(0, count);
  if (next === activeCount) return;
  activeCount = next;
  emit();
}

export function registerClearAllPlanToasts(handler: ClearAllHandler | null): void {
  clearAllHandler = handler;
}

export function clearAllPlanToasts(): void {
  clearAllHandler?.();
}
