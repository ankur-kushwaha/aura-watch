import type { ReactNode } from 'react';
import { Play, RefreshCw, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { MatchScores } from '../types';
import { formatDate } from '../utils/format';
import { DeferredCropImage } from './CropThumbnail';
import type { IdEntry } from './idEntries';
import { InlineCopyIds } from './IdsInfoIcon';
import { MatchScoreBreakdown } from './MatchScoreBreakdown';
import {
  DEFAULT_TIMELINE_SCORE_FILTERS,
  type TimelineScoreFilterValues,
} from './timelineScoreFilters';

const SCORE_FILTER_FIELDS: {
  key: keyof TimelineScoreFilterValues;
  label: string;
  className: string;
}[] = [
  { key: 'embedding', label: 'Embedding min', className: 'accent-[#a78bfa]' },
  { key: 'time', label: 'Time min', className: 'accent-[#38bdf8]' },
  { key: 'topology', label: 'Topology min', className: 'accent-[#34d399]' },
  { key: 'final', label: 'Final min', className: 'accent-white' },
];

export function TimelineScoreFilters({
  filters,
  onChange,
  shownCount,
  totalCount,
}: {
  filters: TimelineScoreFilterValues;
  onChange: (filters: TimelineScoreFilterValues) => void;
  shownCount: number;
  totalCount: number;
}) {
  const hasActiveFilters = Object.values(filters).some((value) => value > 0);

  return (
    <div className="mb-3 rounded-lg border border-border-glass bg-[rgba(0,0,0,0.22)] p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[0.68rem] font-bold text-text-secondary uppercase tracking-wider">
          Score filters
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[0.62rem] text-text-muted">
            {shownCount} / {totalCount}
          </span>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => onChange(DEFAULT_TIMELINE_SCORE_FILTERS)}
              className="btn btn-secondary py-0.5 px-1.5 text-[0.62rem] rounded-md flex items-center gap-1"
            >
              <RotateCcw size={10} /> Reset
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {SCORE_FILTER_FIELDS.map(({ key, label, className }) => (
          <label key={key} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[0.62rem] text-text-muted">
              <span>{label}</span>
              <span className="font-semibold text-text-secondary">{filters[key]}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={filters[key]}
              onChange={(e) => onChange({ ...filters, [key]: Number(e.target.value) })}
              className={`w-full h-1.5 rounded-full appearance-none bg-[rgba(255,255,255,0.08)] ${className}`}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

export type ScoredTimelineBadge = {
  label: string;
  className: string;
};

export interface ScoredTimelineItemProps {
  filename: string;
  cameraName: string;
  timestamp: string;
  badges: ScoredTimelineBadge[];
  matchScore?: number | null;
  scores?: MatchScores;
  highlighted?: boolean;
  eagerImage?: boolean;
  ids?: IdEntry[];
  footer?: ReactNode;
  onCropPreview?: () => void;
  onPlay?: () => void;
  playLoading?: boolean;
  onConfirm?: () => void;
  onReject?: () => void;
  confirmPending?: boolean;
  rejectPending?: boolean;
  showFeedback?: boolean;
}

export function ScoredTimelineItem({
  filename,
  cameraName,
  timestamp,
  badges,
  matchScore,
  scores,
  highlighted,
  eagerImage,
  ids,
  footer,
  onCropPreview,
  onPlay,
  playLoading,
  onConfirm,
  onReject,
  confirmPending,
  rejectPending,
  showFeedback = true,
}: ScoredTimelineItemProps) {
  const canPlay = !!onPlay;

  return (
    <div className="relative">
      <div className="absolute left-[-23px] top-4 w-2.5 h-2.5 rounded-full bg-[#38bdf8] border-2 border-[#090d16]" />
      <div className={`glass-panel p-2.5 flex items-start gap-3 w-full ${highlighted ? 'border-primary/40' : ''}`}>
        <DeferredCropImage
          filename={filename}
          size="md"
          eager={eagerImage}
          onClick={onCropPreview}
          title={onCropPreview ? 'Click to enlarge crop' : undefined}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[0.8rem] font-semibold text-text-primary">{cameraName}</span>
            {badges.map((badge) => (
              <span
                key={badge.label}
                className={`text-[0.58rem] px-1.5 py-0.5 rounded-full border ${badge.className}`}
              >
                {badge.label}
              </span>
            ))}
            {matchScore != null && (
              <span className="text-[0.6rem] text-secondary font-semibold">
                {Math.round(matchScore * 100)}% match
              </span>
            )}
          </div>
          <p className="text-[0.7rem] text-text-muted mt-0.5">{formatDate(timestamp)}</p>
          {scores && <MatchScoreBreakdown scores={scores} />}
          {ids && ids.length > 0 && <InlineCopyIds ids={ids} />}
          {footer}
        </div>
        {(canPlay || showFeedback) && (
          <div className="flex flex-col gap-1.5 shrink-0 self-center">
            {canPlay && (
              <button
                type="button"
                onClick={onPlay}
                disabled={playLoading}
                className="btn btn-secondary p-2 rounded-lg hover:border-primary/40 hover:text-primary disabled:opacity-50"
                title="Play clip"
              >
                {playLoading ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <Play size={16} fill="currentColor" />
                )}
              </button>
            )}
            {showFeedback && onConfirm && onReject && (
              <>
                <button
                  type="button"
                  title="Same person"
                  disabled={confirmPending || rejectPending}
                  onClick={onConfirm}
                  className="btn btn-secondary p-1.5 border-none hover:text-green-400"
                >
                  <ThumbsUp size={13} className={confirmPending ? 'animate-pulse' : ''} />
                </button>
                <button
                  type="button"
                  title="Different person"
                  disabled={confirmPending || rejectPending}
                  onClick={onReject}
                  className="btn btn-secondary p-1.5 border-none hover:text-danger"
                >
                  <ThumbsDown size={13} className={rejectPending ? 'animate-pulse' : ''} />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ScoredTimeline({
  title = 'Scored timeline',
  description,
  loading,
  children,
}: {
  title?: string;
  description?: string;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <p className="text-[0.68rem] font-bold text-text-secondary uppercase tracking-wider mb-1">
        {title}
      </p>
      {description && (
        <p className="text-[0.65rem] text-text-muted mb-2">{description}</p>
      )}
      {loading ? (
        <div className="flex justify-center py-10 text-text-muted">
          <RefreshCw size={20} className="animate-spin" />
        </div>
      ) : (
        children
      )}
    </>
  );
}

export function ScoredTimelineList({ children }: { children: ReactNode }) {
  return (
    <div className="relative border-l-2 border-[rgba(56,189,248,0.25)] ml-3 pl-5 flex flex-col gap-3">
      {children}
    </div>
  );
}
