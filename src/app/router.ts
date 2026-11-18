/** Минимальный hash-роутер: #/ — стартовый экран, #/p/<id> — редактор, #/p/<id>/compare — сравнение. */
import { useSyncExternalStore } from 'react';

export type Route = { screen: 'start' } | { screen: 'editor'; projectId: string } | { screen: 'compare'; projectId: string };

export function parseRoute(hash: string): Route {
  const m = hash.replace(/^#/, '').match(/^\/p\/([^/]+)(\/compare)?$/);
  if (!m) return { screen: 'start' };
  return m[2] ? { screen: 'compare', projectId: decodeURIComponent(m[1]) } : { screen: 'editor', projectId: decodeURIComponent(m[1]) };
}

export function navigate(route: Route) {
  window.location.hash =
    route.screen === 'start' ? '/' : `/p/${encodeURIComponent(route.projectId)}${route.screen === 'compare' ? '/compare' : ''}`;
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseRoute(hash);
}
