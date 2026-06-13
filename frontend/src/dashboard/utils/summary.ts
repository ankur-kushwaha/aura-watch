import type { VideoClip } from '../types';

/** Combined text used for list previews and search display. */
export function getClipDisplaySummary(clip: Pick<VideoClip, 'summary' | 'aiSummary'>): string {
  const detection = clip.summary?.trim();
  const ai = clip.aiSummary?.trim();
  if (detection && ai) return `${detection} ${ai}`;
  return detection || ai || '';
}

/** Short preview for clip list rows — prefers detection summary, falls back to AI. */
export function getClipListPreview(clip: Pick<VideoClip, 'summary' | 'aiSummary'>): string {
  return clip.summary?.trim() || clip.aiSummary?.trim() || '';
}
