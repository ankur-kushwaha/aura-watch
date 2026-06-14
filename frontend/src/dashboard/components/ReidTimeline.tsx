import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiFetch } from '../../api';
import type {
  MatchScores,
  PersonClipReference,
  ReidDetection,
  TimelineVideoPlayback,
  TrackMatchRow,
} from '../types';
import { buildScoreBasedTimeline } from '../utils/reid';
import { buildTimelineIdEntries } from './idEntries';
import {
  ScoredTimeline,
  ScoredTimelineItem,
  ScoredTimelineList,
  TimelineScoreFilters,
} from './ScoredTimeline';
import {
  DEFAULT_TIMELINE_SCORE_FILTERS,
  passesTimelineScoreFilters,
  type TimelineScoreFilterValues,
} from './timelineScoreFilters';
import { TimelineClipPlaybackDialog } from './modals/TimelineClipPlaybackDialog';

export type ReidTimelineSource =
  | { mode: 'detection'; detectionId: string }
  | { mode: 'identity'; identityId: string; coverDetectionId?: string | null };

type ReidTimelineRow = {
  id: string;
  filename: string;
  cameraName: string;
  timestamp: string;
  clipFilename?: string | null;
  clipOffsetMs?: number | null;
  clipId?: string | null;
  identityId?: string | null;
  scores?: MatchScores;
  matchScore?: number | null;
  /** Anchor row — the query detection (detection mode) */
  isAnchor?: boolean;
  /** Confirmed member of the identity (identity mode) */
  isConfirmed?: boolean;
  /** Extra badge, e.g. "This clip" in archive context */
  extraBadge?: { label: string; className: string };
  eagerImage?: boolean;
};

export interface ReidTimelineProps {
  source: ReidTimelineSource;
  highlightClipFilename?: string;
  showFilters?: boolean;
  title?: string;
  description?: string;
  emptyMessage?: string;
  onUpdated?: () => void | Promise<void>;
  onIdentityResolved?: (identityId: string | null, label?: string | null) => void;
  onCropPreview?: (filename: string) => void;
  renderItemFooter?: (row: ReidTimelineRow) => ReactNode;
  className?: string;
  nestedPlayback?: boolean;
}

async function fetchDetectionTimeline(detectionId: string) {
  const trackRes = await apiFetch('/reid/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ detectionId, limit: 30 }),
  });
  if (!trackRes.ok) throw new Error('Failed to search similar detections');
  const trackData = await trackRes.json();
  return {
    query: trackData.query as ReidDetection | undefined,
    matches: (trackData.matches || []) as TrackMatchRow[],
  };
}

async function fetchIdentityTimeline(identityId: string) {
  const res = await apiFetch(`/reid/identities/${identityId}/journey`);
  if (!res.ok) throw new Error('Failed to load identity timeline');
  const data = await res.json();
  return {
    detections: (data.detections || []) as ReidDetection[],
    coverDetectionId: data.identity?.coverDetectionId as string | null | undefined,
  };
}

function refsToRows(refs: PersonClipReference[], highlightClipFilename?: string): ReidTimelineRow[] {
  return refs.map((ref) => ({
    id: ref.id,
    filename: ref.filename,
    cameraName: ref.cameraName,
    timestamp: ref.timestamp,
    clipFilename: ref.clipFilename,
    clipOffsetMs: ref.clipOffsetMs,
    identityId: ref.identityId,
    scores: ref.scores,
    matchScore: ref.matchScore,
    isAnchor: ref.source === 'query',
    eagerImage: ref.source === 'query',
    extraBadge: highlightClipFilename && ref.clipFilename === highlightClipFilename
      ? { label: 'This clip', className: 'text-primary bg-primary/10 border-primary/20' }
      : undefined,
  }));
}

function detectionsToRows(detections: ReidDetection[]): ReidTimelineRow[] {
  return detections.map((crop) => ({
    id: crop.id,
    filename: crop.filename,
    cameraName: crop.cameraName,
    timestamp: crop.timestamp,
    clipFilename: crop.clipFilename,
    clipOffsetMs: crop.clipOffsetMs,
    clipId: crop.clipId,
    identityId: crop.identityId,
    scores: crop.scores,
    matchScore: crop.scores?.finalScore ?? crop.matchScore,
    isConfirmed: crop.linkStatus !== 'approximate',
  }));
}

