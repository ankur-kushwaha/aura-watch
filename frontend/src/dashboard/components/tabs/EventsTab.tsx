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
import type { EventsTabState } from '../../hooks/useEventsTab';
import { formatClipDuration, formatClipListDateTime, getClipDetectionCount } from '../../utils';

export interface EventsTabProps {
  events: EventsTabState;
}

export function EventsTab({ events }: EventsTabProps) {
  const {
    devices,
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
    handleSelectClip,
    closeClipPreview,
    openPersonRefsModal,
    refreshClipDetections,
    playDetectionClip,
    handleDeleteClip,
    handleDeleteAllClips,
  } = events;

  return (
    <>
              {/* EVENT ARCHIVE & PLAYBACK PANEL */}
              <div className="glass-panel p-4 sm:p-5 flex flex-col min-h-[60vh] lg:h-[984px]">
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
                      onClick={() => { void fetchClips(); }}
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
                          className="text-[0.8rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[32px]"
                        >
                          <option value="">All Devices</option>
                          {devices.filter((d) => d.status !== 'Offline').map((d) => (
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
                          className="text-[0.8rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[32px]"
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
                          className="text-[0.8rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[32px]"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[0.7rem] text-text-secondary">To</label>
                        <input
                          type="datetime-local"
                          value={clipFilterEndTime}
                          onChange={(e) => setClipFilterEndTime(e.target.value)}
                          className="text-[0.8rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[32px]"
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
                        onClick={() => { void fetchClips(); }}
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
                            className={`glass-panel interactive ${selectedClip?.id === c.id ? 'active' : ''} p-3 flex justify-between items-start cursor-pointer transition-all duration-200 w-full min-w-0`}
                          >
                            <div className="flex items-start gap-3 flex-1 min-w-0">
                              <div className="bg-primary-glow p-2 rounded-lg text-primary flex-shrink-0 mt-0.5">
                                <Play size={16} fill="currentColor" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex justify-between items-start gap-2 mb-0.5">
                                  <span className="text-[0.85rem] font-semibold text-text-primary truncate">{c.camera}</span>
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
                                {orgSettings.videoSummary && c.summary && (
                                  <p className="text-[0.75rem] text-text-secondary overflow-hidden text-ellipsis whitespace-nowrap">
                                    {c.summary}
                                  </p>
                                )}
                              </div>
                            </div>

                            <button
                              onClick={(e) => handleDeleteClip(c.id, e)}
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
                  <div className="hidden lg:flex flex-1 flex-col min-w-0 overflow-y-auto pr-1 lg:h-full">
                    {selectedClip ? (
                      <ClipPreviewPanel
                        clip={selectedClip}
                        deviceName={selectedClip.deviceId ? deviceNameById.get(selectedClip.deviceId) : undefined}
                        orgSettings={orgSettings}
                        loadingClipDetections={loadingClipDetections}
                        clipDetections={clipDetections}
                        clipReidLog={clipReidLog}
                        onOpenPersonRefs={openPersonRefsModal}
                        onCropPreview={setCropPreviewFilename}
                        onPlayDetectionClip={playDetectionClip}
                      />
                    ) : (
                      <div className="h-full flex flex-col justify-center items-center border border-dashed border-border-glass rounded-xl text-text-muted p-5 text-center">
                        <Video size={32} className="text-text-muted mb-2.5 mx-auto" />
                        <p className="text-[0.85rem] font-semibold">No Event Selected</p>
                        <p className="text-[0.75rem] mt-1 max-w-[220px] mx-auto">Select a clip from the history list to play and view the AI summary.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

      <AskCameraAiDialog
        open={showAskAiDialog}
        onOpenChange={setShowAskAiDialog}
        orgSettings={orgSettings}
        streams={events.streams}
        onlineDeviceIds={onlineDeviceIds}
        visibleClipIds={visibleClipIds}
        hasOnlineDevices={hasOnlineDevices}
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
        onClose={() => setPersonRefsDetection(null)}
        selectedClip={selectedClip}
        clips={clips}
        onSelectClip={handleSelectClip}
        onClipDetectionsRefresh={refreshClipDetections}
        onCropPreview={setCropPreviewFilename}
        onPlayClip={playDetectionClip}
      />
    </>
  );
}
