import type { DashboardTab } from '../types';

export function dashboardTabFromPath(pathname: string): DashboardTab | null {
  if (pathname.startsWith('/app/reid')) return 'reid';
  if (pathname.startsWith('/app/events')) return 'events';
  return null;
}
