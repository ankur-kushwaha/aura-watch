/**
 * GET  /api/notifications             — list notifications for the authed org
 * GET  /api/notifications/unread-count — fast unread count
 * POST /api/notifications/mark-read   — mark one, many, or all as read
 */

import { Router, Request, Response } from 'express';
import {
  getNotifications,
  getUnreadCount,
  markNotificationsRead,
  deleteNotification,
  clearAllNotifications,
} from '../services/notificationService';

const router = Router();

/**
 * GET /api/notifications
 * Query: limit (default 50, max 200), before (ISO timestamp), unreadOnly=true
 */
router.get('/', async (req: Request, res: Response) => {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' });

  const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
  const beforeRaw = typeof req.query.before === 'string' ? req.query.before : undefined;
  const before = beforeRaw ? new Date(beforeRaw) : undefined;
  if (before && Number.isNaN(before.getTime())) {
    return res.status(400).json({ error: 'Invalid before timestamp' });
  }
  const unreadOnly = req.query.unreadOnly === 'true';

  try {
    const notifications = await getNotifications(req.auth.orgId, { limit, before, unreadOnly });
    res.json({ notifications });
  } catch (err: any) {
    console.error('[Notifications] list error:', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

/**
 * GET /api/notifications/unread-count
 */
router.get('/unread-count', async (req: Request, res: Response) => {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' });

  try {
    const count = await getUnreadCount(req.auth.orgId);
    res.json({ count });
  } catch (err: any) {
    console.error('[Notifications] unread-count error:', err);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

/**
 * POST /api/notifications/mark-read
 * Body: { ids: string[] } | { all: true }
 */
router.post('/mark-read', async (req: Request, res: Response) => {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' });

  const { ids, all } = req.body ?? {};

  try {
    let updated = 0;
    if (all === true) {
      updated = await markNotificationsRead(req.auth.orgId, 'all');
    } else if (Array.isArray(ids) && ids.length > 0) {
      updated = await markNotificationsRead(req.auth.orgId, ids);
    } else {
      return res.status(400).json({ error: 'Provide ids[] or all: true' });
    }

    const count = await getUnreadCount(req.auth.orgId);
    res.json({ updated, unreadCount: count });
  } catch (err: any) {
    console.error('[Notifications] mark-read error:', err);
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
});

/**
 * DELETE /api/notifications/:id
 * Delete a single notification.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' });

  try {
    const deleted = await deleteNotification(req.auth.orgId, req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    const count = await getUnreadCount(req.auth.orgId);
    res.json({ success: true, unreadCount: count });
  } catch (err: any) {
    console.error('[Notifications] delete error:', err);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

/**
 * DELETE /api/notifications
 * Clear all notifications for the organization.
 */
router.delete('/', async (req: Request, res: Response) => {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' });

  try {
    const deletedCount = await clearAllNotifications(req.auth.orgId);
    res.json({ success: true, deletedCount, unreadCount: 0 });
  } catch (err: any) {
    console.error('[Notifications] clear-all error:', err);
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
});

export default router;
