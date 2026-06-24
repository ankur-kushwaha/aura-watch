/**
 * notificationService.ts
 *
 * Creates, stores, and delivers in-app notifications for Aura Watch.
 *
 * Two event sources:
 *   1. Device events (camera/device/websocket errors) → fromDeviceEvent()
 *   2. Clip AI analysis (LLM classifier + watchlist check) → evaluateClipWithLLM()
 *
 * Delivery: MongoDB (Notification model) + WebSocket push to all UI clients.
 */

import prisma from './db';
import { getOrgSettings } from './orgSettings';
import { tryParseClipAiAnalysis } from './ai/clipAiAnalysis';
import { sendAlertEmail } from './emailService';
import type { WebSocket } from 'ws';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationSeverity = 'info' | 'warn' | 'error' | 'critical';
export type NotificationCategory = 'surveillance' | 'camera' | 'device' | 'websocket';
export type ClipRiskLevel = 'low' | 'medium' | 'high';

export interface CreateNotificationInput {
  orgId: string;
  deviceId?: string | null;
  streamId?: string | null;
  clipId?: string | null;
  identityId?: string | null;
  alertRuleId?: string | null;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  body: string;
  riskLevel?: ClipRiskLevel | null;
  triggeredByInstruction?: string | null;
}

interface LLMClassifierResult {
  riskLevel: ClipRiskLevel;
  title: string;
  body: string;
  /** Which custom instruction (verbatim) triggered this, if any */
  triggeredByInstruction?: string | null;
}

// ---------------------------------------------------------------------------
// WebSocket broadcast — injected at startup so service has no circular dep
// ---------------------------------------------------------------------------

type BroadcastFn = (message: object) => void;
let broadcastToAllUIs: BroadcastFn = () => {};

export function registerNotificationBroadcast(fn: BroadcastFn): void {
  broadcastToAllUIs = fn;
}

// ---------------------------------------------------------------------------
// Severity threshold helpers
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<string, number> = { info: 0, warn: 1, error: 2, critical: 3 };

function meetsThreshold(severity: string, minSeverity: string): boolean {
  return (SEVERITY_RANK[severity] ?? 0) >= (SEVERITY_RANK[minSeverity] ?? 1);
}

// ---------------------------------------------------------------------------
// Core: create a notification & broadcast
// ---------------------------------------------------------------------------

export async function createNotification(input: CreateNotificationInput) {
  const notification = await prisma.notification.create({
    data: {
      orgId: input.orgId,
      deviceId: input.deviceId ?? null,
      streamId: input.streamId ?? null,
      clipId: input.clipId ?? null,
      identityId: input.identityId ?? null,
      alertRuleId: input.alertRuleId ?? null,
      category: input.category,
      severity: input.severity,
      title: input.title,
      body: input.body,
      riskLevel: input.riskLevel ?? null,
      triggeredByInstruction: input.triggeredByInstruction ?? null,
      readAt: null,
    },
  });

  // Push unread count update to all connected UI clients
  try {
    const count = await getUnreadCount(input.orgId);
    broadcastToAllUIs({ type: 'notification_count', orgId: input.orgId, count });
    if (input.category === 'surveillance') {
      broadcastToAllUIs({ type: 'new_notification', notification });
    }
  } catch {
    // non-fatal
  }

  return notification;
}

// ---------------------------------------------------------------------------
// Device event → notification
// ---------------------------------------------------------------------------

export async function fromDeviceEvent(
  deviceId: string,
  event: {
    id?: string;
    orgId?: string | null;
    streamId?: string | null;
    category: string;
    severity: string;
    eventType: string;
    message: string;
  },
): Promise<void> {
  const orgId = event.orgId ?? await resolveOrgIdForDevice(deviceId);
  if (!orgId) return;

  const settings = await getOrgSettings(orgId);
  if (!settings.notificationsEnabled) return;

  const minSeverity = settings.notifyMinSeverity ?? 'warn';
  if (!meetsThreshold(event.severity, minSeverity)) return;

  const severity = (event.severity === 'error' ? 'error' : 'warn') as NotificationSeverity;
  const { title, body } = deviceEventToMessage(event.eventType, event.message);

  const category = (
    event.category === 'websocket' ? 'websocket' :
    event.category === 'device' ? 'device' : 'camera'
  ) as NotificationCategory;

  await createNotification({
    orgId,
    deviceId,
    streamId: event.streamId ?? null,
    category,
    severity,
    title,
    body,
  });
}

