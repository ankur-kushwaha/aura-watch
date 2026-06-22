import { Activity, Clock, Cpu, Fingerprint, Loader2, ScanSearch, ScrollText, Sparkles, UserCircle, Car, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { OrgSettings } from '../../api';
import type { ClipObjectDetection, ClipReidLog, CropClipPlayback, VideoClip } from '../types';
import { getClipDetectionCount } from '../utils/clips';
import { formatClipDuration, formatClipOffsetMs, formatDate } from '../utils/format';
import { mediaUrl } from '../utils/media';
import { tryParseClipAiAnalysis } from '../utils/summary';
import { isVehicleClass } from '../utils';
import { CropThumbnail } from './CropThumbnail';
import { IdsInfoIcon, InlineCopyIds } from './IdsInfoIcon';
import { buildTimelineIdEntries } from './idEntries';

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
  videoHeightClass = 'h-[min(38vh,260px)] lg:h-[min(82vh,640px)]',
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
  const aiAnalysis = tryParseClipAiAnalysis(clip.aiSummary);
  const canGenerateAiSummary = orgSettings.aiChat && !!onGenerateAiSummary;
  const [videoError, setVideoError] = useState<string | null>(null);
  const [reidLogOpenClipId, setReidLogOpenClipId] = useState<string | null>(null);
  const reidLogOpen = reidLogOpenClipId === clip.id;

  return (
    <div className="flex flex-col gap-3 min-h-0 h-full">
      <div className="shrink-0 rounded-lg border border-border-glass bg-[rgba(255,255,255,0.02)] px-3 py-2.5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-[0.9rem] font-semibold text-text-primary">{clip.camera}</h3>
            <p className="text-[0.7rem] text-text-muted break-all mt-0.5">{clip.filename}</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.68rem] text-text-muted shrink-0">
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Clock size={11} /> {formatDate(clip.timestamp)}
            </span>
            {deviceName && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <Cpu size={11} /> {deviceName}
              </span>
            )}
            {selectedDurationLabel && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                Duration: {selectedDurationLabel}
              </span>
            )}
            {selectedDetectionCount !== null && (
              <span className="inline-flex items-center gap-1 text-sky-400/90 whitespace-nowrap">
                <Activity size={11} />
                {selectedDetectionCount} YOLO detection{selectedDetectionCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
        <div className="mt-2">
          <InlineCopyIds ids={buildTimelineIdEntries({ clipId: clip.id })} />
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-3 lg:gap-4 flex-1 min-h-0">
        <div className="flex flex-col gap-3 flex-1 min-w-0 min-h-0 overflow-y-auto order-2 lg:order-1 pr-0.5">
        {orgSettings.videoSummary && !aiAnalysis && (
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
          <div className="bg-[rgba(124,58,237,0.05)] border border-[rgba(124,58,237,0.15)] rounded-lg p-2.5">
            <div className="flex items-start justify-between gap-2 mb-1">
              <p className="text-[0.7rem] font-bold text-[#a78bfa] uppercase tracking-wider flex items-center gap-1">
                <Sparkles size={12} />AI Summary
              </p>
              {canGenerateAiSummary && (
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
            {aiAnalysis ? (
              <div className="flex flex-col gap-2">
                <p className="text-[0.8rem] text-text-secondary leading-[1.4]">{aiAnalysis.summary}</p>
                <div className="flex flex-wrap gap-2 text-[0.72rem]">
                  <span className="bg-[rgba(124,58,237,0.12)] text-[#c4b5fd] px-2 py-0.5 rounded-full border border-[rgba(124,58,237,0.2)]">
                    {aiAnalysis.objectCounts.person} person{aiAnalysis.objectCounts.person === 1 ? '' : 's'}
                  </span>
                  <span className="bg-[rgba(124,58,237,0.12)] text-[#c4b5fd] px-2 py-0.5 rounded-full border border-[rgba(124,58,237,0.2)]">
                    {aiAnalysis.objectCounts.vehicle} vehicle{aiAnalysis.objectCounts.vehicle === 1 ? '' : 's'}
                  </span>
                </div>
                {aiAnalysis.objects.length > 0 && (
                  <div className="flex flex-col gap-1.5 mt-0.5">
                    {aiAnalysis.objects.map((obj, index) => (
                      <div
                        key={index}
                        className="text-[0.75rem] text-text-muted leading-snug border-l-2 border-[rgba(124,58,237,0.25)] pl-2"
                      >
                        {obj.type === 'person' ? (
                          <>
                            <span className="text-[#c4b5fd] font-medium capitalize">Person {index + 1}</span>
                            {obj.gender && <span> · {obj.gender}</span>}
                            {obj.age && <span> · {obj.age}</span>}
                            {obj.clothingColors?.length ? (
                              <span> · {obj.clothingColors.join(', ')}</span>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <span className="text-[#c4b5fd] font-medium capitalize">Vehicle {index + 1}</span>
                            {obj.color && <span> · {obj.color}</span>}
                            {obj.vehicleType && <span> · {obj.vehicleType}</span>}
                            {obj.licensePlate && <span> · plate {obj.licensePlate}</span>}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : clip.aiSummary?.trim() ? (
              <p className="text-[0.8rem] text-text-secondary leading-[1.4]">{clip.aiSummary}</p>
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
        {orgSettings.reidProcessing && (loadingClipDetections || clipDetections.length > 0) && (
          <div className="bg-[rgba(56,189,248,0.05)] border border-[rgba(56,189,248,0.15)] rounded-lg p-2.5">
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
                  const detectionOffsetLabel = formatClipOffsetMs(obj.clipOffsetMs);
                  const isReidEligible = obj.className === 'person' || isVehicleClass(obj.className);
                  const isClickable = isReidEligible && !!obj.detectionId;
                  const hasIdentity = !!obj.identityId;
                  const personIds = [
                    ...(obj.identityId ? [{ label: 'identity', value: obj.identityId }] : []),
                    ...(obj.detectionId ? [{ label: 'detection', value: obj.detectionId }] : []),
                  ];
                  return (
                    <div
                      key={obj.trackId}
                      role={isClickable ? 'button' : undefined}
                      tabIndex={isClickable ? 0 : undefined}
                      onClick={isClickable ? () => onOpenPersonRefs(obj) : undefined}
                      onKeyDown={isClickable ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpenPersonRefs(obj);
                        }
                      } : undefined}
                      className={`flex flex-col gap-1.5 text-left w-full rounded-lg px-2 py-2 -mx-1 border border-transparent ${
                        isClickable
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
                            clipPlayback={(obj.detectionId || obj.clipOffsetMs != null) ? {
                              clipFilename: clip.filename,
                              clipOffsetMs: obj.clipOffsetMs ?? 0,
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
                        {detectionOffsetLabel && (
                          <span className="text-[0.68rem] text-text-muted flex items-center gap-0.5">
                            <Clock size={10} />
                            {detectionOffsetLabel}
                          </span>
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
                        {isClickable && (
                          <span className="text-[0.65rem] text-primary ml-auto">
                            {hasIdentity ? 'Timeline & matches →' : 'Identify & matches →'}
                          </span>
                        )}
                      </div>
                      {isReidEligible && (
                        <div className="pl-12 flex flex-col gap-1">
                          {obj.labelStatus === 'confirmed' && obj.label && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {isVehicleClass(obj.className) ? (
                                <Car size={12} className="text-green-400 shrink-0" />
                              ) : (
                                <UserCircle size={12} className="text-green-400 shrink-0" />
                              )}
                              <span className="text-[0.72rem] text-green-400 font-medium">{obj.label}</span>
                              <IdsInfoIcon ids={personIds} />
                            </div>
                          )}
                          {(obj.labelStatus === 'none' || obj.labelStatus === 'suggested') && isClickable && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[0.72rem] text-amber-400">
                                Unassigned — click to create a new identity or link to existing
                              </span>
                              <IdsInfoIcon ids={personIds} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {orgSettings.reidProcessing && !loadingClipDetections && clipReidLog && clipReidLog.entries.length > 0 && (
          <div className="rounded-lg border border-border-glass bg-[rgba(255,255,255,0.02)] p-2.5">
            <button
              type="button"
              onClick={() => setReidLogOpenClipId(reidLogOpen ? null : clip.id)}
              className="w-full flex items-center justify-between gap-2 text-left py-0.5 text-text-muted hover:text-text-secondary transition-colors"
            >
              <span className="text-[0.65rem] font-bold uppercase tracking-wider flex items-center gap-1">
                <ScrollText size={11} />
                {reidLogOpen ? 'Hide ReID Log' : `Show ReID Log (${clipReidLog.entries.length})`}
              </span>
              {reidLogOpen ? <ChevronUp size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />}
            </button>
            {reidLogOpen && (
              <div className="flex flex-col gap-1 mt-2 pt-2 border-t border-border-glass">
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
            )}
          </div>
        )}
        </div>
      <div className={`bg-black rounded-xl overflow-hidden ${videoHeightClass} border border-border-glass shrink-0 relative order-1 lg:order-2 lg:w-[44%] lg:max-w-[480px] lg:sticky lg:top-0 lg:self-start`}>
        <video
          key={clip.id}
          src={mediaUrl(`/videos/${clip.filename}`)}
          controls
          autoPlay
          onError={() => setVideoError('Could not load clip from the edge device. It may be offline or busy — try again in a few seconds.')}
          onLoadedData={() => setVideoError(null)}
          className="w-full h-full object-contain"
        />
        {videoError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-4 text-center">
            <p className="text-[0.75rem] text-amber-300 leading-snug">{videoError}</p>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
