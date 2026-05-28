import { useEffect, useState } from 'react';

// useTheme reads the current theme from the `.dark` class on <html> (set by
// App.tsx) and updates whenever that class changes. Use this when a component
// needs to switch between light/dark palettes from JS (e.g. inline styles with
// hardcoded hex colors that can't use Tailwind's `dark:` modifier).
export type Theme = 'light' | 'dark';

const readTheme = (): Theme =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light';

export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    // Re-read on every class mutation — App.tsx toggles `.dark` on this element.
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}
