import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../api';
import { REID_DETECTIONS_PAGE_SIZE } from '../constants';
import type {
  CameraStream,
  DetectionFilterParams,
  ReidDetection,
  ReidPerson,
  ReidPersonMatch,
  ReidRoute,
} from '../types';
import { buildDetectionsQueryString } from '../utils/clips';

export interface UseReidTabOptions {
  streams: CameraStream[];
  hasOnlineDevices: boolean;
  active: boolean;
}

export function useReidTab({ streams, hasOnlineDevices, active }: UseReidTabOptions) {
  const [reidPeople, setReidPeople] = useState<ReidPerson[]>([]);
  const [reidDetections, setReidDetections] = useState<ReidDetection[]>([]);
  const [reidDetectionsTotal, setReidDetectionsTotal] = useState(0);
  const [loadingReidPeople, setLoadingReidPeople] = useState(false);
  const [loadingReidDetections, setLoadingReidDetections] = useState(false);
  const [loadingMoreReidDetections, setLoadingMoreReidDetections] = useState(false);
  const [brokenIdentityCovers, setBrokenIdentityCovers] = useState<Set<string>>(new Set());
  const [brokenDetectionCrops, setBrokenDetectionCrops] = useState<Set<string>>(new Set());
  const [deletingIdentityId, setDeletingIdentityId] = useState<string | null>(null);
  const [reidView, setReidView] = useState<'people' | 'person' | 'detection'>('people');
  const [selectedPerson, setSelectedPerson] = useState<ReidPerson | null>(null);
  const [selectedDetection, setSelectedDetection] = useState<ReidDetection | null>(null);
  const [personSuggestions, setPersonSuggestions] = useState<ReidPersonMatch[]>([]);
  const [loadingPersonDetail, setLoadingPersonDetail] = useState(false);
  const [linkDetectionsMode, setLinkDetectionsMode] = useState(false);
  const [linkDetectionsSelection, setLinkDetectionsSelection] = useState<string[]>([]);
  const [mergingDetections, setMergingDetections] = useState(false);
  const [identityLabelDraft, setIdentityLabelDraft] = useState('');
  const [savingIdentityLabel, setSavingIdentityLabel] = useState(false);
  const [feedbackPending, setFeedbackPending] = useState<string | null>(null);
  const [showTopology, setShowTopology] = useState(false);
  const [showIdentitySuggestions, setShowIdentitySuggestions] = useState(false);
  const [topologyRoutes, setTopologyRoutes] = useState<ReidRoute[]>([]);
  const [detectionFilterStreamId, setDetectionFilterStreamId] = useState('');
  const [detectionFilterCameraName, setDetectionFilterCameraName] = useState('');
  const [detectionFilterStartTime, setDetectionFilterStartTime] = useState('');
  const [detectionFilterEndTime, setDetectionFilterEndTime] = useState('');
  const [showDetectionFilters, setShowDetectionFilters] = useState(false);

  const reidViewRef = useRef(reidView);
  const selectedPersonIdRef = useRef<string | null>(null);
  const reidDetectionsCountRef = useRef(0);
  const reidRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const detectionFilterParams = useMemo<DetectionFilterParams>(
    () => ({
      streamId: detectionFilterStreamId,
      cameraName: detectionFilterCameraName,
      startTime: detectionFilterStartTime,
      endTime: detectionFilterEndTime,
    }),
    [
      detectionFilterStreamId,
      detectionFilterCameraName,
      detectionFilterStartTime,
      detectionFilterEndTime,
    ],
  );

  const detectionFilterParamsRef = useRef(detectionFilterParams);

  const detectionFilterCameras = useMemo(
    () => [...new Set(streams.map((s) => s.name))].sort(),
    [streams],
  );

  const detectionFilterStreams = useMemo(
    () => (detectionFilterCameraName
      ? streams.filter((s) => s.name === detectionFilterCameraName)
      : streams),
    [streams, detectionFilterCameraName],
  );

  const hasActiveDetectionFilters = Boolean(
    detectionFilterStreamId
    || detectionFilterCameraName
    || detectionFilterStartTime
    || detectionFilterEndTime,
  );

  useEffect(() => {
    reidViewRef.current = reidView;
  }, [reidView]);

  useEffect(() => {
    selectedPersonIdRef.current = selectedPerson?.id ?? null;
  }, [selectedPerson?.id]);

  useEffect(() => {
    reidDetectionsCountRef.current = reidDetections.length;
  }, [reidDetections.length]);

  useEffect(() => {
    detectionFilterParamsRef.current = detectionFilterParams;
  }, [detectionFilterParams]);

  const fetchReidDetectionsPage = useCallback(async (
    offset: number,
    limit: number,
    filters?: DetectionFilterParams,
  ): Promise<{ detections: ReidDetection[]; total: number; hasMore: boolean } | null> => {
    try {
      const qs = buildDetectionsQueryString(
        limit,
        offset,
        filters ?? detectionFilterParamsRef.current,
      );
      const res = await apiFetch(`/reid/detections?${qs}`);
      const data = await res.json();
      return {
        detections: data.detections ?? [],
        total: data.total ?? 0,
        hasMore: !!data.hasMore,
      };
    } catch (err) {
      console.error('Failed to fetch ReID detections', err);
      return null;
    }
  }, []);

  const fetchReidPeople = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoadingReidPeople(true);
    try {
      const res = await apiFetch('/reid/people');
      const data = await res.json();
      setReidPeople(data);
      if (!options?.silent) {
        setBrokenIdentityCovers(new Set());
      }
    } catch (err) {
      console.error('Failed to fetch ReID people', err);
    } finally {
      if (!options?.silent) setLoadingReidPeople(false);
    }
  }, []);

  const fetchReidDetections = useCallback(async (
    options?: { silent?: boolean; filtersOverride?: DetectionFilterParams },
  ) => {
    const filters = options?.filtersOverride ?? detectionFilterParamsRef.current;
    if (options?.silent) {
      const limit = Math.max(reidDetectionsCountRef.current, REID_DETECTIONS_PAGE_SIZE);
      const page = await fetchReidDetectionsPage(0, limit, filters);
      if (!page) return;
      setReidDetections(page.detections);
      setReidDetectionsTotal(page.total);
      return;
    }
    setLoadingReidDetections(true);
    try {
      const page = await fetchReidDetectionsPage(0, REID_DETECTIONS_PAGE_SIZE, filters);
      if (!page) return;
      setReidDetections(page.detections);
      setReidDetectionsTotal(page.total);
      setBrokenDetectionCrops(new Set());
    } finally {
      setLoadingReidDetections(false);
    }
  }, [fetchReidDetectionsPage]);

  const loadMoreReidDetections = useCallback(async () => {
    if (loadingMoreReidDetections || reidDetections.length >= reidDetectionsTotal) return;
    setLoadingMoreReidDetections(true);
    try {
      const page = await fetchReidDetectionsPage(
        reidDetections.length,
        REID_DETECTIONS_PAGE_SIZE,
      );
      if (!page) return;
      setReidDetections((prev) => [...prev, ...page.detections]);
      setReidDetectionsTotal(page.total);
    } finally {
      setLoadingMoreReidDetections(false);
    }
  }, [
    fetchReidDetectionsPage,
    loadingMoreReidDetections,
    reidDetections.length,
    reidDetectionsTotal,
  ]);

  const refreshLoadedReidDetections = useCallback(async () => {
    const limit = Math.max(reidDetectionsCountRef.current, REID_DETECTIONS_PAGE_SIZE);
    const page = await fetchReidDetectionsPage(0, limit);
    if (!page) return;
    setReidDetections(page.detections);
    setReidDetectionsTotal(page.total);
  }, [fetchReidDetectionsPage]);

  const clearDetectionFilters = useCallback(() => {
    const cleared: DetectionFilterParams = {
      streamId: '',
      cameraName: '',
      startTime: '',
      endTime: '',
    };
    setDetectionFilterStreamId('');
    setDetectionFilterCameraName('');
    setDetectionFilterStartTime('');
    setDetectionFilterEndTime('');
    void fetchReidDetections({ filtersOverride: cleared });
  }, [fetchReidDetections]);

  const fetchTopology = useCallback(async () => {
    try {
      const res = await apiFetch('/reid/topology');
      const data = await res.json();
      setTopologyRoutes(data);
    } catch (err) {
      console.error('Failed to fetch topology routes', err);
    }
  }, []);

  const loadPersonDetailData = useCallback(async (personId: string) => {
    const [journeyRes, matchesRes] = await Promise.all([
      apiFetch(`/reid/identities/${personId}/journey`),
      apiFetch(`/reid/identities/${personId}/matches`),
    ]);
    return {
      journey: await journeyRes.json(),
      matches: await matchesRes.json(),
    };
  }, []);

  const applyPersonDetailData = useCallback((
    journey: { identity?: ReidPerson; detections?: { linkStatus?: string }[]; confirmedCount?: number },
    matches: ReidPersonMatch[],
    person?: ReidPerson | null,
  ) => {
    setPersonSuggestions(matches || []);
    if (journey.identity) {
      const confirmedCount = journey.confirmedCount ?? journey.detections?.filter(
        (d) => d.linkStatus !== 'approximate',
      ).length ?? 0;
      setSelectedPerson((prev) => {
        const base = person ?? prev;
        if (!base) return prev;
        return {
          ...base,
          label: journey.identity?.label ?? base.label,
          displayName: journey.identity?.label || base.displayName,
          photoCount: confirmedCount || base.photoCount,
        };
      });
      setIdentityLabelDraft(journey.identity.label || '');
    }
  }, []);

  const refreshPersonDetail = useCallback(async (options?: { silent?: boolean }) => {
    const personId = selectedPersonIdRef.current;
    if (!personId) return;

    if (!options?.silent) setLoadingPersonDetail(true);
    try {
      const { journey, matches } = await loadPersonDetailData(personId);
      applyPersonDetailData(journey, matches);
    } catch (err) {
      console.error('Failed to load person detail', err);
    } finally {
      if (!options?.silent) setLoadingPersonDetail(false);
    }
  }, [applyPersonDetailData, loadPersonDetailData]);

  const openPersonDetail = useCallback(async (person: ReidPerson) => {
    setSelectedDetection(null);
    setSelectedPerson(person);
    setReidView('person');
    setIdentityLabelDraft(person.label || '');
    setShowIdentitySuggestions(!person.label?.trim());
    setLoadingPersonDetail(true);
    try {
      const { journey, matches } = await loadPersonDetailData(person.id);
      applyPersonDetailData(journey, matches, person);
    } catch (err) {
      console.error('Failed to load person detail', err);
    } finally {
      setLoadingPersonDetail(false);
    }
  }, [applyPersonDetailData, loadPersonDetailData]);

  const openDetectionDetail = useCallback((detection: ReidDetection) => {
    setSelectedPerson(null);
    setPersonSuggestions([]);
    setShowIdentitySuggestions(false);
    setSelectedDetection(detection);
    setReidView('detection');
  }, []);

  const closePersonDetail = useCallback(() => {
    setReidView('people');
    setSelectedPerson(null);
    setSelectedDetection(null);
    setPersonSuggestions([]);
    setShowIdentitySuggestions(false);
    void fetchReidPeople();
    void fetchReidDetections();
  }, [fetchReidPeople, fetchReidDetections]);

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
    type: 'same' | 'different',
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

  const handleDeleteIdentity = useCallback(async (person: ReidPerson, e: React.MouseEvent) => {
    e.stopPropagation();

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
  }, [selectedPerson?.id, closePersonDetail]);

  const handleLinkDetectionsSelection = useCallback((detectionId: string) => {
    setLinkDetectionsSelection((prev) => {
      if (prev.includes(detectionId)) return prev.filter((id) => id !== detectionId);
      return [...prev, detectionId];
    });
  }, []);

  const handleLinkDetections = useCallback(async () => {
    if (linkDetectionsSelection.length < 2) {
      alert('Select at least 2 detections to link as the same object.');
      return;
    }
    setMergingDetections(true);
    try {
      const res = await apiFetch('/reid/identities/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ detectionIds: linkDetectionsSelection }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to link detections');
        return;
      }
      setLinkDetectionsSelection([]);
      setLinkDetectionsMode(false);
      await fetchReidPeople();
      await fetchReidDetections();
    } catch (err) {
      console.error('Failed to link detections', err);
      alert('Failed to link detections');
    } finally {
      setMergingDetections(false);
    }
  }, [linkDetectionsSelection, fetchReidPeople, fetchReidDetections]);

  const triggerReidRefresh = useCallback(() => {
    if (reidRefreshTimerRef.current) {
      clearTimeout(reidRefreshTimerRef.current);
    }
    reidRefreshTimerRef.current = setTimeout(() => {
      reidRefreshTimerRef.current = null;
      void fetchReidPeople({ silent: true });
      void refreshLoadedReidDetections();
      if (reidViewRef.current === 'person' && selectedPersonIdRef.current) {
        void refreshPersonDetail({ silent: true });
      }
    }, 2000);
  }, [fetchReidPeople, refreshLoadedReidDetections, refreshPersonDetail]);

  useEffect(() => () => {
    if (reidRefreshTimerRef.current) {
      clearTimeout(reidRefreshTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (active) {
      void fetchReidPeople();
      void fetchReidDetections();
      void fetchTopology();
    }
  }, [active, fetchReidPeople, fetchReidDetections, fetchTopology]);

  useEffect(() => {
    if (showTopology) {
      void fetchTopology();
    }
  }, [showTopology, fetchTopology]);

  useEffect(() => {
    if (!hasOnlineDevices && reidView !== 'people') {
      setReidView('people');
      setSelectedPerson(null);
      setSelectedDetection(null);
      setPersonSuggestions([]);
      setShowIdentitySuggestions(false);
    }
  }, [hasOnlineDevices, reidView]);

  return {
    streams,
    hasOnlineDevices,
    reidPeople,
    reidDetections,
    reidDetectionsTotal,
    loadingReidPeople,
    loadingReidDetections,
    loadingMoreReidDetections,
    brokenIdentityCovers,
    setBrokenIdentityCovers,
    brokenDetectionCrops,
    setBrokenDetectionCrops,
    deletingIdentityId,
    reidView,
    selectedPerson,
    selectedDetection,
    personSuggestions,
    loadingPersonDetail,
    linkDetectionsMode,
    setLinkDetectionsMode,
    linkDetectionsSelection,
    setLinkDetectionsSelection,
    mergingDetections,
    identityLabelDraft,
    setIdentityLabelDraft,
    savingIdentityLabel,
    feedbackPending,
    showTopology,
    setShowTopology,
    showIdentitySuggestions,
    setShowIdentitySuggestions,
    topologyRoutes,
    detectionFilterStreamId,
    setDetectionFilterStreamId,
    detectionFilterCameraName,
    setDetectionFilterCameraName,
    detectionFilterStartTime,
    setDetectionFilterStartTime,
    detectionFilterEndTime,
    setDetectionFilterEndTime,
    showDetectionFilters,
    setShowDetectionFilters,
    detectionFilterCameras,
    detectionFilterStreams,
    hasActiveDetectionFilters,
    clearDetectionFilters,
    fetchReidPeople,
    fetchReidDetections,
    fetchTopology,
    loadMoreReidDetections,
    openPersonDetail,
    openDetectionDetail,
    closePersonDetail,
    refreshPersonDetail,
    handleSavePersonLabel,
    handleStreamTrackFeedback,
    handleLinkDetectionsSelection,
    handleDeleteIdentity,
    handleLinkDetections,
    triggerReidRefresh,
  };
}

export type ReidTabState = ReturnType<typeof useReidTab>;
