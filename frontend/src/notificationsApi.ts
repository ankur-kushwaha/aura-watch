import { apiFetch } from './api';
import type { Notification } from './dashboard/types';

export interface FetchNotificationsOptions {
  limit?: number;
  before?: string;
  unreadOnly?: boolean;
}

export async function fetchNotifications(options: FetchNotificationsOptions = {}): Promise<{ notifications: Notification[] }> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.before !== undefined) params.set('before', options.before);
  if (options.unreadOnly !== undefined) params.set('unreadOnly', String(options.unreadOnly));

  const queryStr = params.toString();
  const path = `/notifications${queryStr ? `?${queryStr}` : ''}`;
  const res = await apiFetch(path);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch notifications');
  }
  return res.json();
}

export async function fetchUnreadCount(): Promise<{ count: number }> {
  const res = await apiFetch('/notifications/unread-count');
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch unread count');
  }
  return res.json();
}

export async function markNotificationsRead(payload: { ids: string[] } | { all: true }): Promise<{ updated: number; unreadCount: number }> {
  const res = await apiFetch('/notifications/mark-read', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to mark notifications as read');
  }
  return res.json();
}
