import { generateTextEmbedding } from './ai';
import { upsertClipVector } from './qdrant';
import { buildClipIndexStats, buildClipSearchText } from './yoloSummary';

export interface ClipIndexInput {
  id: string;
  summary: string;
  aiSummary?: string | null;
  filepath: string;
  filename: string;
  timestamp: Date;
  camera: string;
  deviceId?: string | null;
  streamId?: string | null;
  detectedObjects?: unknown;
}

export async function indexClipForSemanticSearch(clip: ClipIndexInput, orgId?: string): Promise<void> {
  const searchText = buildClipSearchText(clip.summary, clip.aiSummary);
  if (!searchText.trim()) return;

  const vector = await generateTextEmbedding(searchText);
  const stats = buildClipIndexStats(clip.detectedObjects);

  await upsertClipVector(clip.id, vector, {
    filepath: clip.filepath,
    filename: clip.filename,
    timestamp: clip.timestamp.toISOString(),
    summary: clip.summary,
    aiSummary: clip.aiSummary ?? null,
    searchText,
    camera: clip.camera,
    deviceId: clip.deviceId,
    streamId: clip.streamId,
    ...stats,
    ...(orgId ? { orgId } : {}),
  });
}
