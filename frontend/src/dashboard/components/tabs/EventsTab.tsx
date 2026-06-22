import {
  forwardRef,
  useImperativeHandle,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Activity,
  Clock,
  Cpu,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Video,
} from 'lucide-react';
import { ClipPreviewPanel } from '../ClipPreviewPanel';
import {
  AskCameraAiDialog,
  CropPreviewDialog,
  MobileClipPreviewDialog,
  PersonAppearancesDialog,
  TimelineClipPlaybackDialog,
} from '../modals';
import { apiFetch, generateClipAiSummary, type OrgSettings } from '../../../api';
import { CLIPS_PAGE_SIZE } from '../../constants';
import { trackEvent } from '../../../lib/posthog';
import type {
  CameraStream,
  ClipDetectionsResponse,
  ClipObjectDetection,
  ClipReidLog,
  CropClipPlayback,
  EdgeDevice,
  TimelineVideoPlayback,
  VideoClip,
} from '../../types';
import { buildClipsQueryString } from '../../utils/clips';
import { serializeClipAiAnalysis } from '../../utils/summary';
import { formatClipDuration, formatClipListDateTime, getClipDetectionCount } from '../../utils';
import { getClipListPreview, shouldShowClipListPreview } from '../../utils/summary';

export interface EventsTabProps {
  devices: EdgeDevice[];
  streams: CameraStream[];
  orgSettings: OrgSettings;
  onlineDeviceIds: Set<string>;
  hasOnlineDevices: boolean;
  isMobileViewport: boolean;
  deviceNameById: Map<string, string>;
}

export interface EventsTabRef {
  fetchClips: (filtersOverride?: {
    deviceId: string;
    streamId: string;
    startTime: string;
    endTime: string;
  }) => Promise<void>;
  handleNewClip: (clip: VideoClip) => void;
  handleSelectClip: (clip: VideoClip) => void;
}

