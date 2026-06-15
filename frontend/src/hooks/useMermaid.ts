import { useEffect, type RefObject } from 'react';

// useMermaid — turns the <pre class="mermaid"> blocks emitted by the markdown
// renderer into real SVG diagrams. Mermaid is ~500KB, so it's dynamically
// imported only when a rendered post actually contains a diagram — it never
// touches the main bundle otherwise.
//
// `dep` should be whatever changes the rendered HTML (e.g. the html string), so
// the diagrams re-render when the content does. Theme is read from the live DOM
// so light/dark match without prop-threading.
export function useMermaid(ref: RefObject<HTMLElement>, dep: unknown): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>('pre.mermaid:not([data-processed])'));
    if (nodes.length === 0) return;

    let cancelled = false;
    const isDark =
      document.documentElement.classList.contains('dark') ||
      document.body.classList.contains('dark');

    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        if (cancelled) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: isDark ? 'dark' : 'default',
          fontFamily: 'inherit',
        });
        await mermaid.run({ nodes });
      } catch (err) {
        // A malformed diagram throws — leave the raw source visible rather than
        // blanking the page.
        console.warn('[mermaid] render failed:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ref, dep]);
}
