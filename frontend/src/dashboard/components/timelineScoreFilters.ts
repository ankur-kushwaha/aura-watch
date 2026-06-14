import type { MatchScores } from '../types';

export type TimelineScoreFilterValues = {
  embedding: number;
  time: number;
  topology: number;
  final: number;
};

export const DEFAULT_TIMELINE_SCORE_FILTERS: TimelineScoreFilterValues = {
  embedding: 20,
  time: 20,
  topology: 20,
  final: 20,
};

export function passesTimelineScoreFilters(
  scores: MatchScores | undefined,
  filters: TimelineScoreFilterValues,
): boolean {
  if (!scores) return true;
  return (
    scores.vectorSimilarity * 100 >= filters.embedding
    && scores.timeScore * 100 >= filters.time
    && scores.topologyScore * 100 >= filters.topology
    && scores.finalScore * 100 >= filters.final
  );
}
