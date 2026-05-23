type DocumentWithViewTransitions = Document & {
  startViewTransition?: (cb: () => void) => unknown;
};

export function withViewTransition(update: () => void): void {
  if (typeof document === 'undefined') {
    update();
    return;
  }
  const doc = document as DocumentWithViewTransitions;
  if (typeof doc.startViewTransition === 'function') {
    doc.startViewTransition(update);
  } else {
    update();
  }
}