export const EventsTab = forwardRef<EventsTabRef, EventsTabProps>(
  (
    {
      devices,
      streams,
      orgSettings,
      onlineDeviceIds,
      hasOnlineDevices,
      isMobileViewport,
      deviceNameById,
    },
    ref
  ) => {
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
    const [searchParams] = useSearchParams();
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
      [clipFilterDeviceId, clipFilterStreamId, clipFilterStartTime, clipFilterEndTime]
    );

    const clipFilterStreams = useMemo(
      () => (clipFilterDeviceId
        ? streams.filter((s) => s.deviceId === clipFilterDeviceId)
        : streams),
      [streams, clipFilterDeviceId]
    );

    const hasActiveClipFilters = Boolean(
      clipFilterDeviceId || clipFilterStreamId || clipFilterStartTime || clipFilterEndTime
    );

    const isClipFromOnlineDevice = useCallback(
      (clip: VideoClip) => {
        if (!clip.deviceId) return hasOnlineDevices;
        return onlineDeviceIds.has(clip.deviceId);
      },
      [onlineDeviceIds, hasOnlineDevices]
    );

    const visibleClips = useMemo(
      () => clips.filter(isClipFromOnlineDevice),
      [clips, isClipFromOnlineDevice]
    );

    const visibleClipIds = useMemo(
      () => new Set(visibleClips.map((c) => c.id)),
      [visibleClips]
    );

    const clipsHasMore = visibleClips.length < clipsTotal;

    useEffect(() => {
      setClips((prev) => {
        const filtered = prev.filter(isClipFromOnlineDevice);
        return filtered.length === prev.length ? prev : filtered;
      });
      setSelectedClip((prev) => (prev && isClipFromOnlineDevice(prev) ? prev : null));
    }, [isClipFromOnlineDevice]);

    const fetchClips = useCallback(
      async (filtersOverride?: {
        deviceId: string;
        streamId: string;
        startTime: string;
        endTime: string;
      }) => {
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
      },
      [clipFilterParams]
    );

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
      const streamIdParam = searchParams.get('streamId');
      if (streamIdParam) {
        setClipFilterStreamId(streamIdParam);
        setShowClipFilters(true);
        const stream = streams.find((s) => s.streamId === streamIdParam);
        const deviceId = stream ? (stream.deviceId || '') : '';
        setClipFilterDeviceId(deviceId);
        void fetchClips({
          deviceId,
          streamId: streamIdParam,
          startTime: clipFilterStartTime,
          endTime: clipFilterEndTime,
        });
      }
    }, [searchParams, streams, fetchClips, clipFilterStartTime, clipFilterEndTime]);

    useEffect(() => {
      if (searchParams.get('streamId')) return;
      void fetchClips();
    }, [fetchClips, searchParams]);

    const onlineDevicesInitializedRef = useRef(false);
    useEffect(() => {
      if (!onlineDevicesInitializedRef.current) {
        onlineDevicesInitializedRef.current = true;
        return;
      }
      void fetchClips();
    }, [onlineDeviceIds, fetchClips]);

    useEffect(() => {
      const selectedClipId = selectedClip?.id;
      if (!selectedClipId) {
        setClipDetections([]);
        setClipReidLog(null);
        return;
      }

      let cancelled = false;
      setLoadingClipDetections(true);

      apiFetch(`/clips/${selectedClipId}/detections`)
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

    const handleNewClip = useCallback(
      (clip: VideoClip) => {
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
      },
      [onlineDeviceIds]
    );

    const handleSelectClip = useCallback(
      (clip: VideoClip) => {
        setSelectedClip(clip);
        setAiSummaryError(null);
        trackEvent('view_clip', { clipId: clip.id, hasSummary: !!clip.summary });
        if (isMobileViewport) {
          setClipPreviewOpen(true);
        }
      },
      [isMobileViewport]
    );

    const handleGenerateAiSummary = useCallback(async () => {
      if (!selectedClip || generatingAiSummary) return;

      setGeneratingAiSummary(true);
      setAiSummaryError(null);
      try {
        trackEvent('generate_ai_summary', { clipId: selectedClip.id });
        const result = await generateClipAiSummary(selectedClip.id);
        const updatedClip: VideoClip = {
          ...selectedClip,
          summary: result.summary,
          aiSummary: serializeClipAiAnalysis(result.aiSummary),
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
      const selectedClipId = selectedClip?.id;
      if (!selectedClipId) return;
      const detRes = await apiFetch(`/clips/${selectedClipId}/detections`);
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

    const playDetectionClip = useCallback(
      async (opts: CropClipPlayback & { cropFilename: string }) => {
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
      },
      []
    );

    const handleDeleteClip = useCallback(
      async (id: string, e: React.MouseEvent) => {
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
      },
      [selectedClip?.id]
    );

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

    // Expose handlers via imperative ref
    useImperativeHandle(ref, () => ({
      fetchClips,
      handleNewClip,
      handleSelectClip,
    }));

    return (
      <>
        {/* EVENT ARCHIVE & PLAYBACK PANEL */}
        <div className="glass-panel p-4 sm:p-5 flex flex-col">
          <div className="flex flex-wrap justify-between items-center gap-3 mb-3">
            <div className="flex items-center gap-3 flex-wrap min-w-0">
              <h2 className="text-[1rem] sm:text-[1.1rem] flex items-center gap-2">
                <Video size={18} color="var(--color-primary)" /> Event Archive & Playback
              </h2>
              {orgSettings.aiChat && (
                <button
                  type="button"
                  onClick={() => setShowAskAiDialog(true)}
                  className="btn btn-primary py-1.5 px-3.5 text-[0.8rem] rounded-lg flex items-center gap-2 font-semibold shadow-[0_4px_16px_rgba(124,58,237,0.4)] hover:shadow-[0_6px_22px_rgba(124,58,237,0.55)] transition-all duration-200"
                >
                  <Sparkles size={14} /> Ask Camera AI
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setShowClipFilters(!showClipFilters)}
                className={`btn btn-secondary py-1 px-2.5 text-[0.75rem] rounded-md flex items-center gap-1.5 transition-all duration-200 ${
                  showClipFilters || hasActiveClipFilters
                    ? 'border-primary text-primary bg-[rgba(124,58,237,0.08)]'
                    : ''
                }`}
              >
                <SlidersHorizontal size={12} />
                Filters
                {hasActiveClipFilters && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                )}
              </button>
              <button
                onClick={handleDeleteAllClips}
                className="btn btn-secondary py-1 px-2 text-[0.75rem] rounded-md hover:text-danger"
                disabled={loadingClips || deletingAllClips || visibleClips.length === 0}
              >
                <Trash2 size={12} /> Delete All
              </button>
              <button
                onClick={() => {
                  void fetchClips();
                }}
                className="btn btn-secondary py-1 px-2 text-[0.75rem] rounded-md"
                disabled={loadingClips || deletingAllClips}
              >
                <RefreshCw size={12} className={loadingClips ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
          </div>

          {showClipFilters && (
            <div className="glass-panel p-3.5 mb-3 bg-[rgba(255,255,255,0.01)] border-[rgba(255,255,255,0.08)] rounded-[10px] flex flex-col gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[0.7rem] text-text-secondary">Device</label>
                  <select
                    value={clipFilterDeviceId}
                    onChange={(e) => {
                      setClipFilterDeviceId(e.target.value);
                      setClipFilterStreamId('');
                    }}
                    className="filter-field rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary"
                  >
                    <option value="">All Devices</option>
                    {devices
                      .filter((d) => d.status !== 'Offline')
                      .map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[0.7rem] text-text-secondary">Camera Stream</label>
                  <select
                    value={clipFilterStreamId}
                    onChange={(e) => setClipFilterStreamId(e.target.value)}
                    className="filter-field rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary"
                  >
                    <option value="">All Streams</option>
                    {clipFilterStreams.map((s) => (
                      <option key={s.streamId} value={s.streamId}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[0.7rem] text-text-secondary">From</label>
                  <input
                    type="datetime-local"
                    value={clipFilterStartTime}
                    onChange={(e) => setClipFilterStartTime(e.target.value)}
                    className="filter-field rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[0.7rem] text-text-secondary">To</label>
                  <input
                    type="datetime-local"
                    value={clipFilterEndTime}
                    onChange={(e) => setClipFilterEndTime(e.target.value)}
                    className="filter-field rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                {hasActiveClipFilters && (
                  <button
                    type="button"
                    onClick={() => {
                      setClipFilterDeviceId('');
                      setClipFilterStreamId('');
                      setClipFilterStartTime('');
                      setClipFilterEndTime('');
                      void fetchClips({
                        deviceId: '',
                        streamId: '',
                        startTime: '',
                        endTime: '',
                      });
                    }}
                    className="btn btn-secondary py-1 px-2 text-[0.7rem] rounded flex items-center gap-1 hover:text-danger hover:border-danger bg-transparent font-semibold border-none"
                  >
                    Clear Filters
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    void fetchClips();
                  }}
                  disabled={loadingClips}
                  className="btn btn-secondary py-1 px-2.5 text-[0.75rem] rounded-md"
                >
                  Apply Filters
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col lg:flex-row gap-5 flex-1 min-h-0 lg:overflow-hidden">
            {/* Left pane: Clips History List */}
            <div className="w-full lg:w-[320px] lg:shrink-0 flex flex-col gap-2.5 overflow-y-auto min-w-0 pr-1 lg:h-full max-h-[70vh] lg:max-h-none">
              {loadingClips && visibleClips.length === 0 ? (
                <div className="h-full flex flex-col justify-center items-center text-text-muted text-[0.85rem] text-center px-4">
                  <RefreshCw size={24} className="animate-spin mb-2" />
                  <span>Loading events…</span>
                </div>
              ) : visibleClips.length === 0 ? (
                <div className="h-full flex justify-center items-center text-text-muted text-[0.85rem] text-center px-4">
                  {hasActiveClipFilters
                    ? 'No clips match the current filters.'
                    : 'No clips recorded yet.'}
                </div>
              ) : (
                <>
                  {visibleClips.map((c) => {
                    const deviceName = c.deviceId ? deviceNameById.get(c.deviceId) : undefined;
                    const durationLabel = formatClipDuration(c.duration);
                    const detectionCount = getClipDetectionCount(c);
                    return (
                      <div
                        key={c.id}
                        onClick={() => handleSelectClip(c)}
                        className={`glass-panel interactive ${
                          selectedClip?.id === c.id ? 'active' : ''
                        } p-3 flex justify-between items-start cursor-pointer transition-all duration-200 w-full min-w-0`}
                      >
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div className="bg-primary-glow p-2 rounded-lg text-primary flex-shrink-0 mt-0.5">
                            <Play size={16} fill="currentColor" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex justify-between items-start gap-2 mb-0.5">
                              <span className="text-[0.85rem] font-semibold text-text-primary truncate">
                                {c.camera}
                              </span>
                              <span className="text-[0.68rem] text-text-muted whitespace-nowrap shrink-0">
                                {formatClipListDateTime(c.timestamp)}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.7rem] text-text-muted mb-0.5">
                              {deviceName && (
                                <span className="inline-flex items-center gap-1">
                                  <Cpu size={11} />
                                  {deviceName}
                                </span>
                              )}
                              {durationLabel && (
                                <span className="inline-flex items-center gap-1">
                                  <Clock size={11} />
                                  {durationLabel}
                                </span>
                              )}
                              {detectionCount !== null && (
                                <span className="inline-flex items-center gap-1 text-sky-400/90">
                                  <Activity size={11} />
                                  {detectionCount} detection{detectionCount === 1 ? '' : 's'}
                                </span>
                              )}
                            </div>
                            {shouldShowClipListPreview(c, orgSettings) && (
                              <p className="text-[0.75rem] text-text-secondary overflow-hidden text-ellipsis whitespace-nowrap">
                                {getClipListPreview(c)}
                              </p>
                            )}
                          </div>
                        </div>

                        <button
                          onClick={(e) => {
                            void handleDeleteClip(c.id, e);
                          }}
                          className="btn p-1.5 bg-transparent text-text-muted hover:text-danger border-none shrink-0"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                  {clipsHasMore && (
                    <button
                      type="button"
                      onClick={loadMoreClips}
                      disabled={loadingMoreClips}
                      className="btn btn-secondary w-full py-2 text-[0.8rem] rounded-lg flex items-center justify-center gap-1.5"
                    >
                      <RefreshCw size={12} className={loadingMoreClips ? 'animate-spin' : ''} />
                      {loadingMoreClips
                        ? 'Loading…'
                        : `Load more (${visibleClips.length} of ${clipsTotal})`}
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Vertical Divider */}
            <div className="hidden lg:block w-[1px] bg-[rgba(255,255,255,0.08)] self-stretch" />

            {/* Right pane: Clip Viewer (desktop only) */}
            <div className="hidden lg:flex flex-1 flex-col min-w-0 overflow-hidden pr-1 lg:h-full">
              {selectedClip ? (
                <ClipPreviewPanel
                  clip={selectedClip}
                  deviceName={selectedClip.deviceId ? deviceNameById.get(selectedClip.deviceId) : undefined}
                  orgSettings={orgSettings}
                  loadingClipDetections={loadingClipDetections}
                  clipDetections={clipDetections}
                  clipReidLog={clipReidLog}
                  generatingAiSummary={generatingAiSummary}
                  aiSummaryError={aiSummaryError}
                  onGenerateAiSummary={handleGenerateAiSummary}
                  onOpenPersonRefs={openPersonRefsModal}
                  onCropPreview={setCropPreviewFilename}
                  onPlayDetectionClip={playDetectionClip}
                />
              ) : (
                <div className="h-full flex flex-col justify-center items-center border border-dashed border-border-glass rounded-xl text-text-muted p-5 text-center">
                  <Video size={32} className="text-text-muted mb-2.5 mx-auto" />
                  <p className="text-[0.85rem] font-semibold">No Event Selected</p>
                  <p className="text-[0.75rem] mt-1 max-w-[220px] mx-auto">
                    Select a clip from the history list to play and view detection details.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <AskCameraAiDialog
          open={showAskAiDialog}
          onOpenChange={setShowAskAiDialog}
          orgSettings={orgSettings}
          streams={streams}
          onlineDeviceIds={onlineDeviceIds}
          visibleClipIds={visibleClipIds}
        />

        <MobileClipPreviewDialog
          open={clipPreviewOpen && isMobileViewport}
          clip={selectedClip}
          deviceName={selectedClip?.deviceId ? deviceNameById.get(selectedClip.deviceId) : undefined}
          orgSettings={orgSettings}
          loadingClipDetections={loadingClipDetections}
          clipDetections={clipDetections}
          clipReidLog={clipReidLog}
          onClose={closeClipPreview}
          onOpenPersonRefs={openPersonRefsModal}
          onCropPreview={setCropPreviewFilename}
          onPlayDetectionClip={playDetectionClip}
        />

        <CropPreviewDialog
          filename={cropPreviewFilename}
          onClose={() => setCropPreviewFilename(null)}
        />

        <TimelineClipPlaybackDialog
          playback={timelineVideo}
          onClose={() => setTimelineVideo(null)}
        />

        <PersonAppearancesDialog
          detection={personRefsDetection}
          onClose={closePersonRefsModal}
          selectedClip={selectedClip}
          onClipDetectionsRefresh={refreshClipDetections}
          onCropPreview={setCropPreviewFilename}
        />
      </>
    );
  }
);

EventsTab.displayName = 'EventsTab';
