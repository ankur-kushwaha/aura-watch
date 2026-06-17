import type { ClipAiAnalysis } from '../../api';
import type { VideoClip } from '../types';

function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

export function tryParseClipAiAnalysis(raw?: string | null): ClipAiAnalysis | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(stripJsonFences(raw)) as Record<string, unknown>;
    const summary = String(parsed.summary || '').trim();
    if (!summary) return null;

    const objects = Array.isArray(parsed.objects) ? parsed.objects : [];
    const objectCounts = parsed.objectCounts && typeof parsed.objectCounts === 'object'
      ? {
          person: Number((parsed.objectCounts as Record<string, unknown>).person) || 0,
          vehicle: Number((parsed.objectCounts as Record<string, unknown>).vehicle) || 0,
        }
      : {
          person: objects.filter((obj) => (obj as { type?: string }).type === 'person').length,
          vehicle: objects.filter((obj) => {
            const type = String((obj as { type?: string }).type || '').toLowerCase();
            return type === 'vehicle' || type === 'car';
          }).length,
        };

    return { summary, objectCounts, objects: objects as ClipAiAnalysis['objects'] };
  } catch {
    return null;
  }
}

export function getAiSummaryNarrative(raw?: string | null): string {
  const parsed = tryParseClipAiAnalysis(raw);
  if (parsed) return parsed.summary;
  return raw?.trim() || '';
}

/** Combined text used for list previews and search display — AI only when available. */
export function getClipDisplaySummary(clip: Pick<VideoClip, 'summary' | 'aiSummary'>): string {
  const ai = getAiSummaryNarrative(clip.aiSummary);
  if (ai) return ai;
  return clip.summary?.trim() || '';
}

/** Short preview for clip list rows — AI summary when available, else YOLO detection summary. */
export function getClipListPreview(clip: Pick<VideoClip, 'summary' | 'aiSummary'>): string {
  const ai = getAiSummaryNarrative(clip.aiSummary);
  if (ai) return ai;
  return clip.summary?.trim() || '';
}

export function shouldShowClipListPreview(
  clip: Pick<VideoClip, 'summary' | 'aiSummary'>,
  orgSettings: { videoSummary: boolean; aiChat: boolean },
): boolean {
  if (!getClipListPreview(clip)) return false;
  return tryParseClipAiAnalysis(clip.aiSummary) ? orgSettings.aiChat : orgSettings.videoSummary;
}

export function serializeClipAiAnalysis(analysis: ClipAiAnalysis): string {
  return JSON.stringify(analysis);
}
