/** Apply completed reads in request order without starving slow responses. */
export function createOrderedRefresh<T>(
  load: () => Promise<T>,
  apply: (value: T) => void,
  onError: (error: unknown) => void,
) {
  let requested = 0;
  let applied = 0;
  return {
    async refresh() {
      const version = ++requested;
      try {
        const value = await load();
        if (version < applied) return;
        applied = version;
        apply(value);
      } catch (error) {
        if (version < applied) return;
        applied = version;
        onError(error);
      }
    },
    invalidate() {
      applied = ++requested;
    },
  };
}