function deviceEventToMessage(eventType: string, rawMessage: string): { title: string; body: string } {
  const titles: Record<string, string> = {
    camera_unreachable: 'Camera Unreachable',
    camera_timeout: 'Camera Connection Timeout',
    camera_refused: 'Camera Connection Refused',
    camera_auth: 'Camera Authentication Failed',
    camera_stall: 'Camera Stream Stalled',
    camera_no_frames: 'Camera — No Frames Received',
    camera_error: 'Camera Error',
    websocket_error: 'WebSocket Connection Issue',
    websocket_reconnected: 'WebSocket Reconnected',
    preview_stall: 'Live Preview Stalled',
    heartbeat_timeout: 'Device Heartbeat Timeout',
  };

  const title = titles[eventType] ?? 'Device Alert';
  const body = rawMessage.length > 200 ? `${rawMessage.slice(0, 197)}...` : rawMessage;
  return { title, body };
}

// ---------------------------------------------------------------------------
// Watchlist check
// ---------------------------------------------------------------------------

async function resolveWatchlistedDetected(
  streamId: string,
  clipId: string,
): Promise<{ identityId: string; label: string }[]> {
  // Find identities detected in this clip that are watchlisted
  const detections = await prisma.reidDetection.findMany({
    where: {
      OR: [{ clipId }, { clipFilename: { not: null } }],
      identityId: { not: null },
    },
    select: { identityId: true },
    distinct: ['identityId'],
  });

  const identityIds = detections.map(d => d.identityId!).filter(Boolean);
  if (identityIds.length === 0) return [];

  const watchlisted = await prisma.reidIdentity.findMany({
    where: { id: { in: identityIds }, isWatchlisted: true },
    select: { id: true, label: true },
  });

  return watchlisted.map(w => ({ identityId: w.id, label: w.label ?? 'Unknown' }));
}

async function resolveOrgIdForDevice(deviceId: string): Promise<string | null> {
  const device = await prisma.edgeDevice.findUnique({
    where: { deviceId },
    select: { orgId: true },
  });
  return device?.orgId ?? null;
}

// ---------------------------------------------------------------------------
// Main: evaluate clip with LLM
// ---------------------------------------------------------------------------

interface ClipEvalInput {
  clipId: string;
  streamId: string;
  deviceId: string;
  orgId: string;
  cameraName: string;
  duration: number;
  aiSummary: string | null;
  /** Parsed from clip.detectedObjects */
  objectCounts: { person: number; vehicle: number };
  /** Identity labels resolved from ReID detections on this clip */
  identityLabels: string[];
}

async function routeNotification(notification: any, ruleId: string | null, orgId: string) {
  try {
    if (!ruleId) return;
    const rule = await prisma.alertRule.findUnique({
      where: { id: ruleId }
    });
    if (!rule || !rule.isActive) return;

    const channels = rule.channels || ['in_app'];

    // 1. Webhook routing
    if (channels.includes('webhook')) {
      const webhookUrl = rule.webhookUrl || (await getOrgSettings(orgId)).notifyWebhookUrl;
      if (webhookUrl) {
        console.log(`[Notification Webhook] Sending payload to ${webhookUrl}...`);
        fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'alert_triggered', rule, notification }),
        }).catch(err => {
          console.error(`[Notification Webhook] Failed to deliver alert payload:`, err.message);
        });
      }
    }

    // 2. Email routing using Resend
    if (channels.includes('email')) {
      let targetEmails: string[] = [];
      if (rule.userIds && rule.userIds.length > 0) {
        const users = await prisma.user.findMany({
          where: { id: { in: rule.userIds } },
          select: { email: true }
        });
        targetEmails = users.map(u => u.email);
      } else {
        // notify all members of the org
        const members = await prisma.orgMember.findMany({
          where: { orgId },
          include: { user: { select: { email: true } } }
        });
        targetEmails = members.map(m => m.user.email);
      }

      if (targetEmails.length > 0) {
        const subject = `Aura Watch Alert - [${notification.severity.toUpperCase()}] ${notification.title}`;
        const emailBody = `Hello,

The following security event was detected:
${notification.body}

Triggered Rule: "${rule.name}"
Instruction: "${rule.instruction}"

Review the footage in the Dashboard: http://localhost:3000/app/notifications`;

        await sendAlertEmail({
          to: targetEmails,
          subject,
          body: emailBody,
        });
      }
    }
  } catch (err: any) {
    console.error('[Notification Routing] failed:', err.message);
  }
}

