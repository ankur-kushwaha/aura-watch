import { useCallback, useEffect, useState } from 'react';
import {
  Play,
  UserCircle,
  X,
} from 'lucide-react';
import { apiFetch } from '../../../api';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog';
import { REID_CROP_IMG } from '../../constants';
import type {
  ClipObjectDetection,
  ReidPerson,
  ReidPersonMatch,
  TimelineVideoPlayback,
  VideoClip,
} from '../../types';
import { mediaUrl } from '../../utils/media';
import { useDeferredLoad } from '../../hooks/useDeferredLoad';
import { CropThumbnail } from '../CropThumbnail';
import { IdsInfoIcon } from '../IdsInfoIcon';
import { ReidTimeline } from '../ReidTimeline';
import { TimelineClipPlaybackDialog } from './TimelineClipPlaybackDialog';

export interface PersonAppearancesDialogProps {
  detection: ClipObjectDetection | null;
  onClose: () => void;
  selectedClip: VideoClip | null;
  onClipDetectionsRefresh: () => void | Promise<void>;
  onCropPreview: (filename: string) => void;
}

function getInitialIdentityState(detection: ClipObjectDetection) {
  const initiallyConfirmed = detection.labelStatus === 'confirmed' && !!detection.label?.trim();
  return {
    identityId: detection.identityId ?? null,
    labelDraft: initiallyConfirmed ? detection.label! : '',
    labelConfirmed: initiallyConfirmed,
    showSuggestions: !initiallyConfirmed && !detection.identityId,
  };
}

interface PersonAppearancesDialogBodyProps {
  detection: ClipObjectDetection;
  onClose: () => void;
  selectedClip: VideoClip | null;
  onClipDetectionsRefresh: () => void | Promise<void>;
  onCropPreview: (filename: string) => void;
}

export function PersonAppearancesDialog({
  detection,
  onClose,
  selectedClip,
  onClipDetectionsRefresh,
  onCropPreview,
}: PersonAppearancesDialogProps) {
  return (
    <Dialog open={!!detection} onOpenChange={(open) => { if (!open) onClose(); }}>
      {detection && (
        <PersonAppearancesDialogBody
          key={detection.detectionId}
          detection={detection}
          onClose={onClose}
          selectedClip={selectedClip}
          onClipDetectionsRefresh={onClipDetectionsRefresh}
          onCropPreview={onCropPreview}
        />
      )}
    </Dialog>
  );
}

