import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  UserCircle,
  X,
} from 'lucide-react';
import { apiFetch } from '../../../api';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog';
import { REID_CROP_IMG } from '../../constants';
import type {
  ClipObjectDetection,
  PersonClipReference,
  ReidDetection,
  ReidPerson,
  ReidPersonMatch,
  TimelineVideoPlayback,
  TrackMatchRow,
  VideoClip,
} from '../../types';
import { formatDate } from '../../utils/format';
import { mediaUrl } from '../../utils/media';
import { buildScoreBasedTimeline } from '../../utils/reid';
import { CropThumbnail, DeferredCropImage, useDeferredLoad } from '../CropThumbnail';
import { IdsInfoIcon } from '../IdsInfoIcon';
import { MatchScoreBreakdown } from '../MatchScoreBreakdown';
import { TimelineClipPlaybackDialog } from './TimelineClipPlaybackDialog';

export interface PersonAppearancesDialogProps {
  detection: ClipObjectDetection | null;
  onClose: () => void;
  selectedClip: VideoClip | null;
  onClipDetectionsRefresh: () => void | Promise<void>;
  onCropPreview: (filename: string) => void;
}

async function fetchTrackTimeline(detectionId: string) {
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

export function PersonAppearancesDialog({
  detection,
  onClose,
  selectedClip,
  onClipDetectionsRefresh,
  onCropPreview,
}: PersonAppearancesDialogProps) {
  const [personRefs, setPersonRefs] = useState<PersonClipReference[]>([]);
  const [clipPlayback, setClipPlayback] = useState<TimelineVideoPlayback | null>(null);
  const [identityId, setIdentityId] = useState<string | null>(null);
  const [identitySuggestions, setIdentitySuggestions] = useState<ReidPersonMatch[]>([]);
  const [labelDraft, setLabelDraft] = useState('');
  const [labelConfirmed, setLabelConfirmed] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [loading, setLoading] = useState(false);
  const [savingLabel, setSavingLabel] = useState(false);
  const [feedbackPending, setFeedbackPending] = useState<string | null>(null);
  const [brokenCovers, setBrokenCovers] = useState<Set<string>>(new Set());
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const loadIdentitySuggestions = useCallback(async (forIdentityId: string | null) => {
    const suggestions: ReidPersonMatch[] = [];
    const seen = new Set<string>();
    if (forIdentityId) seen.add(forIdentityId);

    if (forIdentityId) {
      try {
        const matchesRes = await apiFetch(`/reid/identities/${forIdentityId}/matches`);
        if (matchesRes.ok) {
          const matches: ReidPersonMatch[] = await matchesRes.json();
          for (const match of matches) {
            if (seen.has(match.id)) continue;
            suggestions.push(match);
            seen.add(match.id);
          }
        }
      } catch (err) {
        console.error('Failed to load identity matches', err);
      }
    }

    try {
      const peopleRes = await apiFetch('/reid/people');
      if (peopleRes.ok) {
        const people: ReidPerson[] = await peopleRes.json();
        for (const person of people) {
          if (seen.has(person.id)) continue;
          suggestions.push({
            id: person.id,
            label: person.label,
            displayName: person.displayName,
            coverFilename: person.coverFilename,
            photoCount: person.photoCount,
            matchScore: 0,
            streamTracks: person.streamTracks.map((st) => ({
              streamId: st.streamId,
              trackId: st.trackId,
            })),
          });
          seen.add(person.id);
        }
      }
    } catch (err) {
      console.error('Failed to load people for identity suggestions', err);
    }

    suggestions.sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return a.displayName.localeCompare(b.displayName);
    });
    setIdentitySuggestions(suggestions);
  }, []);

  const reloadTimeline = useCallback(async (detectionId: string) => {
    const { query, matches } = await fetchTrackTimeline(detectionId);
    if (query?.identityId) {
      setIdentityId(query.identityId);
    }
    if (query?.identity?.label?.trim()) {
      setLabelDraft(query.identity.label.trim());
      setLabelConfirmed(true);
      setShowSuggestions(false);
    }
    setPersonRefs(buildScoreBasedTimeline(query, matches));
    return query?.identityId ?? null;
  }, []);

  useEffect(() => {
    const detectionId = detection?.detectionId;
    if (!detectionId || detection.className !== 'person') {
      setClipPlayback(null);
      setPersonRefs([]);
      setIdentityId(null);
      setIdentitySuggestions([]);
      setLabelDraft('');
      setLabelConfirmed(false);
      setShowSuggestions(true);
      setBrokenCovers(new Set());
      return;
    }

    let cancelled = false;
    const initiallyConfirmed = detection.labelStatus === 'confirmed' && !!detection.label?.trim();
    setPersonRefs([]);
    setIdentityId(detection.identityId ?? null);
    setLabelDraft(initiallyConfirmed ? detection.label! : '');
    setLabelConfirmed(initiallyConfirmed);
    setShowSuggestions(!initiallyConfirmed && !detection.identityId);
    setIdentitySuggestions([]);
    setLoading(true);

    void (async () => {
      try {
        const resolvedIdentityId = await reloadTimeline(detectionId);
        if (cancelled) return;
        await loadIdentitySuggestions(resolvedIdentityId ?? detection.identityId ?? null);
      } catch (err) {
        console.error('Failed to load person references', err);
        if (!cancelled) {
          alert('Could not load appearances for this person.');
          onCloseRef.current();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [detection?.detectionId, detection?.className, loadIdentitySuggestions, reloadTimeline]);

  const handleAssignIdentity = async (suggestion: ReidPersonMatch) => {
    if (!detection?.detectionId) return;
    setSavingLabel(true);
    try {
      const res = await apiFetch(`/reid/detections/${detection.detectionId}/assign-identity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identityId: suggestion.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to assign identity');
        return;
      }

      setIdentityId(suggestion.id);
      const assignedLabel = suggestion.label?.trim() || suggestion.displayName;
      setLabelDraft(assignedLabel);
      setLabelConfirmed(!!suggestion.label?.trim());
      setShowSuggestions(false);
      await reloadTimeline(detection.detectionId);
      await loadIdentitySuggestions(suggestion.id);
      await onClipDetectionsRefresh();
    } catch (err) {
      console.error('Failed to assign existing identity', err);
      alert('Could not assign this person to the selected identity.');
    } finally {
      setSavingLabel(false);
    }
  };

  const handleSaveLabel = async () => {
    if (!detection?.detectionId) return;
    setSavingLabel(true);
    try {
      let resolvedIdentityId = identityId;

      if (identityId) {
        const res = await apiFetch(`/reid/identities/${identityId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: labelDraft }),
        });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || 'Failed to save label');
          return;
        }
      } else {
        const res = await apiFetch(`/reid/detections/${detection.detectionId}/label`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: labelDraft }),
        });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || 'Failed to save label');
          return;
        }
        if (data.detection?.identityId) {
          resolvedIdentityId = data.detection.identityId;
          setIdentityId(data.detection.identityId);
        }
      }

      if (labelDraft.trim()) {
        setLabelConfirmed(true);
        setShowSuggestions(false);
      }
      await onClipDetectionsRefresh();
      if (resolvedIdentityId) {
        await reloadTimeline(detection.detectionId);
        await loadIdentitySuggestions(resolvedIdentityId);
      }
    } catch (err) {
      console.error('Failed to save person label from clip modal', err);
    } finally {
      setSavingLabel(false);
    }
  };

  const handleFeedback = async (targetDetectionId: string, type: 'confirm' | 'reject') => {
    const sourceDetectionId = personRefs.find((r) => r.source === 'query')?.id ?? detection?.detectionId;
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
      if (detection?.detectionId) {
        await reloadTimeline(detection.detectionId);
      }
    } catch (err) {
      console.error('Failed to submit timeline feedback', err);
    } finally {
      setFeedbackPending(null);
    }
  };

  const playReferenceClip = async (ref: PersonClipReference) => {
    if (!ref.clipFilename && !ref.id) return;

    let clipFilename = ref.clipFilename;
    let clipOffsetMs = ref.clipOffsetMs ?? 0;

    if (!clipFilename && ref.id) {
      try {
        const res = await apiFetch(`/reid/detections/${ref.id}/source-clip`);
        if (!res.ok) {
          onCropPreview(ref.filename);
          return;
        }
        const data = await res.json();
        clipFilename = data.clipFilename;
        clipOffsetMs = data.clipOffsetMs ?? 0;
      } catch (err) {
        console.error('Failed to resolve clip for detection', err);
        onCropPreview(ref.filename);
        return;
      }
    }

    if (clipFilename) {
      setClipPlayback({
        filename: clipFilename,
        offsetMs: clipOffsetMs,
        cameraName: ref.cameraName,
        cropFilename: ref.filename,
      });
    } else {
      onCropPreview(ref.filename);
    }
  };

  const playQueryClip = async () => {
    if (!detection?.cropFilename) return;

    let clipFilename = selectedClip?.filename;
    let clipOffsetMs = 0;

    if (!clipFilename && detection.detectionId) {
      try {
        const res = await apiFetch(`/reid/detections/${detection.detectionId}/source-clip`);
        if (!res.ok) {
          onCropPreview(detection.cropFilename);
          return;
        }
        const data = await res.json();
        clipFilename = data.clipFilename;
        clipOffsetMs = data.clipOffsetMs ?? 0;
      } catch (err) {
        console.error('Failed to resolve clip for detection', err);
        onCropPreview(detection.cropFilename);
        return;
      }
    }

    if (clipFilename) {
      setClipPlayback({
        filename: clipFilename,
        offsetMs: clipOffsetMs,
        cameraName: selectedClip?.camera ?? detection.label ?? 'Camera',
        cropFilename: detection.cropFilename,
      });
    } else {
      onCropPreview(detection.cropFilename);
    }
  };

  const editingIdentity = !identityId || !labelConfirmed || showSuggestions;
  const draft = labelDraft.trim().toLowerCase();
  const filteredSuggestions = draft
    ? identitySuggestions.filter((s) =>
        s.displayName.toLowerCase().includes(draft)
        || (s.label?.toLowerCase().includes(draft) ?? false),
      )
    : identitySuggestions;
  const shownSuggestions = filteredSuggestions.slice(0, 8);
  const queryId = personRefs.find((r) => r.source === 'query')?.id;

  return (
    <Dialog open={!!detection} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[640px] p-6 flex flex-col gap-4 max-h-[85vh]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {detection?.cropFilename && (
              <div className="relative shrink-0">
                <CropThumbnail
                  filename={detection.cropFilename}
                  size="md"
                  showHoverPreview={false}
                  playOnClick={false}
                  onPreview={onCropPreview}
                />
                {(selectedClip?.filename || detection.detectionId) && (
                  <button
                    type="button"
                    onClick={() => { void playQueryClip(); }}
                    className="absolute bottom-0.5 right-0.5 p-1 rounded bg-black/75 hover:bg-black/90 border border-white/10 transition-colors"
                    title="Play clip"
                  >
                    <Play size={10} className="text-white" fill="white" />
                  </button>
                )}
              </div>
            )}
            <div className="min-w-0">
              <DialogTitle>Detection timeline & matches</DialogTitle>
              <p className="text-[0.72rem] text-text-muted mt-0.5">
                track {detection?.trackId}
                {detection?.labelStatus === 'confirmed' && detection?.label
                  ? ` · ${detection.label}`
                  : identityId
                    ? ' · linked identity'
                    : ' · unassigned'}
              </p>
              <IdsInfoIcon
                className="mt-1"
                ids={[
                  ...(detection?.detectionId ? [{ label: 'detection', value: detection.detectionId }] : []),
                  ...(identityId ? [{ label: 'identity', value: identityId }] : []),
                ]}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn p-1.5 bg-transparent text-text-muted hover:text-text-primary border-none rounded-lg hover:bg-[rgba(255,255,255,0.06)] shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {!editingIdentity ? (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[0.68rem] font-bold text-text-secondary uppercase tracking-wider">Identity label</p>
              <p className="text-[0.85rem] font-semibold text-text-primary mt-0.5 truncate">{labelDraft}</p>
            </div>
            <button
              type="button"
              onClick={() => setShowSuggestions(true)}
              className="btn btn-secondary py-1 px-2 text-[0.7rem] rounded-md shrink-0"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[0.68rem] font-bold text-text-secondary uppercase tracking-wider">
                {identityId ? 'Identity label' : 'Create new identity'}
              </p>
              {identityId && labelConfirmed && showSuggestions && (
                <button
                  type="button"
                  onClick={() => setShowSuggestions(false)}
                  className="btn btn-secondary py-1 px-2 text-[0.7rem] rounded-md shrink-0"
                >
                  Cancel
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                placeholder={identityId ? 'Name this person' : 'Enter a name to create identity'}
                className="flex-1 text-[0.8rem] py-1.5 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary"
              />
              <button
                type="button"
                onClick={() => { void handleSaveLabel(); }}
                disabled={savingLabel || !labelDraft.trim()}
                className="btn btn-secondary py-1 px-3 text-[0.75rem] shrink-0"
              >
                {savingLabel ? '…' : identityId ? 'Save label' : 'Create'}
              </button>
            </div>
            {!loading && identitySuggestions.length > 0 && shownSuggestions.length > 0 && (
              <div>
                <p className="text-[0.7rem] font-bold text-text-secondary uppercase tracking-wider mb-2">
                  Use existing person
                </p>
                <div className="flex flex-wrap gap-2">
                  {shownSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      disabled={savingLabel || suggestion.id === identityId}
                      onClick={() => { void handleAssignIdentity(suggestion); }}
                      className="glass-panel interactive flex items-center gap-2 py-1.5 px-2.5 rounded-lg text-left disabled:opacity-50"
                    >
                      <IdentitySuggestionAvatar
                        suggestion={suggestion}
                        broken={brokenCovers.has(suggestion.id)}
                        onBroken={() => {
                          setBrokenCovers((prev) => new Set(prev).add(suggestion.id));
                        }}
                      />
                      <div className="min-w-0">
                        <span className="text-[0.75rem] font-semibold text-text-primary block truncate max-w-[140px]">
                          {suggestion.displayName}
                        </span>
                        {suggestion.matchScore > 0 && (
                          <span className="text-[0.65rem] text-secondary">
                            {Math.round(suggestion.matchScore * 100)}% match
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="h-px bg-[rgba(255,255,255,0.07)]" />

        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          <p className="text-[0.68rem] font-bold text-text-secondary uppercase tracking-wider mb-1">
            Scored timeline
          </p>
          <p className="text-[0.65rem] text-text-muted mb-2">
            Ranked by embedding, topology, and your past feedback. Confirm or reject matches to improve future results.
          </p>
          {loading ? (
            <div className="flex justify-center py-10 text-text-muted">
              <RefreshCw size={20} className="animate-spin" />
            </div>
          ) : personRefs.length === 0 ? (
            <p className="text-[0.8rem] text-text-muted text-center py-8">
              No appearances or matches found yet.
            </p>
          ) : (
            <div className="relative border-l-2 border-[rgba(56,189,248,0.25)] ml-3 pl-5 flex flex-col gap-3">
              {personRefs.map((ref) => {
                const isCurrentClip = ref.clipFilename === selectedClip?.filename;
                const isQuery = ref.source === 'query';
                const sourceLabel = isQuery ? 'This detection' : 'Scored match';
                const sourceClass = isQuery
                  ? 'text-primary bg-primary/10 border-primary/20'
                  : 'text-secondary bg-secondary/10 border-secondary/20';
                const confirmKey = `confirm:${queryId}:${ref.id}`;
                const rejectKey = `reject:${queryId}:${ref.id}`;

                return (
                  <div key={ref.id} className="relative">
                    <div className="absolute -left-[23px] top-4 w-2.5 h-2.5 rounded-full bg-[#38bdf8] border-2 border-[#090d16]" />
                    <div className={`glass-panel p-2.5 flex items-start gap-3 w-full ${isCurrentClip ? 'border-primary/40' : ''}`}>
                      <div className="relative shrink-0">
                        <DeferredCropImage
                          filename={ref.filename}
                          size="md"
                          eager={isQuery}
                          onClick={() => onCropPreview(ref.filename)}
                          title="Click to enlarge crop"
                        />
                        {(ref.clipFilename || ref.id) && (
                          <button
                            type="button"
                            onClick={() => { void playReferenceClip(ref); }}
                            className="absolute bottom-0.5 right-0.5 p-1 rounded bg-black/75 hover:bg-black/90 border border-white/10 transition-colors"
                            title="Play clip"
                          >
                            <Play size={10} className="text-white" fill="white" />
                          </button>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[0.8rem] font-semibold text-text-primary">{ref.cameraName}</span>
                          <span className={`text-[0.58rem] px-1.5 py-0.5 rounded-full border ${sourceClass}`}>
                            {sourceLabel}
                          </span>
                          {isCurrentClip && (
                            <span className="text-[0.6rem] text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">This clip</span>
                          )}
                          {ref.trackId != null && ref.trackId > 0 && (
                            <span className="text-[0.6rem] text-text-muted">track {ref.trackId}</span>
                          )}
                          {ref.matchScore != null && !isQuery && (
                            <span className="text-[0.6rem] text-secondary font-semibold">
                              {Math.round(ref.matchScore * 100)}% match
                            </span>
                          )}
                          <IdsInfoIcon ids={[{ label: 'detection', value: ref.id }]} />
                        </div>
                        <p className="text-[0.7rem] text-text-muted mt-0.5">{formatDate(ref.timestamp)}</p>
                        {ref.scores && !isQuery && <MatchScoreBreakdown scores={ref.scores} />}
                      </div>
                      {!isQuery && (
                        <div className="flex flex-col gap-1 shrink-0">
                          <button
                            type="button"
                            title="Same person"
                            disabled={!!feedbackPending}
                            onClick={() => { void handleFeedback(ref.id, 'confirm'); }}
                            className="btn btn-secondary p-1.5 border-none hover:text-green-400"
                          >
                            <ThumbsUp size={13} className={feedbackPending === confirmKey ? 'animate-pulse' : ''} />
                          </button>
                          <button
                            type="button"
                            title="Different person"
                            disabled={!!feedbackPending}
                            onClick={() => { void handleFeedback(ref.id, 'reject'); }}
                            className="btn btn-secondary p-1.5 border-none hover:text-danger"
                          >
                            <ThumbsDown size={13} className={feedbackPending === rejectKey ? 'animate-pulse' : ''} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>

      <TimelineClipPlaybackDialog
        playback={clipPlayback}
        onClose={() => setClipPlayback(null)}
        nested
      />
    </Dialog>
  );
}

function IdentitySuggestionAvatar({
  suggestion,
  broken,
  onBroken,
}: {
  suggestion: ReidPersonMatch;
  broken: boolean;
  onBroken: () => void;
}) {
  const { ref, shouldLoad } = useDeferredLoad(true);

  if (broken || !suggestion.coverFilename) {
    return (
      <div className="w-8 h-8 rounded-full overflow-hidden border border-border-glass shrink-0 bg-black flex items-center justify-center">
        <UserCircle size={14} className="text-text-muted" />
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="w-8 h-8 rounded-full overflow-hidden border border-border-glass shrink-0 bg-black"
    >
      {shouldLoad ? (
        <img
          src={mediaUrl(`/crops/${suggestion.coverFilename}`)}
          alt=""
          onError={onBroken}
          className={`w-full h-full ${REID_CROP_IMG}`}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-[#0a0f1a]">
          <UserCircle size={14} className="text-text-muted/50" />
        </div>
      )}
    </div>
  );
}
