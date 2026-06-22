
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog';
import type { CameraStream } from '../../types';
import { EditStreamForm } from '../EditStreamForm';

export interface EditStreamModalProps {
  open: boolean;
  stream: CameraStream | null;
  allStreamIds?: string[];
  onClose: () => void;
  onSaved: () => void;
}

export function EditStreamModal({ open, stream, allStreamIds = [], onClose, onSaved }: EditStreamModalProps) {
  return (
    <Dialog open={open && !!stream} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-w-[480px] p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto bg-[#0b0f19] border border-border-glass text-text-primary rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="text-left">
            <DialogTitle className="text-[1.2rem] font-bold tracking-tight text-white">IP Camera settings</DialogTitle>
            <p className="text-[0.78rem] text-text-muted mt-1">{stream?.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn p-1.5 bg-transparent border-none text-text-muted hover:text-white rounded-lg hover:bg-[rgba(255,255,255,0.06)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="h-px bg-border-glass shrink-0" />

        {/* Extracted form component */}
        {stream && (
          <EditStreamForm
            stream={stream}
            allStreamIds={allStreamIds}
            onClose={onClose}
            onSaved={() => {
              onSaved();
              onClose();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