function sortRowsNewestFirst(rows: ReidTimelineRow[]): ReidTimelineRow[] {
  return [...rows].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

function rowBadges(row: ReidTimelineRow) {
  if (row.isAnchor) {
    return [{ label: 'This detection', className: 'text-primary bg-primary/10 border-primary/20' }];
  }
  if (row.isConfirmed) {
    return [{ label: 'Confirmed', className: 'text-primary bg-primary/10 border-primary/20' }];
  }
  return [{ label: 'Scored match', className: 'text-secondary bg-secondary/10 border-secondary/20' }];
}

type TimelineLoadResult = {
  rows: ReidTimelineRow[];
  feedbackSourceId: string | null;
  resolvedIdentity?: { identityId: string | null; label?: string | null };
};

async function loadTimelineData(
  sourceMode: ReidTimelineSource['mode'],
  detectionId: string | null,
  identityId: string | null,
  coverDetectionId: string | null | undefined,
  highlightClipFilename?: string,
): Promise<TimelineLoadResult> {
  if (sourceMode === 'detection' && detectionId) {
    const { query, matches } = await fetchDetectionTimeline(detectionId);
    return {
      rows: sortRowsNewestFirst(refsToRows(buildScoreBasedTimeline(query, matches), highlightClipFilename)),
      feedbackSourceId: query?.id ?? detectionId,
      resolvedIdentity: {
        identityId: query?.identityId ?? null,
        label: query?.identity?.label?.trim() || null,
      },
    };
  }

  if (sourceMode === 'identity' && identityId) {
    const { detections, coverDetectionId: journeyCoverId } = await fetchIdentityTimeline(identityId);
    return {
      rows: sortRowsNewestFirst(detectionsToRows(detections)),
      feedbackSourceId: detections.find((d) => d.linkStatus === 'confirmed')?.id
        ?? coverDetectionId
        ?? journeyCoverId
        ?? detections[0]?.id
        ?? null,
    };
  }

  return { rows: [], feedbackSourceId: null };
}

export function ReidTimeline({
  source,
  highlightClipFilename,
  showFilters = true,
  title = 'Timeline',
  description = 'Ranked by embedding, topology, and your past feedback. Confirm or reject approximate matches to improve future results.',
  emptyMessage = 'No appearances or matches found yet.',
  onUpdated,
  onIdentityResolved,
  onCropPreview,
  renderItemFooter,
  className,
  nestedPlayback = false,
}: ReidTimelineProps) {
  const [rows, setRows] = useState<ReidTimelineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scoreFilters, setScoreFilters] = useState<TimelineScoreFilterValues>(DEFAULT_TIMELINE_SCORE_FILTERS);
  const [feedbackPending, setFeedbackPending] = useState<string | null>(null);
  const [clipLoadingId, setClipLoadingId] = useState<string | null>(null);
  const [playback, setPlayback] = useState<TimelineVideoPlayback | null>(null);
  const [feedbackSourceId, setFeedbackSourceId] = useState<string | null>(null);

  const sourceMode = source.mode;
  const detectionId = source.mode === 'detection' ? source.detectionId : null;
  const identityId = source.mode === 'identity' ? source.identityId : null;
  const coverDetectionId = source.mode === 'identity' ? source.coverDetectionId : null;

  const onUpdatedRef = useRef(onUpdated);
  const onIdentityResolvedRef = useRef(onIdentityResolved);

  useEffect(() => {
    onUpdatedRef.current = onUpdated;
    onIdentityResolvedRef.current = onIdentityResolved;
  }, [onUpdated, onIdentityResolved]);

  const reloadTimeline = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadTimelineData(
        sourceMode,
        detectionId,
        identityId,
        coverDetectionId,
        highlightClipFilename,
      );
      if (result.resolvedIdentity) {
        onIdentityResolvedRef.current?.(
          result.resolvedIdentity.identityId,
          result.resolvedIdentity.label,
        );
      }
      setFeedbackSourceId(result.feedbackSourceId);
      setRows(result.rows);
    } catch (err) {
      console.error('Failed to load ReID timeline', err);
      setError('Could not load timeline.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [sourceMode, detectionId, identityId, coverDetectionId, highlightClipFilename]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await loadTimelineData(
          sourceMode,
          detectionId,
          identityId,
          coverDetectionId,
          highlightClipFilename,
        );
        if (cancelled) return;
        if (result.resolvedIdentity) {
          onIdentityResolvedRef.current?.(
            result.resolvedIdentity.identityId,
            result.resolvedIdentity.label,
          );
        }
        setFeedbackSourceId(result.feedbackSourceId);
        setRows(result.rows);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load ReID timeline', err);
        setError('Could not load timeline.');
        setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [sourceMode, detectionId, identityId, coverDetectionId, highlightClipFilename]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (row.isAnchor || row.isConfirmed) return true;
      return passesTimelineScoreFilters(row.scores, scoreFilters);
    });
  }, [rows, scoreFilters]);

  const scorableCount = useMemo(
    () => rows.filter((row) => !row.isAnchor && !row.isConfirmed).length,
    [rows],
  );

  const handleFeedback = async (targetDetectionId: string, type: 'same' | 'different') => {
    const sourceDetectionId = feedbackSourceId;
    if (!sourceDetectionId || sourceDetectionId === targetDetectionId) return;

    const key = `${type}:${sourceDetectionId}:${targetDetectionId}`;
    setFeedbackPending(key);
    try {
      const res = await apiFetch('/reid/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, sourceDetectionId, targetDetectionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to save feedback');
        return;
      }

      if (type === 'same' && source.mode === 'identity') {
        const assignRes = await apiFetch(`/reid/detections/${targetDetectionId}/assign-identity`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identityId: source.identityId }),
        });
        const assignData = await assignRes.json();
        if (!assignRes.ok) {
          alert(assignData.error || 'Feedback saved but failed to link detection');
        }
      }

      await reloadTimeline();
      await onUpdatedRef.current?.();
    } catch (err) {
      console.error('Failed to submit timeline feedback', err);
    } finally {
      setFeedbackPending(null);
    }
  };

  const playRow = async (row: ReidTimelineRow) => {
    if (!row.clipFilename && !row.id) return;

    setClipLoadingId(row.id);
    try {
      let clipFilename = row.clipFilename;
      let clipOffsetMs = row.clipOffsetMs ?? 0;

      if (!clipFilename) {
        const res = await apiFetch(`/reid/detections/${row.id}/source-clip`);
        if (!res.ok) {
          onCropPreview?.(row.filename);
          return;
        }
        const data = await res.json();
        clipFilename = data.clipFilename;
        clipOffsetMs = data.clipOffsetMs ?? 0;
      }

      if (clipFilename) {
        setPlayback({
          filename: clipFilename,
          offsetMs: clipOffsetMs,
          cameraName: row.cameraName,
          cropFilename: row.filename,
        });
      } else {
        onCropPreview?.(row.filename);
      }
    } catch (err) {
      console.error('Failed to resolve clip for detection', err);
      onCropPreview?.(row.filename);
    } finally {
      setClipLoadingId(null);
    }
  };

  const rowIds = (row: ReidTimelineRow) => buildTimelineIdEntries({
    detectionId: row.id,
    clipId: row.clipId,
  });

  return (
    <div className={className}>
      {!loading && showFilters && scorableCount > 0 && (
        <TimelineScoreFilters
          filters={scoreFilters}
          onChange={setScoreFilters}
          shownCount={filteredRows.length}
          totalCount={rows.length}
        />
      )}

      <ScoredTimeline
        title={title}
        description={description}
        loading={loading}
      >
        {error ? (
          <p className="text-[0.8rem] text-danger text-center py-8">{error}</p>
        ) : rows.length === 0 ? (
          <p className="text-[0.8rem] text-text-muted text-center py-8">{emptyMessage}</p>
        ) : filteredRows.length === 0 ? (
          <p className="text-[0.8rem] text-text-muted text-center py-8">
            No detections match the current score filters.
          </p>
        ) : (
          <ScoredTimelineList>
            {filteredRows.map((row) => {
              const canFeedback = !row.isAnchor && !row.isConfirmed;
              const badges = [...rowBadges(row), ...(row.extraBadge ? [row.extraBadge] : [])];
              const sameKey = `same:${feedbackSourceId}:${row.id}`;
              const differentKey = `different:${feedbackSourceId}:${row.id}`;

              return (
                <ScoredTimelineItem
                  key={row.id}
                  filename={row.filename}
                  cameraName={row.cameraName}
                  timestamp={row.timestamp}
                  badges={badges}
                  matchScore={canFeedback ? (row.matchScore ?? undefined) : undefined}
                  scores={canFeedback ? row.scores : undefined}
                  highlighted={!!row.isAnchor || !!row.isConfirmed || !!row.extraBadge}
                  eagerImage={row.eagerImage}
                  ids={rowIds(row)}
                  footer={renderItemFooter?.(row)}
                  onCropPreview={onCropPreview ? () => onCropPreview(row.filename) : undefined}
                  onPlay={() => { void playRow(row); }}
                  playLoading={clipLoadingId === row.id}
                  onConfirm={canFeedback ? () => { void handleFeedback(row.id, 'same'); } : undefined}
                  onReject={canFeedback ? () => { void handleFeedback(row.id, 'different'); } : undefined}
                  confirmPending={feedbackPending === sameKey}
                  rejectPending={feedbackPending === differentKey}
                  showFeedback={canFeedback}
                />
              );
            })}
          </ScoredTimelineList>
        )}
      </ScoredTimeline>

      <TimelineClipPlaybackDialog
        playback={playback}
        onClose={() => setPlayback(null)}
        nested={nestedPlayback}
      />
    </div>
  );
}
