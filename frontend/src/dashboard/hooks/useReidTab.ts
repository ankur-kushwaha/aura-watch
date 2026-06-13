import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api';
import type {
  CameraStream,
  ReidDetection,
  ReidPerson,
  ReidPersonMatch,
  ReidRoute,
  TimelineVideoPlayback,
} from '../types';

export interface UseReidTabOptions {
  streams: CameraStream[];
  hasOnlineDevices: boolean;
  active: boolean;
}

export function useReidTab({ streams, hasOnlineDevices, active }: UseReidTabOptions) {
  const [reidPeople, setReidPeople] = useState<ReidPerson[]>([]);
  const [loadingReidPeople, setLoadingReidPeople] = useState(false);
  const [brokenIdentityCovers, setBrokenIdentityCovers] = useState<Set<string>>(new Set());
  const [deletingIdentityId, setDeletingIdentityId] = useState<string | null>(null);
  const [reidView, setReidView] = useState<'people' | 'person'>('people');
  const [selectedPerson, setSelectedPerson] = useState<ReidPerson | null>(null);
  const [personTimeline, setPersonTimeline] = useState<ReidDetection[]>([]);
  const [personSuggestions, setPersonSuggestions] = useState<ReidPersonMatch[]>([]);
  const [loadingPersonDetail, setLoadingPersonDetail] = useState(false);
  const [linkPeopleMode, setLinkPeopleMode] = useState(false);
  const [linkPeopleSelection, setLinkPeopleSelection] = useState<string[]>([]);
  const [identityLabelDraft, setIdentityLabelDraft] = useState('');
  const [savingIdentityLabel, setSavingIdentityLabel] = useState(false);
  const [feedbackPending, setFeedbackPending] = useState<string | null>(null);
  const [showTopology, setShowTopology] = useState(false);
  const [reidRefreshNonce, setReidRefreshNonce] = useState(0);
  const [timelineVideo, setTimelineVideo] = useState<TimelineVideoPlayback | null>(null);
  const [timelineClipLoading, setTimelineClipLoading] = useState<string | null>(null);
  const [showIdentitySuggestions, setShowIdentitySuggestions] = useState(false);
  const [topologyRoutes, setTopologyRoutes] = useState<ReidRoute[]>([]);
  const [newRoute, setNewRoute] = useState<ReidRoute>({
    fromCamera: '',
    toCamera: '',
    minTimeSeconds: 5,
    maxTimeSeconds: 60,
    topologyScore: 1.0,
  });

  const fetchReidPeople = useCallback(async () => {
    setLoadingReidPeople(true);
    try {
      const res = await apiFetch('/reid/people');
      const data = await res.json();
      setReidPeople(data);
      setBrokenIdentityCovers(new Set());
    } catch (err) {
      console.error('Failed to fetch ReID people', err);
    } finally {
      setLoadingReidPeople(false);
    }
  }, []);

  const fetchTopology = useCallback(async () => {
    try {
      const res = await apiFetch('/reid/topology');
      const data = await res.json();
      setTopologyRoutes(data);
    } catch (err) {
      console.error('Failed to fetch topology routes', err);
    }
  }, []);

  const openPersonDetail = useCallback(async (person: ReidPerson) => {
    setSelectedPerson(person);
    setReidView('person');
    setIdentityLabelDraft(person.label || '');
    setShowIdentitySuggestions(!person.label?.trim());
    setLoadingPersonDetail(true);
    try {
      const [journeyRes, matchesRes] = await Promise.all([
        apiFetch(`/reid/identities/${person.id}/journey`),
        apiFetch(`/reid/identities/${person.id}/matches`),
      ]);
      const journey = await journeyRes.json();
      const matches = await matchesRes.json();
      setPersonTimeline(journey.detections || []);
      setPersonSuggestions(matches || []);
      if (journey.identity) {
        setSelectedPerson((prev) => prev ? {
          ...prev,
          label: journey.identity.label,
          displayName: journey.identity.label || prev.displayName,
          photoCount: journey.detections?.length ?? prev.photoCount,
        } : null);
        setIdentityLabelDraft(journey.identity.label || '');
      }
    } catch (err) {
      console.error('Failed to load person detail', err);
    } finally {
      setLoadingPersonDetail(false);
    }
  }, []);

  const closePersonDetail = useCallback(() => {
    setReidView('people');
    setSelectedPerson(null);
    setPersonTimeline([]);
    setPersonSuggestions([]);
    setTimelineVideo(null);
    setShowIdentitySuggestions(false);
    void fetchReidPeople();
  }, [fetchReidPeople]);

  const playTimelineCrop = useCallback(async (crop: ReidDetection) => {
    setTimelineClipLoading(crop.id);
    try {
      let clipFilename = crop.clipFilename;
      let clipOffsetMs = crop.clipOffsetMs ?? 0;

      if (!clipFilename) {
        const res = await apiFetch(`/reid/detections/${crop.id}/source-clip`);
        if (!res.ok) {
          alert('No video clip found for this detection.');
          return;
        }
        const data = await res.json();
        clipFilename = data.clipFilename;
        clipOffsetMs = data.clipOffsetMs ?? 0;
        setPersonTimeline((prev) =>
          prev.map((d) =>
            d.id === crop.id ? { ...d, clipFilename, clipOffsetMs } : d,
          ),
        );
      }

      setTimelineVideo({
        filename: clipFilename!,
        offsetMs: clipOffsetMs,
        cameraName: crop.cameraName,
        cropFilename: crop.filename,
      });
    } catch (err) {
      console.error('Failed to resolve clip for detection', err);
      alert('Could not load video for this detection.');
    } finally {
      setTimelineClipLoading(null);
    }
  }, []);

  const handleSavePersonLabel = useCallback(async () => {
    if (!selectedPerson) return;
    setSavingIdentityLabel(true);
    try {
      const res = await apiFetch(`/reid/identities/${selectedPerson.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: identityLabelDraft }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to save label');
        return;
      }
      const newLabel = data.identity?.label || identityLabelDraft;
      setSelectedPerson((prev) => prev ? {
        ...prev,
        label: newLabel,
        displayName: newLabel || prev.displayName,
      } : null);
      if (newLabel?.trim()) {
        setShowIdentitySuggestions(false);
      }
      await fetchReidPeople();
    } catch (err) {
      console.error('Failed to save person label', err);
    } finally {
      setSavingIdentityLabel(false);
    }
  }, [selectedPerson, identityLabelDraft, fetchReidPeople]);

  const handleStreamTrackFeedback = useCallback(async (
    type: 'same_person' | 'different_person',
    sourceStreamId: string,
    sourceTrackId: number,
    targetStreamId: string,
    targetTrackId: number,
  ) => {
    const key = `${type}:${sourceStreamId}:${sourceTrackId}:${targetStreamId}:${targetTrackId}`;
    setFeedbackPending(key);
    try {
      const res = await apiFetch('/reid/feedback/stream-track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, sourceStreamId, sourceTrackId, targetStreamId, targetTrackId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to save feedback');
        return;
      }
      await fetchReidPeople();
      if (selectedPerson) {
        const updated = reidPeople.find((p) => p.id === selectedPerson.id)
          || (data.identityId ? { ...selectedPerson, id: data.identityId } : selectedPerson);
        await openPersonDetail(updated);
      }
    } catch (err) {
      console.error('Failed to submit stream-track feedback', err);
    } finally {
      setFeedbackPending(null);
    }
  }, [selectedPerson, reidPeople, fetchReidPeople, openPersonDetail]);

  const handleLinkPeopleSelection = useCallback((personId: string) => {
    setLinkPeopleSelection((prev) => {
      if (prev.includes(personId)) return prev.filter((id) => id !== personId);
      if (prev.length >= 2) return [prev[1], personId];
      return [...prev, personId];
    });
  }, []);

  const handleDeleteIdentity = useCallback(async (person: ReidPerson, e: React.MouseEvent) => {
    e.stopPropagation();
    if (linkPeopleMode) return;

    const label = person.displayName || 'this person';
    if (!confirm(`Delete "${label}" and all ${person.photoCount} associated crop(s)? This cannot be undone.`)) {
      return;
    }

    setDeletingIdentityId(person.id);
    try {
      const res = await apiFetch(`/reid/identities/${person.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to delete identity');
        return;
      }

      if (selectedPerson?.id === person.id) {
        closePersonDetail();
      } else {
        setReidPeople((prev) => prev.filter((p) => p.id !== person.id));
      }
    } catch (err) {
      console.error('Failed to delete identity', err);
      alert('Failed to delete identity');
    } finally {
      setDeletingIdentityId(null);
    }
  }, [linkPeopleMode, selectedPerson?.id, closePersonDetail]);

  const handleLinkPeople = useCallback(async () => {
    if (linkPeopleSelection.length !== 2) {
      alert('Select exactly 2 people to link.');
      return;
    }
    try {
      const [idA, idB] = linkPeopleSelection;
      const [jA, jB] = await Promise.all([
        apiFetch(`/reid/identities/${idA}/journey`).then((r) => r.json()),
        apiFetch(`/reid/identities/${idB}/journey`).then((r) => r.json()),
      ]);
      const detA = jA.detections?.[0]?.id;
      const detB = jB.detections?.[0]?.id;
      if (!detA || !detB) {
        alert('Could not find crops to link.');
        return;
      }
      const res = await apiFetch('/reid/identities/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ detectionIds: [detA, detB] }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to link people');
        return;
      }
      setLinkPeopleSelection([]);
      setLinkPeopleMode(false);
      await fetchReidPeople();
    } catch (err) {
      console.error('Failed to link people', err);
    }
  }, [linkPeopleSelection, fetchReidPeople]);

  const handleAddTopology = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoute.fromCamera || !newRoute.toCamera) {
      alert('Select both source and target cameras.');
      return;
    }
    if (newRoute.fromCamera === newRoute.toCamera) {
      alert('Source and target cameras must be different.');
      return;
    }
    try {
      const fromStream = streams.find((s) => s.name === newRoute.fromCamera);
      const toStream = streams.find((s) => s.name === newRoute.toCamera);
      const payload = {
        ...newRoute,
        fromStreamId: fromStream?.streamId,
        toStreamId: toStream?.streamId,
      };

      const res = await apiFetch('/reid/topology', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        void fetchTopology();
        setNewRoute((prev) => ({
          ...prev,
          fromCamera: '',
          toCamera: '',
        }));
      }
    } catch (err) {
      console.error('Failed to save topology route', err);
    }
  }, [newRoute, streams, fetchTopology]);

  const triggerReidRefresh = useCallback(() => {
    setReidRefreshNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (active) {
      void fetchReidPeople();
      void fetchTopology();
    }
  }, [active, fetchReidPeople, fetchTopology]);

  useEffect(() => {
    if (!hasOnlineDevices && reidView === 'person') {
      setReidView('people');
      setSelectedPerson(null);
      setPersonTimeline([]);
      setPersonSuggestions([]);
      setTimelineVideo(null);
      setShowIdentitySuggestions(false);
    }
  }, [hasOnlineDevices, reidView]);

  useEffect(() => {
    if (active) {
      void fetchReidPeople();
      if (reidView === 'person' && selectedPerson) {
        void openPersonDetail(selectedPerson);
      }
    }
  }, [hasOnlineDevices, active, fetchReidPeople]);

  useEffect(() => {
    if (active && reidRefreshNonce > 0) {
      void fetchReidPeople();
      if (reidView === 'person' && selectedPerson) {
        void openPersonDetail(selectedPerson);
      }
    }
  }, [reidRefreshNonce]);

  return {
    streams,
    hasOnlineDevices,
    reidPeople,
    loadingReidPeople,
    brokenIdentityCovers,
    setBrokenIdentityCovers,
    deletingIdentityId,
    reidView,
    selectedPerson,
    personTimeline,
    personSuggestions,
    loadingPersonDetail,
    linkPeopleMode,
    setLinkPeopleMode,
    linkPeopleSelection,
    setLinkPeopleSelection,
    identityLabelDraft,
    setIdentityLabelDraft,
    savingIdentityLabel,
    feedbackPending,
    showTopology,
    setShowTopology,
    timelineVideo,
    setTimelineVideo,
    timelineClipLoading,
    showIdentitySuggestions,
    setShowIdentitySuggestions,
    topologyRoutes,
    newRoute,
    setNewRoute,
    fetchReidPeople,
    openPersonDetail,
    closePersonDetail,
    playTimelineCrop,
    handleSavePersonLabel,
    handleStreamTrackFeedback,
    handleLinkPeopleSelection,
    handleDeleteIdentity,
    handleLinkPeople,
    handleAddTopology,
    triggerReidRefresh,
  };
}

export type ReidTabState = ReturnType<typeof useReidTab>;
