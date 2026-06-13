import { useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import { REID_CROP_IMG } from '../../constants';
import type { TimelineVideoPlayback } from '../../types';
import { mediaUrl } from '../../utils/media';

export interface TimelineClipPlaybackDialogProps {
  playback: TimelineVideoPlayback | null;
  onClose: () => void;
  /** Render above another open dialog. */
  nested?: boolean;
}

export function TimelineClipPlaybackDialog({ playback, onClose, nested = false }: TimelineClipPlaybackDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playback) return;

    const seekToOffset = () => {
      const detectionSec = playback.offsetMs / 1000;
      video.currentTime = Math.max(0, detectionSec - 1);
    };

    video.addEventListener('loadedmetadata', seekToOffset);
    if (video.readyState >= 1) {
      seekToOffset();
    }

    return () => video.removeEventListener('loadedmetadata', seekToOffset);
  }, [playback]);

  return (
    <Dialog open={!!playback} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent stackLevel={nested ? 'nested' : 'default'} className="max-w-[720px] p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <DialogTitle>{playback?.cameraName}</DialogTitle>
            <DialogDescription className="mt-0.5">
              Clip playback from timeline detection
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary py-1 px-2 text-[0.75rem] rounded-md"
          >
            Close
          </button>
        </div>
        <div className="bg-[#000] rounded-xl overflow-hidden border border-[rgba(255,255,255,0.08)]">
          {playback && (
            <video
              ref={videoRef}
              key={playback.filename}
              src={mediaUrl(`/videos/${playback.filename}`)}
              controls
              preload="metadata"
              className="w-full max-h-[420px] object-contain"
            />
          )}
        </div>
        {playback && (
          <div className="flex items-center gap-3">
            {playback.cropFilename ? (
              <img
                src={mediaUrl(`/crops/${playback.cropFilename}`)}
                alt=""
                className={`w-12 h-12 rounded-lg shrink-0 ${REID_CROP_IMG}`}
              />
            ) : null}
            <p className="text-[0.75rem] text-text-secondary">
              {playback.offsetMs > 0
                ? `Seeked to ${Math.max(0, playback.offsetMs / 1000 - 1).toFixed(1)}s (1s before detection at ${(playback.offsetMs / 1000).toFixed(1)}s into clip). Press play when ready.`
                : 'Press play to watch this clip.'}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