function PersonAppearancesDialogBody({
  detection,
  onClose,
  selectedClip,
  onClipDetectionsRefresh,
  onCropPreview,
}: PersonAppearancesDialogBodyProps) {
  const initialIdentity = getInitialIdentityState(detection);
  const [clipPlayback, setClipPlayback] = useState<TimelineVideoPlayback | null>(null);
  const [identityId, setIdentityId] = useState<string | null>(initialIdentity.identityId);
  const [identitySuggestions, setIdentitySuggestions] = useState<ReidPersonMatch[]>([]);
  const [labelDraft, setLabelDraft] = useState(initialIdentity.labelDraft);
  const [labelConfirmed, setLabelConfirmed] = useState(initialIdentity.labelConfirmed);
  const [showSuggestions, setShowSuggestions] = useState(initialIdentity.showSuggestions);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  const [savingLabel, setSavingLabel] = useState(false);
  const [brokenCovers, setBrokenCovers] = useState<Set<string>>(new Set());
  const [timelineKey, setTimelineKey] = useState(0);

  const loadIdentitySuggestions = useCallback(async (forIdentityId: string | null, forDetectionId: string) => {
    const suggestions: ReidPersonMatch[] = [];
    const scoreById = new Map<string, number>();
    const seen = new Set<string>();
    if (forIdentityId) seen.add(forIdentityId);

    try {
      const detectionMatchesRes = await apiFetch(`/reid/detections/${forDetectionId}/identity-suggestions`);
      if (detectionMatchesRes.ok) {
        const detectionMatches: ReidPersonMatch[] = await detectionMatchesRes.json();
        for (const match of detectionMatches) {
          if (seen.has(match.id)) continue;
          suggestions.push(match);
          scoreById.set(match.id, match.matchScore);
          seen.add(match.id);
        }
      }
    } catch (err) {
      console.error('Failed to load detection identity suggestions', err);
    }

    if (forIdentityId) {
      try {
        const matchesRes = await apiFetch(`/reid/identities/${forIdentityId}/matches`);
        if (matchesRes.ok) {
          const matches: ReidPersonMatch[] = await matchesRes.json();
          for (const match of matches) {
            if (seen.has(match.id)) continue;
            suggestions.push(match);
            scoreById.set(match.id, match.matchScore);
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
            matchScore: scoreById.get(person.id) ?? 0,
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
    setSuggestionsLoaded(true);
  }, []);

  useEffect(() => {
    if (!detection.detectionId) return;
    void loadIdentitySuggestions(identityId ?? detection.identityId ?? null, detection.detectionId);
  }, [detection.detectionId, detection.identityId, identityId, loadIdentitySuggestions]);

  const bumpTimeline = () => setTimelineKey((k) => k + 1);

  const handleIdentityResolved = useCallback((resolvedId: string | null, label?: string | null) => {
    if (resolvedId) setIdentityId(resolvedId);
    if (label?.trim()) {
      setLabelDraft(label.trim());
      setLabelConfirmed(true);
      setShowSuggestions(false);
    }
    void loadIdentitySuggestions(resolvedId ?? detection.identityId ?? null, detection.detectionId!);
  }, [detection.detectionId, detection.identityId, loadIdentitySuggestions]);

  const handleAssignIdentity = async (suggestion: ReidPersonMatch) => {
    if (!detection.detectionId) return;
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
      bumpTimeline();
      await loadIdentitySuggestions(suggestion.id, detection.detectionId);
      await onClipDetectionsRefresh();
    } catch (err) {
      console.error('Failed to assign existing identity', err);
      alert('Could not assign this person to the selected identity.');
    } finally {
      setSavingLabel(false);
    }
  };

  const handleSaveLabel = async () => {
    if (!detection.detectionId) return;
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
      bumpTimeline();
      await onClipDetectionsRefresh();
      if (resolvedIdentityId) {
        await loadIdentitySuggestions(resolvedIdentityId, detection.detectionId);
      }
    } catch (err) {
      console.error('Failed to save person label from clip modal', err);
    } finally {
      setSavingLabel(false);
    }
  };

  const playQueryClip = async () => {
    if (!detection.cropFilename) return;

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

  if (!detection.detectionId) return null;

  return (
    <>
      <DialogContent className="max-w-[640px] p-6 flex flex-col gap-4 max-h-[85vh]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {detection.cropFilename && (
              <CropThumbnail
                filename={detection.cropFilename}
                size="md"
                showHoverPreview={false}
                playOnClick={false}
                onPreview={onCropPreview}
              />
            )}
            <div className="min-w-0 flex-1">
              <DialogTitle>Detection timeline & matches</DialogTitle>
              <p className="text-[0.72rem] text-text-muted mt-0.5">
                {detection.labelStatus === 'confirmed' && detection.label
                  ? ` · ${detection.label}`
                  : identityId
                    ? ' · linked identity'
                    : ' · unassigned'}
              </p>
              <IdsInfoIcon
                className="mt-1"
                ids={[
                  { label: 'detection', value: detection.detectionId },
                  ...(identityId ? [{ label: 'identity', value: identityId }] : []),
                ]}
              />
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {detection.cropFilename && (selectedClip?.filename || detection.detectionId) && (
              <button
                type="button"
                onClick={() => { void playQueryClip(); }}
                className="btn btn-secondary p-2 rounded-lg hover:border-primary/40 hover:text-primary"
                title="Play clip"
              >
                <Play size={16} fill="currentColor" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="btn p-1.5 bg-transparent text-text-muted hover:text-text-primary border-none rounded-lg hover:bg-[rgba(255,255,255,0.06)] shrink-0"
            >
              <X size={16} />
            </button>
          </div>
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
                className="flex-1 text-[0.8rem] py-1.5 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-border-glass text-text-primary"
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
            {suggestionsLoaded && identitySuggestions.length > 0 && shownSuggestions.length > 0 && (
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
                          <span className="text-[0.65rem] text-secondary font-semibold">
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
          <ReidTimeline
            key={timelineKey}
            source={{ mode: 'detection', detectionId: detection.detectionId }}
            highlightClipFilename={selectedClip?.filename}
            onCropPreview={onCropPreview}
            onIdentityResolved={handleIdentityResolved}
            onUpdated={onClipDetectionsRefresh}
            nestedPlayback
          />
        </div>
      </DialogContent>

      <TimelineClipPlaybackDialog
        playback={clipPlayback}
        onClose={() => setClipPlayback(null)}
        nested
      />
    </>
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