export async function evaluateClipWithLLM(input: ClipEvalInput): Promise<void> {
  try {
    const settings = await getOrgSettings(input.orgId);
    if (!settings.notificationsEnabled) return;

    if (!input.aiSummary?.trim()) return;

    const analysis = tryParseClipAiAnalysis(input.aiSummary);
    if (!analysis) return;

    // Resolve watchlisted identities in this clip
    const watchlisted = await resolveWatchlistedDetected(input.streamId, input.clipId);
    const watchlistedLabels = watchlisted.map(w => w.label);

    // Watchlisted identity always fires a critical notification regardless of LLM output
    if (watchlisted.length > 0) {
      const labels = watchlistedLabels.join(', ');
      await createNotification({
        orgId: input.orgId,
        deviceId: input.deviceId,
        streamId: input.streamId,
        clipId: input.clipId,
        identityId: watchlisted[0].identityId,
        category: 'surveillance',
        severity: 'critical',
        title: `Watchlisted Person Detected — ${input.cameraName}`,
        body: `${labels} was spotted on "${input.cameraName}". Review the clip immediately.`,
        riskLevel: 'high',
      });
    }

    // Combined video AI analysis contains the custom instruction decision(s)
    if (analysis.alerts && analysis.alerts.length > 0) {
      for (const alert of analysis.alerts) {
        const severity: NotificationSeverity = alert.riskLevel === 'high' ? 'error' : 'warn';
        const title = alert.alertTitle || `Security Event — ${input.cameraName}`;
        const body = alert.alertBody || analysis.summary;

        let alertRuleId: string | null = null;
        if (alert.triggeredInstruction) {
          const rule = await prisma.alertRule.findFirst({
            where: {
              orgId: input.orgId,
              instruction: alert.triggeredInstruction.trim(),
              isActive: true,
            },
          });
          if (rule) {
            alertRuleId = rule.id;
          }
        }

        const notification = await createNotification({
          orgId: input.orgId,
          deviceId: input.deviceId,
          streamId: input.streamId,
          clipId: input.clipId,
          identityId: null,
          alertRuleId,
          category: 'surveillance',
          severity,
          title,
          body,
          riskLevel: alert.riskLevel,
          triggeredByInstruction: alert.triggeredInstruction ?? null,
        });

        if (alertRuleId) {
          void routeNotification(notification, alertRuleId, input.orgId);
        }
      }
    }
  } catch (err: any) {
    console.error(`[Notifications] evaluateClipWithLLM failed for clip ${input.clipId}:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getNotifications(
  orgId: string,
  options: {
    limit?: number;
    before?: Date;
    unreadOnly?: boolean;
  } = {},
) {
  const limit = Math.min(options.limit ?? 50, 200);
  return prisma.notification.findMany({
    where: {
      orgId,
      category: 'surveillance',
      ...(options.unreadOnly ? { readAt: null } : {}),
      ...(options.before ? { createdAt: { lt: options.before } } : {}),
    },
    orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
    take: limit,
  });
}

export async function getUnreadCount(orgId: string): Promise<number> {
  return prisma.notification.count({
    where: { orgId, readAt: null, category: 'surveillance' },
  });
}

export async function markNotificationsRead(
  orgId: string,
  ids: string[] | 'all',
): Promise<number> {
  const now = new Date();
  if (ids === 'all') {
    const result = await prisma.notification.updateMany({
      where: { orgId, readAt: null },
      data: { readAt: now },
    });
    return result.count;
  }

  const result = await prisma.notification.updateMany({
    where: { orgId, id: { in: ids }, readAt: null },
    data: { readAt: now },
  });
  return result.count;
}

export async function pruneOldNotifications(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
}

export async function deleteNotification(orgId: string, id: string): Promise<boolean> {
  const result = await prisma.notification.deleteMany({
    where: { orgId, id },
  });
  return result.count > 0;
}

export async function clearAllNotifications(orgId: string): Promise<number> {
  const result = await prisma.notification.deleteMany({
    where: { orgId },
  });
  return result.count;
}
