import { type ComponentProps, Suspense } from 'react';
import { lazyWithPreload } from '../lib/lazy-with-preload.ts';
import { SkeletonBlock } from './Skeleton.tsx';

const PlanViewerChunk = lazyWithPreload(() => import('./PlanViewer.tsx').then((m) => m.PlanViewer));

/**
 * Starts downloading the plan viewer, e.g. alongside a dashboard's own chunk
 * so the viewer is ready by the time plan data arrives. Never rejects.
 */
export function preloadPlanViewer(): Promise<unknown> {
  return PlanViewerChunk.preload().catch(() => undefined);
}

/**
 * `PlanViewer`, loaded on demand. The viewer carries the whole markdown
 * pipeline (parser, raw-HTML support, sanitizer, syntax highlighting), which
 * is most of a dashboard's JavaScript; splitting it out lets the dashboard
 * shell render first.
 */
export function LazyPlanViewer(props: ComponentProps<typeof PlanViewerChunk>) {
  return (
    <Suspense
      fallback={
        <div className="plan-viewer-frame" aria-busy="true">
          <div className="plan-viewer-content">
            <SkeletonBlock lines={8} />
          </div>
        </div>
      }
    >
      <PlanViewerChunk {...props} />
    </Suspense>
  );
}
