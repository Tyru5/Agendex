/** Share initialization between callers, retaining success but allowing failed attempts to retry. */
export function createRetryableReadiness(initialize: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | undefined;
  return () => {
    if (!pending) {
      pending = Promise.resolve()
        .then(initialize)
        .catch((error: unknown) => {
          pending = undefined;
          throw error;
        });
    }
    return pending;
  };
}
