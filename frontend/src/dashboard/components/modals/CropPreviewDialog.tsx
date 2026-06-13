import { X } from 'lucide-react';
import { Dialog, DialogContent } from '../../../components/ui/dialog';
import { mediaUrl } from '../../utils/media';

export interface CropPreviewDialogProps {
  filename: string | null;
  onClose: () => void;
}

export function CropPreviewDialog({ filename, onClose }: CropPreviewDialogProps) {
  return (
    <Dialog open={!!filename} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-none w-auto border-none bg-transparent shadow-none p-6 flex items-center justify-center">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 btn btn-secondary p-2 rounded-lg z-10"
          aria-label="Close preview"
        >
          <X size={18} />
        </button>
        {filename && (
          <img
            src={mediaUrl(`/crops/${filename}`)}
            alt="ReID crop preview"
            className="max-w-[min(90vw,560px)] max-h-[85vh] object-contain rounded-xl border border-[rgba(56,189,248,0.3)] shadow-2xl bg-black"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
