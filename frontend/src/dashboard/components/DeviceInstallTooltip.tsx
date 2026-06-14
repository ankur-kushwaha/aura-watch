import { useState } from 'react';
import { Check, Copy, Info, Plus, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/dialog';
import { buildInstallCmd } from '../utils/media';

export function DeviceInstallTooltip({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedOrgId, setCopiedOrgId] = useState(false);

  const installCmd = buildInstallCmd(orgId);

  const handleCopyCmd = () => {
    navigator.clipboard.writeText(installCmd).then(() => {
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2000);
    });
  };

  const handleCopyOrgId = () => {
    navigator.clipboard.writeText(orgId).then(() => {
      setCopiedOrgId(true);
      setTimeout(() => setCopiedOrgId(false), 2000);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="How to add a new device"
        className="inline-flex items-center p-0.5 text-text-muted hover:text-primary transition-colors bg-transparent border-none cursor-pointer"
      >
        <Info size={15} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <DialogTitle className="text-[0.95rem] text-primary flex items-center gap-2">
                <Plus size={16} /> Add a New Edge Device
              </DialogTitle>
              <DialogDescription className="mt-1 leading-relaxed">
                Run the install command on your target device (Linux / macOS). The edge agent gets a fixed device ID
                automatically and joins your organization using the ID below as <code className="text-sky-400">ENROLLMENT_TOKEN</code>.
              </DialogDescription>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn btn-secondary p-1.5 rounded-md shrink-0"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
            <p className="text-[0.7rem] font-semibold text-emerald-400 mb-1.5 uppercase tracking-wide">
              Organization ID (ENROLLMENT_TOKEN)
            </p>
            <div className="flex items-start gap-2">
              <code className="flex-1 text-[0.72rem] text-emerald-300 font-mono break-all leading-relaxed">
                {orgId}
              </code>
              <button
                type="button"
                onClick={handleCopyOrgId}
                title="Copy organization ID"
                className="btn btn-secondary p-1.5 shrink-0"
              >
                {copiedOrgId ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              </button>
            </div>
          </div>

          <p className="text-[0.75rem] font-semibold text-text-secondary mb-2">Install command</p>
          <div className="rounded-lg border border-border-glass bg-black/40 p-3 flex items-start gap-2">
            <code className="flex-1 text-[0.7rem] text-sky-400 font-mono break-all leading-relaxed">
              {installCmd}
            </code>
            <button
              type="button"
              onClick={handleCopyCmd}
              title="Copy command"
              className="btn btn-secondary p-1.5 shrink-0"
            >
              {copiedCmd ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            </button>
          </div>

          <p className="text-[0.72rem] text-text-muted mt-4 leading-relaxed">
            After the agent connects, the device appears here. Add camera streams from the device card.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
