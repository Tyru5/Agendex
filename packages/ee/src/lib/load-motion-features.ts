/**
 * Async feature loader for `<LazyMotion>`. Kept apart from the features module
 * itself: a static import of that module would pull the animation engine back
 * into the importing chunk.
 */
export const loadMotionFeatures = () => import('./motion-features.ts').then((m) => m.default);
