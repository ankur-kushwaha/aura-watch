import { useState } from 'react';
import {
  Clock,
  Fingerprint,
  HelpCircle,
  Link2,
  Play,
  RefreshCw,
  Send,
  SlidersHorizontal,
  Sparkles,
  Video,
  X,
} from 'lucide-react';
import { apiFetch, type OrgSettings } from '../../../api';
import { ChatMarkdown } from '../../../ChatMarkdown';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog';
import { REID_CROP_IMG } from '../../constants';
import type { CameraStream, ChatMessage, RagResponseClip, TimelineVideoPlayback } from '../../types';
import { mediaUrl } from '../../utils/media';
import { TimelineClipPlaybackDialog } from './TimelineClipPlaybackDialog';

export interface AskCameraAiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgSettings: OrgSettings;
  streams: CameraStream[];
  onlineDeviceIds: Set<string>;
  visibleClipIds: Set<string>;
  hasOnlineDevices: boolean;
}

export function AskCameraAiDialog({
  open,
  onOpenChange,
  orgSettings,
  streams,
  onlineDeviceIds,
  visibleClipIds,
  hasOnlineDevices,
}: AskCameraAiDialogProps) {
  const [query, setQuery] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const [filterStartTime, setFilterStartTime] = useState('');
  const [filterEndTime, setFilterEndTime] = useState('');
  const [filterStreamId, setFilterStreamId] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [clipPlayback, setClipPlayback] = useState<TimelineVideoPlayback | null>(null);

  const getRagClipFilename = (clip: RagResponseClip) =>
    clip.filename || clip.filepath.split(/[/\\]/).pop() || '';

  const openRagClipPlayback = (clip: RagResponseClip) => {
    const filename = getRagClipFilename(clip);
    if (!filename) return;
    setClipPlayback({
      filename,
      offsetMs: 0,
      cameraName: clip.camera,
      cropFilename: '',
    });
  };

  const isRagClipFromOnlineDevice = (clip: RagResponseClip) => {
    if (!clip.deviceId) return visibleClipIds.has(clip.id);
    return onlineDeviceIds.has(clip.deviceId);
  };

  const isReidDetectionFromOnlineDevice = (det: { deviceId?: string | null }) => {
    if (!det.deviceId) return hasOnlineDevices;
    return onlineDeviceIds.has(det.deviceId);
  };

  const handleAskQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    const userMessage = query;
    setQuery('');
    setChatHistory((prev) => [...prev, { role: 'user', content: userMessage }]);
    setIsAsking(true);

    try {
      const res = await apiFetch('/rag/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: userMessage,
          history: chatHistory.map((h) => ({ role: h.role, content: h.content })),
          startTime: filterStartTime ? new Date(filterStartTime).toISOString() : undefined,
          endTime: filterEndTime ? new Date(filterEndTime).toISOString() : undefined,
          streamId: filterStreamId || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'AI chat request failed');
      }

      setChatHistory((prev) => [
        ...prev,
        { role: 'assistant', content: data.answer, clips: data.clips, reidDetections: data.reidDetections },
      ]);
    } catch (err) {
      console.error('RAG query failed', err);
      const message = err instanceof Error
        ? err.message
        : 'Sorry, I encountered an error searching for matching footage summaries.';
      setChatHistory((prev) => [...prev, { role: 'assistant', content: message }]);
    } finally {
      setIsAsking(false);
    }
  };

  if (!orgSettings.aiChat) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl min-h-[80vh] max-h-[92vh] flex flex-col p-5 sm:p-6 top-1/2">
        <div className="flex justify-between items-center gap-3 mb-4 shrink-0">
          <DialogTitle id="ask-camera-ai-title" className="text-[1.25rem] flex items-center gap-2">
            <Sparkles size={20} color="var(--color-primary)" /> Ask Camera AI
          </DialogTitle>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className={`btn btn-secondary py-1 px-2.5 text-[0.75rem] rounded-md flex items-center gap-1.5 transition-all duration-200 ${
                showFilters || filterStartTime || filterEndTime || filterStreamId
                  ? 'border-primary text-primary bg-[rgba(124,58,237,0.08)]'
                  : ''
              }`}
            >
              <SlidersHorizontal size={12} />
              Search Filters
              {(filterStartTime || filterEndTime || filterStreamId) && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
              )}
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="btn btn-secondary p-1.5 rounded-md shrink-0"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {!orgSettings.semanticSearch && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[0.8rem] text-amber-200 mb-3 shrink-0">
            Semantic search indexing is disabled. New clips will not be searchable until you enable it in org settings.
          </div>
        )}

        {showFilters && (
          <div className="glass-panel p-3.5 mb-3.5 bg-[rgba(255,255,255,0.01)] border-[rgba(255,255,255,0.08)] rounded-[10px] flex flex-col gap-3 shrink-0">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[0.7rem] text-text-secondary">Target Camera Stream</label>
                <select
                  value={filterStreamId}
                  onChange={(e) => setFilterStreamId(e.target.value)}
                  className="text-[0.8rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[32px]"
                >
                  <option value="">All Streams</option>
                  {streams.map((s) => (
                    <option key={s.streamId} value={s.streamId}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[0.7rem] text-text-secondary">Start Time</label>
                <input
                  type="datetime-local"
                  value={filterStartTime}
                  onChange={(e) => setFilterStartTime(e.target.value)}
                  className="text-[0.8rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[32px]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[0.7rem] text-text-secondary">End Time</label>
                <input
                  type="datetime-local"
                  value={filterEndTime}
                  onChange={(e) => setFilterEndTime(e.target.value)}
                  className="text-[0.8rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[32px]"
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
                className="btn btn-secondary py-1 px-2 text-[0.7rem] self-end rounded flex items-center gap-1 hover:text-danger hover:border-danger bg-transparent font-semibold border-none"
              >
                Clear Filters
              </button>
            )}
          </div>
        )}

        <div className="flex-1 min-h-[420px] overflow-y-auto flex flex-col gap-3 pr-1 mb-4 border-b border-[rgba(255,255,255,0.05)]">
          {chatHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-muted text-center p-5">
              <HelpCircle size={32} className="text-text-muted mb-2.5 mx-auto" />
              <p className="text-[0.85rem] font-semibold">No active session query.</p>
              <p className="text-[0.75rem] max-w-[300px] mt-1">
                Ask questions about video events, e.g.: &quot;Has anyone walked past in a red shirt?&quot; or &quot;What activity was recorded on my camera?&quot;
              </p>
            </div>
          ) : (
            chatHistory.map((chat, idx) => (
              <div key={idx} className={`flex flex-col max-w-[85%] ${chat.role === 'user' ? 'self-end' : 'self-start'}`}>
                <div className={`p-2.5 px-3.5 rounded-xl text-[0.85rem] leading-[1.4] ${
                  chat.role === 'user'
                    ? 'bg-gradient-to-br from-primary to-[#6d28d9] text-white shadow-[0_4px_10px_rgba(124,58,237,0.15)] border-none'
                    : 'bg-[rgba(255,255,255,0.04)] border border-border-glass text-text-primary'
                }`}>
                  {chat.role === 'assistant' ? <ChatMarkdown content={chat.content} /> : chat.content}
                </div>

                {chat.role === 'assistant' && chat.clips && chat.clips.filter(isRagClipFromOnlineDevice).length > 0 && (
                  <div className="mt-2 w-full flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5 text-[0.75rem] text-text-muted">
                      <Video size={12} color="var(--color-primary)" />
                      <span>Cited Video Footage:</span>
                    </div>
                    <div className="relative border-l-2 border-secondary/25 ml-4 pl-6 flex flex-col gap-3 max-h-[280px] overflow-y-auto pr-1">
                      {[...chat.clips.filter(isRagClipFromOnlineDevice)]
                        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
                        .map((c) => {
                          const matchPercentage = c.score ? Math.round(c.score * 100) : null;
                          const canPlay = !!getRagClipFilename(c);

                          return (
                            <div key={c.id} className="relative">
                              <div className="absolute -left-[27px] top-3.5 w-3 h-3 rounded-full bg-secondary border-2 border-[#090d16]" />
                              <div className="glass-panel p-2.5 flex gap-3 items-center rounded-xl w-full border border-[rgba(255,255,255,0.06)] bg-[rgba(15,23,42,0.6)]">
                                <div className="relative w-14 h-[72px] shrink-0 bg-[#020617] rounded-md overflow-hidden border border-[rgba(255,255,255,0.05)] flex items-center justify-center">
                                  <Video size={18} className="text-text-muted" />
                                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                    <Play size={16} className="text-white" fill="white" />
                                  </div>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-[0.8rem] font-semibold text-text-primary truncate" title={c.camera}>
                                    {c.camera}
                                  </div>
                                  <div className="text-[0.68rem] text-text-muted flex items-center gap-1.5 flex-wrap mt-0.5">
                                    <Clock size={11} />
                                    {new Date(c.timestamp).toLocaleString([], {
                                      month: 'short',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      second: '2-digit',
                                    })}
                                  </div>
                                  {matchPercentage !== null && (
                                    <span className="inline-block mt-1 text-[0.65rem] text-secondary bg-[rgba(6,182,212,0.1)] py-0.5 px-1.5 rounded font-semibold">
                                      {matchPercentage}% Match
                                    </span>
                                  )}
                                </div>
                                {canPlay && (
                                  <button
                                    type="button"
                                    onClick={() => openRagClipPlayback(c)}
                                    className="btn btn-secondary py-1 px-2 text-[0.65rem] h-[24px] rounded flex items-center gap-1 shrink-0 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)]"
                                  >
                                    <Link2 size={10} /> View
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                {chat.role === 'assistant' && chat.reidDetections && chat.reidDetections.filter(isReidDetectionFromOnlineDevice).length > 0 && (
                  <div className="mt-2 w-full flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5 text-[0.75rem] text-text-muted">
                      <Fingerprint size={12} color="var(--color-secondary)" />
                      <span>Cited REID Detections:</span>
                    </div>
                    <div className="flex gap-2.5 overflow-x-auto pb-2 w-full scroll-smooth">
                      {chat.reidDetections.filter(isReidDetectionFromOnlineDevice).map((det, dIdx) => (
                        <div
                          key={dIdx}
                          className="glass-panel shrink-0 w-[160px] p-2 rounded-[10px] border border-[rgba(255,255,255,0.06)] bg-[rgba(15,23,42,0.6)]"
                        >
                          <div className="w-full h-[100px] bg-[#020617] rounded-md overflow-hidden relative border border-[rgba(255,255,255,0.05)] mb-1.5">
                            <img src={mediaUrl(`/crops/${det.filename}`)} alt={`Track ${det.trackId}`} className={`w-full h-full ${REID_CROP_IMG}`} />
                            <div className="absolute bottom-1 right-1 text-[0.6rem] bg-black/60 text-white px-1.5 py-0.5 rounded font-mono">
                              ID:{det.trackId}
                            </div>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span title={det.cameraName} className="text-[0.72rem] font-semibold text-text-primary overflow-hidden text-ellipsis whitespace-nowrap">
                              {det.cameraName}
                            </span>
                            <div className="flex justify-between items-center">
                              <span className={`text-[0.6rem] font-bold px-1.5 py-0.5 rounded capitalize ${
                                det.className === 'vehicle'
                                  ? 'bg-[rgba(6,182,212,0.15)] text-[#06b6d4]'
                                  : 'bg-[rgba(124,58,237,0.15)] text-[#a78bfa]'
                              }`}>
                                {det.className}
                              </span>
                              <span className="text-[0.6rem] text-text-muted">
                                {new Date(det.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
          {isAsking && (
            <div className="self-start bg-[rgba(255,255,255,0.04)] border border-border-glass p-2.5 px-3.5 rounded-xl text-[0.85rem] flex items-center gap-2">
              <RefreshCw size={12} className="animate-spin" /> Searching clips and REID detections...
            </div>
          )}
        </div>

        <form onSubmit={handleAskQuestion} className="flex gap-2 shrink-0">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask about recordings or detected persons — e.g., 'How many people were seen today?' or 'Was anyone detected after 9pm?'"
            className="flex-1"
            disabled={isAsking}
          />
          <button type="submit" className="btn btn-primary py-2.5 px-3.5" disabled={isAsking}>
            <Send size={16} />
          </button>
        </form>
      </DialogContent>

      <TimelineClipPlaybackDialog
        playback={clipPlayback}
        onClose={() => setClipPlayback(null)}
      />
    </Dialog>
  );
}
