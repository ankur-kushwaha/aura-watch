import type { DashboardTab } from '../types';

export function dashboardTabFromPath(pathname: string): DashboardTab | null {
  if (pathname.startsWith('/app/live')) return 'live';
  if (pathname.startsWith('/app/events')) return 'events';
  if (pathname.startsWith('/app/clips')) return 'clips';
  if (pathname.startsWith('/app/reid')) return 'reid';
  if (pathname.startsWith('/app/ai')) return 'ai';
  if (pathname.startsWith('/app/map')) return 'map';
  if (pathname.startsWith('/app/devices')) return 'devices';
  if (pathname.startsWith('/app/config')) return 'devices';
  if (pathname.startsWith('/app/custom-alerts')) return 'custom-alerts';
  if (pathname.startsWith('/app/notifications')) return 'notifications';
  return null;
}
