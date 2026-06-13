import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog';
import type { OrgSettings } from '../../../api';
import type { ClipObjectDetection, ClipReidLog, CropClipPlayback, VideoClip } from '../../types';
import { formatClipListDateTime } from '../../utils/format';
import { ClipPreviewPanel } from '../ClipPreviewPanel';

export interface MobileClipPreviewDialogProps {
  open: boolean;
  clip: VideoClip | null;
  deviceName?: string;
  orgSettings: OrgSettings;
  loadingClipDetections: boolean;
  clipDetections: ClipObjectDetection[];
  clipReidLog: ClipReidLog | null;
  onClose: () => void;
  onOpenPersonRefs: (obj: ClipObjectDetection) => void;
  onCropPreview: (filename: string) => void;
  onPlayDetectionClip: (opts: CropClipPlayback & { cropFilename: string }) => void | Promise<void>;
}

export function MobileClipPreviewDialog({
  open,
  clip,
  deviceName,
  orgSettings,
  loadingClipDetections,
  clipDetections,
  clipReidLog,
  onClose,
  onOpenPersonRefs,
  onCropPreview,
  onPlayDetectionClip,
}: MobileClipPreviewDialogProps) {
  return (
    <Dialog
      open={open && !!clip}
      onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}
    >
      <DialogContent className="inset-0 top-0 left-0 max-w-none w-full h-full translate-x-0 translate-y-0 flex flex-col p-0 rounded-none lg:hidden">
        <div className="flex items-center justify-between gap-3 p-4 border-b border-border-glass shrink-0">
          <div className="min-w-0">
            <DialogTitle className="text-[1rem] truncate">{clip?.camera}</DialogTitle>
            <p className="text-[0.72rem] text-text-muted truncate">
              {clip ? formatClipListDateTime(clip.timestamp) : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary p-2 rounded-lg shrink-0"
            aria-label="Close preview"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {clip && (
            <ClipPreviewPanel
              clip={clip}
              videoHeightClass="h-[min(40vh,280px)]"
              deviceName={deviceName}
              orgSettings={orgSettings}
              loadingClipDetections={loadingClipDetections}
              clipDetections={clipDetections}
              clipReidLog={clipReidLog}
              onOpenPersonRefs={onOpenPersonRefs}
              onCropPreview={onCropPreview}
              onPlayDetectionClip={onPlayDetectionClip}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
