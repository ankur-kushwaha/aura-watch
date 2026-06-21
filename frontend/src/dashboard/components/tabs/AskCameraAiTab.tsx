import { useState, useEffect } from 'react';
import { Search, Sparkles, MessageSquare, ArrowRight, Play, SlidersHorizontal, X } from 'lucide-react';
import { apiFetch } from '../../../api';
import type { OrgSettings } from '../../../api';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog';
import { ClipPreviewPanel } from '../ClipPreviewPanel';
import { TimelineClipPlaybackDialog } from '../modals';
import type {
  CameraStream,
  VideoClip,
  RagResponseClip,
  ClipObjectDetection,
  ClipReidLog,
  CropClipPlayback,
  TimelineVideoPlayback,
} from '../../types';

interface MatchedClip {
  id: string;
  camera: string;
  timestamp: string;
  summary?: string;
  filepath?: string;
  filename?: string;
  score?: number;
  confidenceText: string;
  confidenceColor: string;
  boxStyle: { top: string; left: string; width: string; height: string };
  cameraCode: string;
  cameraName: string;
  recordedTime: string;
}


interface AskCameraAiTabProps {
  orgSettings: OrgSettings;
  streams: CameraStream[];
}

let searchStartTime = 0;
const startSearchTimer = () => {
  searchStartTime = performance.now();
};
const getSearchDuration = () => {
  return ((performance.now() - searchStartTime) / 1000).toFixed(1);
};

