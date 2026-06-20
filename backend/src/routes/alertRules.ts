import { Router, Request, Response } from 'express';
import prisma from '../services/db';

const router = Router();

// GET /api/alert-rules — Retrieve all alert rules for the authed organization
router.get('/', async (req: Request, res: Response) => {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' });

  try {
    const rules = await prisma.alertRule.findMany({
      where: { orgId: req.auth.orgId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ rules });
  } catch (err: any) {
    console.error('[AlertRules] list error:', err);
    res.status(500).json({ error: 'Failed to fetch alert rules' });
  }
});

// POST /api/alert-rules — Create a new alert rule
router.post('/', async (req: Request, res: Response) => {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' });

  const { name, instruction, isActive, allStreams, streamIds, channels, userIds, webhookUrl } = req.body ?? {};

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Rule name is required' });
  }
  if (!instruction?.trim()) {
    return res.status(400).json({ error: 'Instruction description is required' });
  }

  try {
    const rule = await prisma.alertRule.create({
      data: {
        orgId: req.auth.orgId,
        name: name.trim(),
        instruction: instruction.trim(),
        isActive: isActive !== false,
        allStreams: allStreams === true,
        streamIds: Array.isArray(streamIds) ? streamIds.filter((id) => typeof id === 'string') : [],
        channels: Array.isArray(channels) ? channels.filter((ch) => typeof ch === 'string') : ['in_app'],
        userIds: Array.isArray(userIds) ? userIds.filter((id) => typeof id === 'string') : [],
        webhookUrl: typeof webhookUrl === 'string' ? webhookUrl.trim() || null : null,
      },
    });
    res.status(201).json({ rule });
  } catch (err: any) {
    console.error('[AlertRules] create error:', err);
    res.status(500).json({ error: 'Failed to create alert rule' });
  }
});

// PATCH /api/alert-rules/:id — Update an existing alert rule
router.patch('/:id', async (req: Request, res: Response) => {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' });

  const { id } = req.params;
  const { name, instruction, isActive, allStreams, streamIds, channels, userIds, webhookUrl } = req.body ?? {};

  try {
    const existing = await prisma.alertRule.findFirst({
      where: { id, orgId: req.auth.orgId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Alert rule not found' });
    }

    const updated = await prisma.alertRule.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: String(name).trim() || 'Custom Rule' } : {}),
        ...(instruction !== undefined ? { instruction: String(instruction).trim() } : {}),
        ...(isActive !== undefined ? { isActive: !!isActive } : {}),
        ...(allStreams !== undefined ? { allStreams: !!allStreams } : {}),
        ...(streamIds !== undefined ? { streamIds: Array.isArray(streamIds) ? streamIds.filter((x) => typeof x === 'string') : [] } : {}),
        ...(channels !== undefined ? { channels: Array.isArray(channels) ? channels.filter((x) => typeof x === 'string') : [] } : {}),
        ...(userIds !== undefined ? { userIds: Array.isArray(userIds) ? userIds.filter((x) => typeof x === 'string') : [] } : {}),
        ...(webhookUrl !== undefined ? { webhookUrl: typeof webhookUrl === 'string' ? webhookUrl.trim() || null : null } : {}),
      },
    });

    res.json({ rule: updated });
  } catch (err: any) {
    console.error('[AlertRules] update error:', err);
    res.status(500).json({ error: 'Failed to update alert rule' });
  }
});

// DELETE /api/alert-rules/:id — Delete an alert rule
router.delete('/:id', async (req: Request, res: Response) => {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' });

  const { id } = req.params;

  try {
    const existing = await prisma.alertRule.findFirst({
      where: { id, orgId: req.auth.orgId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Alert rule not found' });
    }

    await prisma.alertRule.delete({
      where: { id },
    });

    res.json({ success: true, message: 'Alert rule deleted' });
  } catch (err: any) {
    console.error('[AlertRules] delete error:', err);
    res.status(500).json({ error: 'Failed to delete alert rule' });
  }
});

export default router;
