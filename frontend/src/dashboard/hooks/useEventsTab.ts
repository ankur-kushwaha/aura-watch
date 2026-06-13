import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, generateClipAiSummary, type OrgSettings } from '../../api';
import { CLIPS_PAGE_SIZE } from '../constants';
import type {
  CameraStream,
  ClipDetectionsResponse,
  ClipObjectDetection,
  ClipReidLog,
  CropClipPlayback,
  EdgeDevice,
  TimelineVideoPlayback,
  VideoClip,
} from '../types';
import { buildClipsQueryString } from '../utils/clips';

export interface UseEventsTabOptions {
  devices: EdgeDevice[];
  streams: CameraStream[];
  orgSettings: OrgSettings;
  onlineDeviceIds: Set<string>;
  hasOnlineDevices: boolean;
  isMobileViewport: boolean;
  deviceNameById: Map<string, string>;
}

export function useEventsTab({
  devices,
  streams,
  orgSettings,
  onlineDeviceIds,
  hasOnlineDevices,
  isMobileViewport,
  deviceNameById,
}: UseEventsTabOptions) {
  const [clips, setClips] = useState<VideoClip[]>([]);
  const [clipsTotal, setClipsTotal] = useState(0);
  const [loadingClips, setLoadingClips] = useState(false);
  const [loadingMoreClips, setLoadingMoreClips] = useState(false);
  const [deletingAllClips, setDeletingAllClips] = useState(false);
  const [selectedClip, setSelectedClip] = useState<VideoClip | null>(null);
  const [clipDetections, setClipDetections] = useState<ClipObjectDetection[]>([]);
  const [clipReidLog, setClipReidLog] = useState<ClipReidLog | null>(null);
  const [loadingClipDetections, setLoadingClipDetections] = useState(false);
  const [personRefsDetection, setPersonRefsDetection] = useState<ClipObjectDetection | null>(null);
  const [cropPreviewFilename, setCropPreviewFilename] = useState<string | null>(null);
  const [clipPreviewOpen, setClipPreviewOpen] = useState(false);
  const [timelineVideo, setTimelineVideo] = useState<TimelineVideoPlayback | null>(null);
  const [showAskAiDialog, setShowAskAiDialog] = useState(false);
  const [generatingAiSummary, setGeneratingAiSummary] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState<string | null>(null);
  const [clipFilterDeviceId, setClipFilterDeviceId] = useState('');
  const [clipFilterStreamId, setClipFilterStreamId] = useState('');
  const [clipFilterStartTime, setClipFilterStartTime] = useState('');
  const [clipFilterEndTime, setClipFilterEndTime] = useState('');
  const [showClipFilters, setShowClipFilters] = useState(false);

  const clipFilterParams = useMemo(
    () => ({
      deviceId: clipFilterDeviceId,
      streamId: clipFilterStreamId,
      startTime: clipFilterStartTime,
      endTime: clipFilterEndTime,
    }),
    [clipFilterDeviceId, clipFilterStreamId, clipFilterStartTime, clipFilterEndTime],
  );

  const clipFilterStreams = useMemo(
    () => (clipFilterDeviceId
      ? streams.filter((s) => s.deviceId === clipFilterDeviceId)
      : streams),
    [streams, clipFilterDeviceId],
  );

  const hasActiveClipFilters = Boolean(
    clipFilterDeviceId || clipFilterStreamId || clipFilterStartTime || clipFilterEndTime,
  );

  const isClipFromOnlineDevice = useCallback((clip: VideoClip) => {
    if (!clip.deviceId) return hasOnlineDevices;
    return onlineDeviceIds.has(clip.deviceId);
  }, [onlineDeviceIds, hasOnlineDevices]);

  const visibleClips = useMemo(
    () => clips.filter(isClipFromOnlineDevice),
    [clips, isClipFromOnlineDevice],
  );

  const visibleClipIds = useMemo(
    () => new Set(visibleClips.map((c) => c.id)),
    [visibleClips],
  );

  const clipsHasMore = visibleClips.length < clipsTotal;

  useEffect(() => {
    setClips((prev) => {
      const filtered = prev.filter(isClipFromOnlineDevice);
      return filtered.length === prev.length ? prev : filtered;
    });
    setSelectedClip((prev) => (prev && isClipFromOnlineDevice(prev) ? prev : null));
  }, [isClipFromOnlineDevice]);

  const fetchClips = useCallback(async (
    filtersOverride?: {
      deviceId: string;
      streamId: string;
      startTime: string;
      endTime: string;
    },
  ) => {
    const filters = filtersOverride ?? clipFilterParams;
    setLoadingClips(true);
    try {
      const qs = buildClipsQueryString(CLIPS_PAGE_SIZE, 0, filters);
      const res = await apiFetch(`/clips?${qs}`);
      const data = await res.json();
      setClips(data.clips);
      setClipsTotal(data.total);
      setSelectedClip((prevSelected) => {
        if (data.clips.length > 0 && !prevSelected) {
          return data.clips[0];
        }
        if (prevSelected && !data.clips.some((c: VideoClip) => c.id === prevSelected.id)) {
          return data.clips.length > 0 ? data.clips[0] : null;
        }
        return prevSelected;
      });
    } catch (err) {
      console.error('Failed to fetch clips', err);
    } finally {
      setLoadingClips(false);
    }
  }, [clipFilterParams]);

  const loadMoreClips = useCallback(async () => {
    if (loadingMoreClips || clips.length >= clipsTotal) return;
    setLoadingMoreClips(true);
    try {
      const qs = buildClipsQueryString(CLIPS_PAGE_SIZE, clips.length, clipFilterParams);
      const res = await apiFetch(`/clips?${qs}`);
      const data = await res.json();
      setClips((prev) => [...prev, ...data.clips]);
      setClipsTotal(data.total);
    } catch (err) {
      console.error('Failed to load more clips', err);
    } finally {
      setLoadingMoreClips(false);
    }
  }, [clips.length, clipsTotal, loadingMoreClips, clipFilterParams]);

  useEffect(() => {
    void fetchClips();
  }, [fetchClips]);

  const onlineDevicesInitializedRef = useRef(false);
  useEffect(() => {
    if (!onlineDevicesInitializedRef.current) {
      onlineDevicesInitializedRef.current = true;
      return;
    }
    void fetchClips();
  }, [onlineDeviceIds, fetchClips]);

  useEffect(() => {
    if (!selectedClip) {
      setClipDetections([]);
      setClipReidLog(null);
      return;
    }

    let cancelled = false;
    setLoadingClipDetections(true);

    apiFetch(`/clips/${selectedClip.id}/detections`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ClipDetectionsResponse | ClipObjectDetection[] | null) => {
        if (cancelled || !data) return;
        if (Array.isArray(data)) {
          setClipDetections(data);
          setClipReidLog(null);
        } else {
          setClipDetections(Array.isArray(data.objects) ? data.objects : []);
          setClipReidLog(data.reidLog ?? null);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch clip detections', err);
        if (!cancelled) {
          setClipDetections([]);
          setClipReidLog(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingClipDetections(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedClip?.id]);

  useEffect(() => {
    if (!isMobileViewport) {
      setClipPreviewOpen(false);
    }
  }, [isMobileViewport]);

  const handleNewClip = useCallback((clip: VideoClip) => {
    if (clip.deviceId && !onlineDeviceIds.has(clip.deviceId)) return;
    const normalized: VideoClip = {
      ...clip,
      timestamp: typeof clip.timestamp === 'string'
        ? clip.timestamp
        : new Date(clip.timestamp as unknown as string).toISOString(),
    };
    setClips((prev) => {
      if (prev.some((c) => c.id === normalized.id)) return prev;
      return [normalized, ...prev];
    });
    setClipsTotal((prev) => prev + 1);
  }, [onlineDeviceIds]);

  const handleSelectClip = useCallback((clip: VideoClip) => {
    setSelectedClip(clip);
    setAiSummaryError(null);
    if (isMobileViewport) {
      setClipPreviewOpen(true);
    }
  }, [isMobileViewport]);

  const handleGenerateAiSummary = useCallback(async () => {
    if (!selectedClip || generatingAiSummary) return;

    setGeneratingAiSummary(true);
    setAiSummaryError(null);
    try {
      const result = await generateClipAiSummary(selectedClip.id);
      const updatedClip: VideoClip = {
        ...selectedClip,
        summary: result.summary,
        aiSummary: result.aiSummary,
      };
      setSelectedClip(updatedClip);
      setClips((prev) => prev.map((clip) => (clip.id === updatedClip.id ? updatedClip : clip)));
    } catch (err) {
      setAiSummaryError(err instanceof Error ? err.message : 'Failed to generate AI summary');
    } finally {
      setGeneratingAiSummary(false);
    }
  }, [selectedClip, generatingAiSummary]);

  const closeClipPreview = useCallback(() => {
    setClipPreviewOpen(false);
  }, []);

  const openPersonRefsModal = useCallback((obj: ClipObjectDetection) => {
    if (obj.className !== 'person' || !obj.detectionId) return;
    setPersonRefsDetection(obj);
  }, []);

  const closePersonRefsModal = useCallback(() => {
    setPersonRefsDetection(null);
  }, []);

  const refreshClipDetections = useCallback(async () => {
    if (!selectedClip) return;
    const detRes = await apiFetch(`/clips/${selectedClip.id}/detections`);
    if (detRes.ok) {
      const updated = await detRes.json();
      if (Array.isArray(updated)) {
        setClipDetections(updated);
      } else {
        setClipDetections(Array.isArray(updated.objects) ? updated.objects : []);
        setClipReidLog(updated.reidLog ?? null);
      }
    }
  }, [selectedClip?.id]);

  const playDetectionClip = useCallback(async (opts: CropClipPlayback & { cropFilename: string }) => {
    let clipFilename = opts.clipFilename;
    let clipOffsetMs = opts.clipOffsetMs ?? 0;

    if (!clipFilename && opts.detectionId) {
      try {
        const res = await apiFetch(`/reid/detections/${opts.detectionId}/source-clip`);
        if (!res.ok) {
          setCropPreviewFilename(opts.cropFilename);
          return;
        }
        const data = await res.json();
        clipFilename = data.clipFilename;
        clipOffsetMs = data.clipOffsetMs ?? 0;
      } catch (err) {
        console.error('Failed to resolve clip for detection', err);
        setCropPreviewFilename(opts.cropFilename);
        return;
      }
    }

    if (clipFilename) {
      setTimelineVideo({
        filename: clipFilename,
        offsetMs: clipOffsetMs,
        cameraName: opts.cameraName,
        cropFilename: opts.cropFilename,
      });
    } else {
      setCropPreviewFilename(opts.cropFilename);
    }
  }, []);

  const handleDeleteClip = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this recorded clip?')) return;

    try {
      const res = await apiFetch(`/clips/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setClips((prev) => prev.filter((c) => c.id !== id));
        setClipsTotal((prev) => Math.max(0, prev - 1));
        if (selectedClip?.id === id) {
          setSelectedClip(null);
        }
      }
    } catch (err) {
      console.error('Failed to delete clip', err);
    }
  }, [selectedClip?.id]);

  const handleDeleteAllClips = useCallback(async () => {
    if (clips.length === 0) return;
    if (!confirm(`Are you sure you want to delete all ${clipsTotal} recorded clips? This cannot be undone.`)) return;

    setDeletingAllClips(true);
    try {
      const res = await apiFetch('/clips', { method: 'DELETE' });
      if (res.ok) {
        setClips([]);
        setClipsTotal(0);
        setSelectedClip(null);
      }
    } catch (err) {
      console.error('Failed to delete all clips', err);
    } finally {
      setDeletingAllClips(false);
    }
  }, [clips.length, clipsTotal]);

  const clearClipFilters = useCallback(() => {
    setClipFilterDeviceId('');
    setClipFilterStreamId('');
    setClipFilterStartTime('');
    setClipFilterEndTime('');
    void fetchClips({ deviceId: '', streamId: '', startTime: '', endTime: '' });
  }, [fetchClips]);

  return {
    devices,
    streams,
    orgSettings,
    deviceNameById,
    onlineDeviceIds,
    hasOnlineDevices,
    isMobileViewport,
    clips,
    clipsTotal,
    loadingClips,
    loadingMoreClips,
    deletingAllClips,
    selectedClip,
    clipDetections,
    clipReidLog,
    loadingClipDetections,
    personRefsDetection,
    setPersonRefsDetection,
    closePersonRefsModal,
    cropPreviewFilename,
    setCropPreviewFilename,
    clipPreviewOpen,
    timelineVideo,
    setTimelineVideo,
    showAskAiDialog,
    setShowAskAiDialog,
    clipFilterDeviceId,
    setClipFilterDeviceId,
    clipFilterStreamId,
    setClipFilterStreamId,
    clipFilterStartTime,
    setClipFilterStartTime,
    clipFilterEndTime,
    setClipFilterEndTime,
    showClipFilters,
    setShowClipFilters,
    clipFilterStreams,
    hasActiveClipFilters,
    visibleClips,
    visibleClipIds,
    clipsHasMore,
    fetchClips,
    loadMoreClips,
    handleNewClip,
    handleSelectClip,
    closeClipPreview,
    generatingAiSummary,
    aiSummaryError,
    handleGenerateAiSummary,
    openPersonRefsModal,
    refreshClipDetections,
    playDetectionClip,
    handleDeleteClip,
    handleDeleteAllClips,
    clearClipFilters,
  };
}

export type EventsTabState = ReturnType<typeof useEventsTab>;