export function AskCameraAiTab({ orgSettings, streams }: AskCameraAiTabProps) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const [summary, setSummary] = useState('');
  const [pills, setPills] = useState<string[]>([]);
  const [clips, setClips] = useState<MatchedClip[]>([]);
  const [resolvedTime, setResolvedTime] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Search Filters State
  const [showFilters, setShowFilters] = useState(false);
  const [filterStartTime, setFilterStartTime] = useState('');
  const [filterEndTime, setFilterEndTime] = useState('');
  const [filterStreamId, setFilterStreamId] = useState('');

  // Playback & Preview State
  const [previewClip, setPreviewClip] = useState<VideoClip | null>(null);
  const [clipPlayback, setClipPlayback] = useState<TimelineVideoPlayback | null>(null);

  const handleSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setError(null);
    startSearchTimer();
    try {
      const res = await apiFetch('/rag/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: searchQuery,
          history: [],
          startTime: filterStartTime ? new Date(filterStartTime).toISOString() : undefined,
          endTime: filterEndTime ? new Date(filterEndTime).toISOString() : undefined,
          streamId: filterStreamId || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'AI search request failed');
      }

      setSummary(data.answer);

      const mappedClips: MatchedClip[] = (data.clips || []).map((c: RagResponseClip, idx: number) => {
        const cleanFilename = c.filename || c.filepath.split(/[/\\]/).pop() || '';
        const matchPercentage = c.score ? Math.round(c.score * 100) : 90;

        let recordedTime = '12:00:00';
        try {
          const d = new Date(c.timestamp);
          const formatNum = (x: number) => String(x).padStart(2, '0');
          recordedTime = `${formatNum(d.getHours())}:${formatNum(d.getMinutes())}:${formatNum(d.getSeconds())}`;
        } catch {
          // Fallback
        }

        return {
          id: c.id,
          camera: c.camera,
          timestamp: c.timestamp,
          summary: c.summary,
          filepath: c.filepath,
          filename: cleanFilename,
          score: c.score,
          confidenceText: `Match · ${matchPercentage}%`,
          confidenceColor: 'var(--color-secondary)',
          boxStyle: { top: '25%', left: '25%', width: '50%', height: '50%' },
          cameraCode: `C-${String(idx + 1).padStart(2, '0')}`,
          cameraName: c.camera,
          recordedTime,
        };
      });

      setClips(mappedClips);

      // Calculate pills/badges
      const matchPills = [`${data.clips?.length || 0} matches`];
      if (data.clips && data.clips.length > 0) {
        const uniqueCameras = Array.from(new Set(data.clips.map((c: RagResponseClip) => c.camera))) as string[];
        uniqueCameras.slice(0, 3).forEach((cam) => matchPills.push(cam));
      }
      setPills(matchPills);

      const duration = getSearchDuration();
      setResolvedTime(duration);

    } catch (err) {
      console.error('RAG query failed', err);
      setError(err instanceof Error ? err.message : 'Search failed. Please try again.');
      setSummary('Sorry, I encountered an error searching for matching footage summaries.');
      setClips([]);
      setPills(['0 matches']);
      setResolvedTime('0.0');
    } finally {
      setLoading(false);
    }
  };

  const handleSuggestionClick = (text: string) => {
    handleSearch(text);
  };

  const playPreviewDetectionClip = async (opts: CropClipPlayback & { cropFilename: string }) => {
    let clipFilename = opts.clipFilename;
    let clipOffsetMs = opts.clipOffsetMs ?? 0;

    if (!clipFilename && opts.detectionId) {
      try {
        const res = await apiFetch(`/reid/detections/${opts.detectionId}/source-clip`);
        if (!res.ok) return;
        const data = await res.json();
        clipFilename = data.clipFilename;
        clipOffsetMs = data.clipOffsetMs ?? 0;
      } catch (err) {
        console.error('Failed to resolve clip for detection', err);
        return;
      }
    }

    if (clipFilename) {
      setClipPlayback({
        filename: clipFilename,
        offsetMs: clipOffsetMs,
        cameraName: opts.cameraName,
        cropFilename: opts.cropFilename,
      });
    }
  };

  const handleClipClick = (clip: MatchedClip) => {
    if (!clip.filepath || !clip.filename) return; // Prevent playback of mock values
    setPreviewClip({
      id: clip.id,
      filepath: clip.filepath,
      filename: clip.filename,
      timestamp: clip.timestamp,
      summary: clip.summary || '',
      aiSummary: clip.summary || '',
      duration: 0,
      camera: clip.camera,
    });
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 animate-[slideUp_0.3s_ease-out] w-full min-h-[calc(100vh-140px)]">
      {/* LEFT COLUMN: Search Console */}
      <div className="xl:col-span-9 flex flex-col gap-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-[1.25rem] font-bold tracking-tight">Ask Camera AI</h2>
            <p className="text-[0.8rem] text-text-muted mt-0.5">Natural-language video search</p>
          </div>
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={`btn btn-secondary py-1 px-3 text-[0.75rem] rounded-md flex items-center gap-1.5 transition-all duration-200 font-semibold cursor-pointer ${showFilters || filterStartTime || filterEndTime || filterStreamId
                ? 'border-[var(--color-secondary)] text-[var(--color-secondary)] bg-[rgba(6,182,212,0.08)]'
                : ''
              }`}
          >
            <SlidersHorizontal size={12} />
            Search Filters
            {(filterStartTime || filterEndTime || filterStreamId) && (
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-secondary)] inline-block" />
            )}
          </button>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="glass-panel p-3.5 bg-[rgba(255,255,255,0.01)] border-[rgba(255,255,255,0.08)] rounded-xl flex flex-col gap-3 shrink-0">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col gap-1 text-left">
                <label className="text-[0.7rem] text-text-secondary font-semibold">Target Camera Stream</label>
                <select
                  value={filterStreamId}
                  onChange={(e) => setFilterStreamId(e.target.value)}
                  className="text-[0.8rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[32px] outline-none"
                >
                  <option value="">All Streams</option>
                  {streams.map((s) => (
                    <option key={s.streamId} value={s.streamId}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1 text-left">
                <label className="text-[0.7rem] text-text-secondary font-semibold">Start Time</label>
                <input
                  type="datetime-local"
                  value={filterStartTime}
                  onChange={(e) => setFilterStartTime(e.target.value)}
                  className="text-[0.8rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[32px] outline-none"
                />
              </div>
              <div className="flex flex-col gap-1 text-left">
                <label className="text-[0.7rem] text-text-secondary font-semibold">End Time</label>
                <input
                  type="datetime-local"
                  value={filterEndTime}
                  onChange={(e) => setFilterEndTime(e.target.value)}
                  className="text-[0.8rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[32px] outline-none"
                />
              </div>
            </div>
            {(filterStartTime || filterEndTime || filterStreamId) && (
              <button
                type="button"
                onClick={() => {
                  setFilterStartTime('');
                  setFilterEndTime('');
                  setFilterStreamId('');
                }}
                className="btn btn-secondary py-1 px-2 text-[0.7rem] self-end rounded flex items-center gap-1 hover:text-danger hover:border-danger bg-transparent font-semibold border-none cursor-pointer"
              >
                Clear Filters
              </button>
            )}
          </div>
        )}

        {/* Input Bar */}
        <div className="relative flex items-center bg-[rgba(15,23,42,0.45)] border border-border-glass rounded-2xl p-2.5 focus-within:border-[var(--color-primary)] transition-all duration-300 shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
          <ArrowRight className="text-[var(--color-secondary)] w-5 h-5 ml-2.5 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch(query)}
            placeholder="Ask AI anything about the camera footage..."
            className="flex-1 bg-transparent border-none outline-none text-[0.95rem] text-text-primary px-3 py-1.5 focus:ring-0 placeholder:text-text-muted font-medium"
          />
          <button
            onClick={() => handleSearch(query)}
            className="btn btn-primary py-2 px-5 text-[0.85rem] font-bold shrink-0 rounded-xl cursor-pointer"
            disabled={loading}
            style={{ background: 'linear-gradient(135deg, var(--color-secondary) 0%, #0891b2 100%)' }}
          >
            <Search size={14} /> Search
          </button>
        </div>

        {/* Error notification if search fails */}
        {error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[0.8rem] text-rose-200 text-left">
            {error}
          </div>
        )}

        {/* Search Results */}
        {loading ? (
          <div className="flex-1 flex flex-col justify-center items-center py-20 text-text-muted gap-3">
            <div className="relative w-10 h-10 flex items-center justify-center">
              <span className="w-8 h-8 rounded-full border-2 border-t-[var(--color-secondary)] border-r-transparent border-b-transparent border-l-transparent animate-spin inline-block absolute"></span>
              <Sparkles className="w-4 h-4 text-[var(--color-secondary)] animate-pulse" />
            </div>
            <span className="text-[0.85rem] font-semibold text-text-muted">Analyzing camera metadata streams...</span>
          </div>
        ) : (
          <div className="flex-1 flex flex-col gap-6">
            {/* Landing state when not searched yet */}
            {!summary && (
              <div className="flex-1 glass-panel p-8 rounded-2xl bg-[rgba(15,23,42,0.2)] border border-border-glass flex flex-col items-center justify-center text-center gap-4 py-16">
                <div className="w-12 h-12 rounded-full bg-[rgba(6,182,212,0.1)] border border-[rgba(6,182,212,0.2)] flex items-center justify-center text-[var(--color-secondary)]">
                  <Sparkles size={24} className="animate-pulse" />
                </div>
                <div className="max-w-md">
                  <h3 className="text-[1.05rem] font-bold text-text-primary">Search Camera Footage with AI</h3>
                  <p className="text-[0.82rem] text-text-muted mt-2 leading-relaxed">
                    Type a natural language query in the search bar above or choose one of the suggestions on the right to search across all registered camera streams.
                  </p>
                </div>
              </div>
            )}

            {/* AI Summary Card */}
            {summary && (
              <div className="glass-panel p-5 rounded-2xl bg-[rgba(15,23,42,0.35)] border border-[rgba(255,255,255,0.06)] relative flex flex-col gap-4 text-left">
                {/* Header metrics */}
                <div className="flex justify-between items-center text-[0.62rem] font-bold uppercase tracking-wider select-none text-[var(--color-secondary)] shrink-0">
                  <div className="flex items-center gap-1.5">
                    <Sparkles size={12} />
                    AI SUMMARY
                  </div>
                  {resolvedTime && <div className="text-text-muted font-mono">resolved in {resolvedTime}s</div>}
                </div>

                {/* Summary paragraph */}
                <p className="text-[0.9rem] font-medium leading-relaxed text-text-primary">
                  {summary}
                </p>

                {/* Badges */}
                {pills.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {pills.map((pill, idx) => {
                      const isAlert = pill.toLowerCase().includes('alert') || pill.toLowerCase().includes('critical');
                      return (
                        <span
                          key={idx}
                          className={`text-[0.72rem] font-semibold px-3 py-1 rounded-lg select-none ${isAlert
                              ? 'bg-[rgba(244,63,94,0.1)] text-[var(--color-danger)] border border-[rgba(244,63,94,0.25)]'
                              : 'bg-[rgba(255,255,255,0.03)] text-text-secondary border border-border-glass'
                            }`}
                        >
                          {pill}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Matched Clips Gallery */}
            {clips.length > 0 && (
              <div className="flex flex-col gap-4">
                <h3 className="text-[0.9rem] font-bold text-text-muted text-left">
                  Matched clips ({clips.length} results - ranked by confidence)
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {clips.map((clip) => (
                    <div
                      key={clip.id}
                      onClick={() => handleClipClick(clip)}
                      className={`glass-panel overflow-hidden relative group flex flex-col transition-all duration-300 border-border-glass bg-[rgba(255,255,255,0.015)] ${clip.filepath && clip.filename ? 'cursor-pointer hover:border-[rgba(124,58,237,0.3)]' : 'cursor-default'
                        }`}
                    >
                      {/* Image Thumbnail simulation */}
                      <div
                        className="flex-1 relative bg-gradient-to-br from-[#121822] to-[#0a0c12] w-full overflow-hidden select-none"
                        style={{ aspectRatio: '16/9' }}
                      >
                        {/* simulated scanline / grid */}
                        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.01)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.01)_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none" />

                        {/* tracking box overlay */}
                        <div
                          className="absolute border-2 rounded pointer-events-none"
                          style={{
                            borderColor: clip.confidenceColor,
                            ...clip.boxStyle,
                            boxShadow: `0 0 10px ${clip.confidenceColor}30`,
                          }}
                        />

                        {/* Top left camera badge */}
                        <div className="absolute top-2 left-2 text-[0.62rem] font-bold text-text-secondary bg-[rgba(9,13,22,0.7)] px-2 py-0.5 rounded border border-[rgba(255,255,255,0.04)] font-mono">
                          {clip.cameraCode}
                        </div>

                        {/* Top right REC badge */}
                        <div className="absolute top-2 right-2 flex items-center gap-1 bg-[rgba(9,13,22,0.7)] px-2 py-0.5 rounded border border-[rgba(255,255,255,0.04)]">
                          <span className="w-1 h-1 rounded-full bg-[var(--color-danger)] inline-block animate-[pulse-danger_1.2s_infinite]" />
                          <span className="text-[0.55rem] font-extrabold tracking-wider text-white">REC</span>
                        </div>

                        {/* Confidence tracker overlay */}
                        <div
                          className="absolute px-1.5 py-0.5 rounded text-[0.58rem] font-bold text-white uppercase tracking-wider select-none pointer-events-none z-10"
                          style={{
                            backgroundColor: clip.confidenceColor,
                            top: `calc(${clip.boxStyle.top} - 1.25rem)`,
                            left: clip.boxStyle.left,
                          }}
                        >
                          {clip.confidenceText}
                        </div>

                        {/* Hover Overlay */}
                        {clip.filepath && clip.filename && (
                          <div className="absolute inset-0 bg-[rgba(9,13,22,0.3)] opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center pointer-events-none">
                            <div className="bg-[rgba(255,255,255,0.06)] backdrop-blur p-2.5 rounded-full border border-[rgba(255,255,255,0.1)]">
                              <Play className="text-white w-4.5 h-4.5 fill-white" />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Footer Description */}
                      <div className="p-3 border-t border-[rgba(255,255,255,0.03)] bg-[rgba(9,13,22,0.25)] flex justify-between items-center text-[0.72rem] text-text-secondary select-none font-semibold">
                        <span>{clip.cameraCode} - {clip.cameraName}</span>
                        <span className="font-mono text-text-muted">{clip.recordedTime}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: Query Suggestions */}
      <div className="xl:col-span-3 flex flex-col gap-6">
        {/* Recent & Suggested */}
        <div className="flex flex-col gap-3 text-left">
          <h3 className="text-[0.75rem] font-bold text-text-muted uppercase tracking-wider select-none">
            Recent & suggested
          </h3>
          <div className="flex flex-col gap-2">
            {[
              'Everyone who entered the loading dock wearing a red jacket after 6pm',
              'Where did subject 4471 go after the lobby?',
            ].map((text, idx) => (
              <button
                key={idx}
                onClick={() => handleSuggestionClick(text)}
                className="w-full text-left p-3.5 bg-[rgba(15,23,42,0.35)] hover:bg-[rgba(30,41,59,0.5)] border border-border-glass rounded-xl flex items-start gap-2.5 text-[0.8rem] font-semibold text-text-secondary hover:text-white transition-all duration-200 cursor-pointer border-none outline-none"
              >
                <Search size={14} className="text-text-muted mt-0.5 shrink-0" />
                <span className="line-clamp-2 leading-snug">{text}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Try asking */}
        <div className="flex flex-col gap-3 text-left">
          <h3 className="text-[0.75rem] font-bold text-text-muted uppercase tracking-wider select-none">
            Try asking
          </h3>
          <div className="flex flex-col gap-2">
            {[
              'People without a badge in restricted zones today',
              'Vehicles that stopped at the perimeter gate over 2 minutes',
              'Anyone matching subject 4468 in the last hour',
              'Unattended bags left longer than 5 minutes',
            ].map((text, idx) => (
              <button
                key={idx}
                onClick={() => handleSuggestionClick(text)}
                className="w-full text-left p-3.5 bg-[rgba(15,23,42,0.35)] hover:bg-[rgba(30,41,59,0.5)] border border-border-glass rounded-xl flex items-start gap-2.5 text-[0.8rem] font-semibold text-text-secondary hover:text-white transition-all duration-200 cursor-pointer border-none outline-none"
              >
                <MessageSquare size={14} className="text-text-muted mt-0.5 shrink-0" />
                <span className="line-clamp-2 leading-snug">{text}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Video Clip Player dialog */}
      <Dialog
        open={!!previewClip}
        onOpenChange={(open) => { if (!open) setPreviewClip(null); }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden top-1/2">
          <div className="flex items-center justify-between gap-3 p-4 border-b border-border-glass shrink-0">
            <div className="min-w-0 text-left">
              <DialogTitle className="text-[1rem] truncate">{previewClip?.camera}</DialogTitle>
              <p className="text-[0.72rem] text-text-muted truncate">
                {previewClip ? new Date(previewClip.timestamp).toLocaleString() : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPreviewClip(null)}
              className="btn btn-secondary p-2 rounded-lg shrink-0 cursor-pointer"
              aria-label="Close preview"
            >
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {previewClip && (
              <RagClipPreviewPanel
                key={previewClip.id}
                clip={previewClip}
                orgSettings={orgSettings}
                onPlayDetectionClip={playPreviewDetectionClip}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Sub-offset clip player modal */}
      <TimelineClipPlaybackDialog
        playback={clipPlayback}
        onClose={() => setClipPlayback(null)}
      />
    </div>
  );
}

function RagClipPreviewPanel({
  clip,
  orgSettings,
  onPlayDetectionClip,
}: {
  clip: VideoClip;
  orgSettings: OrgSettings;
  onPlayDetectionClip: (opts: CropClipPlayback & { cropFilename: string }) => void | Promise<void>;
}) {
  const [loadingClipDetections, setLoadingClipDetections] = useState(true);
  const [clipDetections, setClipDetections] = useState<ClipObjectDetection[]>([]);
  const [clipReidLog, setClipReidLog] = useState<ClipReidLog | null>(null);

  useEffect(() => {
    let cancelled = false;

    void apiFetch(`/clips/${clip.id}/detections`)
      .then(async (res) => {
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (Array.isArray(data)) {
          setClipDetections(data);
          setClipReidLog(null);
        } else {
          setClipDetections(Array.isArray(data.objects) ? data.objects : []);
          setClipReidLog(data.reidLog ?? null);
        }
      })
      .catch((err) => console.error('Failed to load clip detections', err))
      .finally(() => {
        if (!cancelled) setLoadingClipDetections(false);
      });

    return () => { cancelled = true; };
  }, [clip.id]);

  return (
    <ClipPreviewPanel
      clip={clip}
      videoHeightClass="h-[min(40vh,280px)]"
      orgSettings={orgSettings}
      loadingClipDetections={loadingClipDetections}
      clipDetections={clipDetections}
      clipReidLog={clipReidLog}
      onOpenPersonRefs={() => { }}
      onCropPreview={() => { }}
      onPlayDetectionClip={onPlayDetectionClip}
    />
  );
}
