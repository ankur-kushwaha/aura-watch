import { Activity, Clock, Cpu, Loader2, ScanSearch, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { OrgSettings } from '../../api';
import type { ClipObjectDetection, ClipReidLog, CropClipPlayback, VideoClip } from '../types';
import { getClipDetectionCount } from '../utils/clips';
import { formatClipDuration, formatDate } from '../utils/format';
import { mediaUrl } from '../utils/media';
import { tryParseClipAiAnalysis } from '../utils/summary';
import { InlineCopyIds } from './IdsInfoIcon';
import { buildTimelineIdEntries } from './idEntries';

export interface ClipPreviewPanelProps {
  clip: VideoClip;
  videoContainerClass?: string;
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
  videoContainerClass = 'aspect-[16/9] w-full',
  deviceName,
  orgSettings,
  generatingAiSummary = false,
  aiSummaryError = null,
  onGenerateAiSummary,
}: ClipPreviewPanelProps) {
  const selectedDurationLabel = formatClipDuration(clip.duration);
  const selectedDetectionCount = getClipDetectionCount(clip);
  const detectionSummary = clip.summary?.trim();
  const aiAnalysis = tryParseClipAiAnalysis(clip.aiSummary);
  const canGenerateAiSummary = orgSettings.aiChat && !!onGenerateAiSummary;
  const [videoError, setVideoError] = useState<string | null>(null);

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
        </div>
      <div className={`bg-black rounded-xl overflow-hidden ${videoContainerClass} border border-border-glass shrink-0 relative order-1 lg:order-2 lg:flex-1 lg:min-w-0 lg:sticky lg:top-0 lg:self-start`}>
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
