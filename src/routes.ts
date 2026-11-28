// Single route registry: the URL parser and the navigation shell both read
// this list. Add a route here, never in two places.
export type NavRoute =
  | '/'
  | '/recovery'
  | '/vault'
  | '/consent'
  | '/claims'
  | '/compliance'
  | '/workforce'
  | '/network'
  | '/leakage'
  | '/intake'
  | '/investigator'
  | '/see-worked-case-example';

export const ROUTE_REGISTRY: Array<{ route: NavRoute; prefix?: boolean }> = [
  { route: '/' },
  { route: '/intake' },
  { route: '/claims' },
  { route: '/investigator' },
  { route: '/network' },
  { route: '/leakage' },
  { route: '/recovery' },
  { route: '/vault' },
  { route: '/consent' },
  { route: '/compliance' },
  { route: '/workforce' },
  { route: '/see-worked-case-example', prefix: true },
];

export function parseRouteFromLocation(): NavRoute {
  const base = (import.meta.env?.BASE_URL || '/').replace(/\/$/, '');
  const raw = window.location.pathname;
  const path = (base && raw.startsWith(base) ? raw.slice(base.length) : raw) || '/';
  for (const entry of ROUTE_REGISTRY) {
    if (path === entry.route) return path as NavRoute;
    if (entry.prefix && path.startsWith(entry.route + '/')) return path as NavRoute;
  }
  return import.meta.env?.VITE_STATIC_PREVIEW ? '/leakage' : '/';
}
