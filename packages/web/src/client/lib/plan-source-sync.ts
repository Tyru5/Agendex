export type PlanSourcesResponse = { customPlanDirs: string[] };

export type PlanSourcesClient = {
  getPlanSources: () => Promise<PlanSourcesResponse>;
  removePlanSource: (path: string) => Promise<PlanSourcesResponse>;
};

export type PlanSourceSync = {
  /** Re-reads the configured sources, e.g. after the sources dialog mutated them. */
  refresh: () => Promise<void>;
  remove: (dir: string) => Promise<void>;
  dispose: () => void;
};

/**
 * Serializes plan-source reads and mutations onto a single FIFO queue so the
 * caller always converges on the server's latest snapshot: a request is only
 * issued once the previous one settled, so no response can be superseded by an
 * older one and none has to be discarded. A failed operation rejects for its own
 * caller without stalling the queue.
 */
export function createPlanSourceSync(
  client: PlanSourcesClient,
  onSnapshot: (dirs: string[]) => void,
): PlanSourceSync {
  let queue: Promise<unknown> = Promise.resolve();
  let disposed = false;

  function enqueue(request: () => Promise<PlanSourcesResponse>): Promise<void> {
    const settled = queue.then(async () => {
      if (disposed) return;
      const res = await request();
      if (!disposed) onSnapshot([...res.customPlanDirs]);
    });
    queue = settled.catch(() => {});
    return settled;
  }

  return {
    refresh: () => enqueue(() => client.getPlanSources()),
    remove: (dir: string) => enqueue(() => client.removePlanSource(dir)),
    dispose: () => {
      disposed = true;
    },
  };
}
