import { useCallback, useSyncExternalStore } from 'react';

// Minimal URL routing over the native History API.
//
// The app previously kept every navigable position in React state, so the URL
// was always "/" — the browser had a single history entry, Back left the app
// entirely, a refresh dropped you on the default tab, and nothing was linkable.
//
// This maps that same state to real paths. It is deliberately not react-router:
// the app renders by `view === '...'` conditionals rather than route components,
// so a parser plus a popstate listener covers it without restructuring anything
// or adding a dependency. nginx already serves index.html for unknown paths
// (`try_files $uri $uri/ /index.html`), so deep links work in production.
//
// ponytail: hand-rolled because there are ~13 states and no nested layouts.
// Switch to react-router if route guards, loaders, or nested outlets show up.

export type View =
  | 'database-dump'
  | 'running-apps'
  | 'security-scan'
  | 'wiki'
  | 'config'
  // Reachable by URL only — the nav entry is commented out in FolderTabs.
  | 'applications';

export type ConfigTab = 'infrastructure' | 'users' | 'scan-sources' | 'audit-logs';

// Wiki is the one section with its own sub-navigation worth linking to.
export type WikiRoute =
  | { kind: 'feed' }
  | { kind: 'post'; slug: string }
  | { kind: 'new' }
  | { kind: 'edit'; postId: string };

export interface Route {
  view: View;
  configTab: ConfigTab;
  wiki: WikiRoute;
  // Which server the Running Apps / Database Dump sections are looking at.
  // A query param rather than a path segment: it is a selection within a
  // section, not a resource of its own, and a stale id degrades to the server
  // picker instead of breaking the route.
  server: string | null;
}

export const DEFAULT_VIEW: View = 'database-dump';

const VIEWS: View[] = [
  'database-dump',
  'running-apps',
  'security-scan',
  'wiki',
  'config',
  'applications',
];
const CONFIG_TABS: ConfigTab[] = ['infrastructure', 'users', 'scan-sources', 'audit-logs'];

const isView = (s: string): s is View => (VIEWS as string[]).includes(s);
const isConfigTab = (s: string): s is ConfigTab => (CONFIG_TABS as string[]).includes(s);

/** Split a pathname into non-empty segments: "/config/users/" -> ["config","users"] */
const segments = (pathname: string): string[] => pathname.split('/').filter(Boolean);

export function parseRoute(pathname: string, search = ''): Route {
  const [first, second, third] = segments(pathname);
  const server = new URLSearchParams(search).get('server');

  const route: Route = {
    view: DEFAULT_VIEW,
    configTab: 'infrastructure',
    wiki: { kind: 'feed' },
    server: server || null,
  };

  if (!first || !isView(first)) return route; // "/" and anything unknown
  route.view = first;

  if (first === 'config' && second && isConfigTab(second)) {
    route.configTab = second;
  }

  if (first === 'wiki' && second) {
    if (second === 'new') {
      route.wiki = { kind: 'new' };
    } else if (third === 'edit') {
      route.wiki = { kind: 'edit', postId: second };
    } else {
      route.wiki = { kind: 'post', slug: second };
    }
  }

  return route;
}

export function buildPath(route: Route): string {
  switch (route.view) {
    case 'config':
      return `/config/${route.configTab}`;
    case 'wiki':
      switch (route.wiki.kind) {
        case 'post':
          return `/wiki/${route.wiki.slug}`;
        case 'new':
          return '/wiki/new';
        case 'edit':
          return `/wiki/${route.wiki.postId}/edit`;
        default:
          return '/wiki';
      }
    default:
      return `/${route.view}`;
  }
}

/** Full URL for a route, including the query string. */
export function buildUrl(route: Route): string {
  const path = buildPath(route);
  // Server selection only means something in the sections that have a picker.
  const carriesServer = route.view === 'running-apps' || route.view === 'database-dump';
  return carriesServer && route.server ? `${path}?server=${encodeURIComponent(route.server)}` : path;
}

// ---------------------------------------------------------------------------
// One shared store for the whole app.
//
// This is deliberately module-level rather than a useState inside the hook.
// App, Wiki, RunningApps and PostgresManager all call useRoute(); with per-hook
// state each would hold its own copy, so a navigation from one would leave the
// others stale — and App's URL-normalising effect would then "correct" the URL
// back to its own outdated idea of the route, undoing the navigation.
//
// useSyncExternalStore keeps every consumer on the same value without needing a
// context provider threaded through the tree.
// ---------------------------------------------------------------------------

let currentRoute: Route = parseRoute(window.location.pathname, window.location.search);
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => currentRoute;

// Back/forward: re-derive from whatever URL the browser restored.
window.addEventListener('popstate', () => {
  currentRoute = parseRoute(window.location.pathname, window.location.search);
  emit();
});

/**
 * Current route plus a navigate() that pushes real history entries, so Back and
 * Forward move within the app instead of leaving it.
 *
 * `replace` is for redirects that should not leave a history entry behind —
 * normalising "/" to the default view, or bouncing a non-admin off /config.
 * Without it, Back would land on the path we just redirected away from and
 * bounce forward again, trapping the user.
 */
export function useRoute() {
  const route = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const navigate = useCallback((patch: Partial<Route>, opts?: { replace?: boolean }) => {
    const next: Route = { ...currentRoute, ...patch };

    // Moving to a different section resets that section's sub-position, so
    // leaving a wiki post and coming back lands on the feed rather than
    // silently reopening the old post, and switching tabs does not drag the
    // previous section's server selection along.
    if (patch.view && patch.view !== currentRoute.view) {
      if (patch.view !== 'wiki' && !patch.wiki) next.wiki = { kind: 'feed' };
      if (!('server' in patch)) next.server = null;
    }

    const url = buildUrl(next);
    if (url !== window.location.pathname + window.location.search) {
      if (opts?.replace) window.history.replaceState({}, '', url);
      else window.history.pushState({}, '', url);
    }
    currentRoute = next;
    emit();
  }, []);

  return { route, navigate };
}
