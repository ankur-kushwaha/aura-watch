import * as fs from 'fs';
import * as path from 'path';
import type { VideoClip } from '@prisma/client';
import prisma from './db';
import { summarizeVideo } from './ai';
import { type ClipAiAnalysis, tryParseClipAiAnalysis } from './ai/clipAiAnalysis';
import { indexClipForSemanticSearch } from './clipIndex';
import { fetchFileFromEdge } from './edgeFileFetch';
import { getDeviceOrgId } from './orgScope';
import { transcodeForGemini } from './videoTranscode';

const VIDEO_DIR = process.env.VIDEO_STORAGE_DIR || path.join(__dirname, '../storage/videos');

function toAiSummaryResponse(raw?: string | null): ClipAiAnalysis | null {
  return tryParseClipAiAnalysis(raw);
}

async function summarizeClipFromVideoPath(
  clip: Pick<VideoClip, 'id' | 'camera' | 'summary' | 'aiSummary'>,
  videoPath: string,
): Promise<{ updated: VideoClip; aiSummary: ClipAiAnalysis }> {
  const existing = toAiSummaryResponse(clip.aiSummary);
  if (existing) {
    const current = await prisma.videoClip.findUnique({ where: { id: clip.id } });
    if (!current) {
      throw new Error('Clip not found');
    }
    return { updated: current, aiSummary: existing };
  }

  let geminiPath: string | null = null;
  try {
    geminiPath = await transcodeForGemini(videoPath);
    const summaryPath = geminiPath !== videoPath ? geminiPath : videoPath;
    const aiSummaryJson = await summarizeVideo(summaryPath, clip.camera);

    const updated = await prisma.videoClip.update({
      where: { id: clip.id },
      data: { aiSummary: aiSummaryJson },
    });

    const aiSummary = toAiSummaryResponse(updated.aiSummary ?? aiSummaryJson);
    if (!aiSummary) {
      throw new Error('Failed to parse AI summary response');
    }

    return { updated, aiSummary };
  } finally {
    if (geminiPath && geminiPath !== videoPath && fs.existsSync(geminiPath)) {
      try {
        fs.unlinkSync(geminiPath);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

export async function generateClipAiSummary(clipId: string): Promise<{
  id: string;
  summary: string;
  aiSummary: ClipAiAnalysis;
}> {
  const clip = await prisma.videoClip.findUnique({ where: { id: clipId } });
  if (!clip) {
    throw new Error('Clip not found');
  }

  if (!clip.deviceId) {
    throw new Error('Clip is not linked to an edge device');
  }

  const existing = toAiSummaryResponse(clip.aiSummary);
  if (existing) {
    return {
      id: clip.id,
      summary: clip.summary,
      aiSummary: existing,
    };
  }

  const { contentType, data } = await fetchFileFromEdge(clip.deviceId, clip.filename);
  if (!contentType.startsWith('video/')) {
    throw new Error(`Unexpected clip content type: ${contentType}`);
  }

  if (!fs.existsSync(VIDEO_DIR)) {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
  }

  const tempPath = path.join(VIDEO_DIR, `temp_ai_${Date.now()}_${clip.filename}`);

  try {
    fs.writeFileSync(tempPath, data);
    const { updated, aiSummary } = await summarizeClipFromVideoPath(clip, tempPath);

    const orgId = clip.deviceId ? await getDeviceOrgId(clip.deviceId) : null;
    await indexClipForSemanticSearch(updated, orgId ?? undefined);

    return {
      id: updated.id,
      summary: updated.summary,
      aiSummary,
    };
  } finally {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

export async function generateClipAiSummaryFromLocalFile(
  clip: VideoClip,
  localVideoPath: string,
  orgId?: string,
  indexForSearch = true,
): Promise<VideoClip> {
  const { updated } = await summarizeClipFromVideoPath(clip, localVideoPath);
  if (indexForSearch) {
    await indexClipForSemanticSearch(updated, orgId);
  }
  return updated;
}
