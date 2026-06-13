import { Activity, Clock, Cpu, Fingerprint, Loader2, ScanSearch, ScrollText, Sparkles, UserCircle } from 'lucide-react';
import type { OrgSettings } from '../../api';
import type { ClipObjectDetection, ClipReidLog, CropClipPlayback, VideoClip } from '../types';
import { getClipDetectionCount } from '../utils/clips';
import { formatClipDuration, formatDate } from '../utils/format';
import { mediaUrl } from '../utils/media';
import { CropThumbnail } from './CropThumbnail';
import { IdsInfoIcon } from './IdsInfoIcon';

export interface ClipPreviewPanelProps {
  clip: VideoClip;
  videoHeightClass?: string;
  deviceName?: string;
  orgSettings: OrgSettings;
  loadingClipDetections: boolean;
  clipDetections: ClipObjectDetection[];
  clipReidLog: ClipReidLog | null;
  generatingAiSummary?: boolean;
  aiSummaryError?: string | null;
  onGenerateAiSummary?: () => void;
  onOpenPersonRefs: (obj: ClipObjectDetection) => void;
  onCropPreview: (filename: string) => void;
  onPlayDetectionClip: (opts: CropClipPlayback & { cropFilename: string }) => void | Promise<void>;
}

export function ClipPreviewPanel({
  clip,
  videoHeightClass = 'h-[220px]',
  deviceName,
  orgSettings,
  loadingClipDetections,
  clipDetections,
  clipReidLog,
  generatingAiSummary = false,
  aiSummaryError = null,
  onGenerateAiSummary,
  onOpenPersonRefs,
  onCropPreview,
  onPlayDetectionClip,
}: ClipPreviewPanelProps) {
  const selectedDurationLabel = formatClipDuration(clip.duration);
  const selectedDetectionCount = getClipDetectionCount(clip);
  const detectionSummary = clip.summary?.trim();
  const aiSummary = clip.aiSummary?.trim();
  const canGenerateAiSummary = orgSettings.aiChat && !!onGenerateAiSummary;

  return (
    <div className="flex flex-col gap-3">
      <div className={`bg-[#000] rounded-xl overflow-hidden ${videoHeightClass} border border-[rgba(255,255,255,0.08)] shrink-0`}>
        <video
          key={clip.id}
          src={mediaUrl(`/videos/${clip.filename}`)}
          controls
          autoPlay
          className="w-full h-full object-contain"
        />
      </div>
      <div>
        <div className="flex justify-between items-start mb-1.5 flex-wrap gap-2">
          <div className="min-w-0">
            <h3 className="text-[0.85rem] font-semibold text-text-primary">{clip.camera}</h3>
            <p className="text-[0.72rem] text-text-muted break-all">{clip.filename}</p>
          </div>
          <div className="text-[0.7rem] text-text-muted flex flex-col items-end gap-1 whitespace-nowrap shrink-0">
            <span className="flex items-center gap-1">
              <Clock size={12} /> {formatDate(clip.timestamp)}
            </span>
            {deviceName && (
              <span className="flex items-center gap-1">
                <Cpu size={12} /> {deviceName}
              </span>
            )}
            {selectedDurationLabel && (
              <span className="flex items-center gap-1">
                Duration: {selectedDurationLabel}
              </span>
            )}
            {selectedDetectionCount !== null && (
              <span className="flex items-center gap-1 text-sky-400/90">
                <Activity size={12} />
                {selectedDetectionCount} YOLO detection{selectedDetectionCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
        {orgSettings.videoSummary && (
          <div className="bg-[rgba(56,189,248,0.05)] border border-[rgba(56,189,248,0.15)] rounded-lg p-2.5">
            <p className="text-[0.7rem] font-bold text-[#38bdf8] uppercase mb-1 tracking-wider flex items-center gap-1">
              <ScanSearch size={12} />Detection Summary
            </p>
            <p className="text-[0.8rem] text-text-secondary leading-[1.4]">
              {detectionSummary || 'No detection metadata available for this clip.'}
            </p>
          </div>
        )}
        {orgSettings.aiChat && (
          <div className="bg-[rgba(124,58,237,0.05)] border border-[rgba(124,58,237,0.15)] rounded-lg p-2.5 mt-3">
            <div className="flex items-start justify-between gap-2 mb-1">
              <p className="text-[0.7rem] font-bold text-[#a78bfa] uppercase tracking-wider flex items-center gap-1">
                <Sparkles size={12} />AI Summary
              </p>
              {canGenerateAiSummary && !aiSummary && (
                <button
                  type="button"
                  onClick={onGenerateAiSummary}
                  disabled={generatingAiSummary}
                  className="btn btn-secondary text-[0.68rem] py-1 px-2 shrink-0 flex items-center gap-1"
                >
                  {generatingAiSummary ? (
                    <>
                      <Loader2 size={11} className="animate-spin" />
                      Generating…
                    </>
                  ) : (
                    <>
                      <Sparkles size={11} />
                      Generate
                    </>
                  )}
                </button>
              )}
            </div>
            {aiSummary ? (
              <p className="text-[0.8rem] text-text-secondary leading-[1.4]">{aiSummary}</p>
            ) : (
              <p className="text-[0.75rem] text-text-muted leading-[1.4]">
                {generatingAiSummary
                  ? 'Analyzing clip with AI vision…'
                  : 'Generate an AI summary on demand for clothing, actions, and scene details.'}
              </p>
            )}
            {aiSummaryError && (
              <p className="text-[0.72rem] text-red-400 mt-1.5">{aiSummaryError}</p>
            )}
          </div>
        )}
        {orgSettings.reidProcessing && (loadingClipDetections || clipDetections.length > 0 || clipReidLog) && (
          <div className="bg-[rgba(56,189,248,0.05)] border border-[rgba(56,189,248,0.15)] rounded-lg p-2.5 mt-3">
            <p className="text-[0.7rem] font-bold text-[#38bdf8] uppercase mb-2 tracking-wider flex items-center gap-1">
              <Fingerprint size={12} />Detected Objects
            </p>
            {loadingClipDetections ? (
              <p className="text-[0.75rem] text-text-muted">Loading detections…</p>
            ) : clipDetections.length === 0 ? (
              <p className="text-[0.75rem] text-text-muted mb-2">
                No objects tracked during this clip.
              </p>
            ) : (
              <div className="flex flex-col gap-2 mb-2">
                {clipDetections.map((obj) => {
                  const isClickablePerson = obj.className === 'person' && !!obj.detectionId;
                  const hasIdentity = !!obj.identityId;
                  const personIds = [
                    ...(obj.identityId ? [{ label: 'identity', value: obj.identityId }] : []),
                    ...(obj.detectionId ? [{ label: 'detection', value: obj.detectionId }] : []),
                  ];
                  return (
                    <button
                      key={obj.trackId}
                      type="button"
                      disabled={!isClickablePerson}
                      onClick={() => onOpenPersonRefs(obj)}
                      className={`flex flex-col gap-1.5 text-left w-full rounded-lg px-2 py-2 -mx-1 border border-transparent ${
                        isClickablePerson
                          ? 'hover:bg-[rgba(56,189,248,0.08)] hover:border-[rgba(56,189,248,0.15)] cursor-pointer'
                          : 'cursor-default'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-[0.78rem] text-text-secondary">
                        {obj.cropFilename && (
                          <CropThumbnail
                            filename={obj.cropFilename}
                            onPreview={onCropPreview}
                            onPlayClip={onPlayDetectionClip}
                            clipPlayback={obj.detectionId ? {
                              clipFilename: clip.filename,
                              clipOffsetMs: 0,
                              cameraName: clip.camera ?? 'Camera',
                              detectionId: obj.detectionId,
                            } : undefined}
                          />
                        )}
                        <span className="bg-[rgba(56,189,248,0.12)] text-[#38bdf8] px-2 py-0.5 rounded-full border border-[rgba(56,189,248,0.2)] capitalize">
                          {obj.className}
                          {obj.confidence != null && obj.confidence > 0 && (
                            <span className="text-text-muted ml-1">{Math.round(obj.confidence * 100)}%</span>
                          )}
                        </span>
                        {obj.trackId > 0 && (
                          <span className="text-[0.68rem] text-text-muted">track {obj.trackId}</span>
                        )}
                        {obj.className === 'person' && (obj.upperColor || obj.lowerColor) && (
                          <span className="text-[0.68rem] text-text-muted capitalize">
                            {[obj.upperColor, obj.lowerColor].filter(Boolean).join(' / ')}
                          </span>
                        )}
                        {obj.vehicleColor && (
                          <span className="text-[0.68rem] text-text-muted capitalize">
                            {obj.vehicleColor}
                          </span>
                        )}
                        {isClickablePerson && (
                          <span className="text-[0.65rem] text-primary ml-auto">
                            {hasIdentity ? 'Timeline & matches →' : 'Identify & matches →'}
                          </span>
                        )}
                      </div>
                      {obj.className === 'person' && (
                        <div className="pl-12 flex flex-col gap-1">
                          {obj.labelStatus === 'confirmed' && obj.label && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <UserCircle size={12} className="text-green-400 shrink-0" />
                              <span className="text-[0.72rem] text-green-400 font-medium">{obj.label}</span>
                              <IdsInfoIcon ids={personIds} />
                            </div>
                          )}
                          {obj.labelStatus === 'suggested' && obj.label && obj.matchScore != null && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[0.72rem] text-secondary">
                                Suggested: {Math.round(obj.matchScore * 100)}% match · {obj.label}
                                <span className="text-text-muted ml-1">— click to confirm or choose another</span>
                              </span>
                              <IdsInfoIcon ids={personIds} />
                            </div>
                          )}
                          {obj.labelStatus === 'none' && isClickablePerson && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[0.72rem] text-amber-400">
                                Unassigned — click to create a new identity or link to existing
                              </span>
                              <IdsInfoIcon ids={personIds} />
                            </div>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {!loadingClipDetections && clipReidLog && clipReidLog.entries.length > 0 && (
              <div className="pt-2 mt-1 border-t border-[rgba(56,189,248,0.12)]">
                <p className="text-[0.65rem] font-bold text-text-muted uppercase mb-1.5 tracking-wider flex items-center gap-1">
                  <ScrollText size={11} />ReID Log
                </p>
                <div className="flex flex-col gap-1">
                  {clipReidLog.entries.map((entry, idx) => (
                    <p
                      key={idx}
                      className={`text-[0.72rem] leading-snug ${
                        entry.level === 'warn'
                          ? 'text-amber-400'
                          : entry.level === 'error'
                            ? 'text-red-400'
                            : 'text-text-muted'
                      }`}
                    >
                      {entry.message}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
