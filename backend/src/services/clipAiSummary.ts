import * as fs from 'fs';
import * as path from 'path';
import prisma from './db';
import { summarizeVideo } from './ai';
import { indexClipForSemanticSearch } from './clipIndex';
import { fetchFileFromEdge } from './edgeFileFetch';
import { getDeviceOrgId } from './orgScope';
import { transcodeForGemini } from './videoTranscode';

const VIDEO_DIR = process.env.VIDEO_STORAGE_DIR || path.join(__dirname, '../storage/videos');

export async function generateClipAiSummary(clipId: string): Promise<{
  id: string;
  summary: string;
  aiSummary: string;
}> {
  const clip = await prisma.videoClip.findUnique({ where: { id: clipId } });
  if (!clip) {
    throw new Error('Clip not found');
  }

  if (!clip.deviceId) {
    throw new Error('Clip is not linked to an edge device');
  }

  if (clip.aiSummary?.trim()) {
    return {
      id: clip.id,
      summary: clip.summary,
      aiSummary: clip.aiSummary,
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
  let geminiPath: string | null = null;

  try {
    fs.writeFileSync(tempPath, data);
    geminiPath = await transcodeForGemini(tempPath);
    const summaryPath = geminiPath !== tempPath ? geminiPath : tempPath;
    const aiSummary = await summarizeVideo(summaryPath, clip.camera);

    const updated = await prisma.videoClip.update({
      where: { id: clip.id },
      data: { aiSummary },
    });

    const orgId = clip.deviceId ? await getDeviceOrgId(clip.deviceId) : null;
    await indexClipForSemanticSearch(updated, orgId ?? undefined);

    return {
      id: updated.id,
      summary: updated.summary,
      aiSummary: updated.aiSummary ?? aiSummary,
    };
  } finally {
    if (geminiPath && geminiPath !== tempPath && fs.existsSync(geminiPath)) {
      try {
        fs.unlinkSync(geminiPath);
      } catch {
        // ignore cleanup errors
      }
    }
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
