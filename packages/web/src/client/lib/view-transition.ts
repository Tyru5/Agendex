export function startViewTransition(callback: () => void) {
  if ('startViewTransition' in document) {
    (document as unknown as { startViewTransition: (cb: () => void) => void }).startViewTransition(
      callback,
    );
  } else {
    callback();
  }
}
