import type { MatchScores, PersonClipReference, ReidDetection, TrackMatchRow } from '../types';

export function mapDetectionToRef(
  d: ReidDetection,
  source: PersonClipReference['source'],
  scores?: MatchScores,
): PersonClipReference {
  return {
    id: d.id,
    cameraName: d.cameraName,
    timestamp: d.timestamp,
    filename: d.filename,
    clipFilename: d.clipFilename,
    clipOffsetMs: d.clipOffsetMs,
    trackId: d.trackId,
    identityId: d.identityId,
    source,
    scores,
    matchScore: scores?.finalScore,
  };
}

export function buildScoreBasedTimeline(
  query: ReidDetection | undefined,
  trackMatches: TrackMatchRow[],
): PersonClipReference[] {
  const refs: PersonClipReference[] = [];

  if (query) {
    refs.push(mapDetectionToRef(query, 'query'));
  }

  for (const match of trackMatches) {
    if (query && match.id === query.id) continue;
    const scores = match.scores
      ? { ...match.scores, feedbackBoost: match.feedbackBoost ?? match.scores.feedbackBoost }
      : undefined;
    refs.push({
      id: match.id,
      cameraName: match.cameraName,
      timestamp: match.timestamp,
      filename: match.filename,
      clipFilename: match.clipFilename,
      clipOffsetMs: match.clipOffsetMs,
      trackId: match.trackId,
      identityId: match.identityId,
      source: 'match',
      scores,
      matchScore: scores?.finalScore,
    });
  }

  return refs.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}
