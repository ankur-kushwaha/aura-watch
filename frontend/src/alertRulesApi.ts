import { apiFetch } from './api';

export interface AlertRule {
  id: string;
  orgId: string;
  name: string;
  instruction: string;
  isActive: boolean;
  allStreams: boolean;
  streamIds: string[];
  channels: string[];
  userIds: string[];
  webhookUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchAlertRules(): Promise<{ rules: AlertRule[] }> {
  const res = await apiFetch('/alert-rules');
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch alert rules');
  }
  return res.json();
}

export async function createAlertRule(payload: {
  name: string;
  instruction: string;
  isActive?: boolean;
  allStreams?: boolean;
  streamIds?: string[];
  channels?: string[];
  userIds?: string[];
  webhookUrl?: string | null;
}): Promise<{ rule: AlertRule }> {
  const res = await apiFetch('/alert-rules', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to create alert rule');
  }
  return res.json();
}

export async function updateAlertRule(
  id: string,
  payload: Partial<{
    name: string;
    instruction: string;
    isActive: boolean;
    allStreams: boolean;
    streamIds: string[];
    channels: string[];
    userIds: string[];
    webhookUrl: string | null;
  }>,
): Promise<{ rule: AlertRule }> {
  const res = await apiFetch(`/alert-rules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to update alert rule');
  }
  return res.json();
}

export async function deleteAlertRule(id: string): Promise<{ success: boolean }> {
  const res = await apiFetch(`/alert-rules/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to delete alert rule');
  }
  return res.json();
}
