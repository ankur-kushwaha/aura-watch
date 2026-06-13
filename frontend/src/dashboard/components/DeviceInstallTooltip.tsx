import { useState } from 'react';
import { Check, Copy, Info, Plus, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/dialog';
import { buildInstallCmd } from '../utils/media';

export function DeviceInstallTooltip({ onGenerateToken }: { onGenerateToken: () => Promise<string> }) {
  const [open, setOpen] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [enrollmentToken, setEnrollmentToken] = useState<string>('');
  const [generatingToken, setGeneratingToken] = useState(false);

  const installCmd = buildInstallCmd(enrollmentToken);

  const handleGenerateToken = async () => {
    setGeneratingToken(true);
    try {
      const result = await onGenerateToken();
      setEnrollmentToken(result);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to generate enrollment token');
    } finally {
      setGeneratingToken(false);
    }
  };

  const handleCopyCmd = () => {
    navigator.clipboard.writeText(installCmd).then(() => {
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2000);
    });
  };

  const handleCopyToken = () => {
    if (!enrollmentToken) return;
    navigator.clipboard.writeText(enrollmentToken).then(() => {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
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
                Generate an enrollment token, then run the install command on your target device (Linux / macOS).
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

          <button
            type="button"
            onClick={handleGenerateToken}
            disabled={generatingToken}
            className="btn btn-primary w-full mb-4"
          >
            {generatingToken ? 'Generating…' : enrollmentToken ? 'Regenerate token' : 'Generate enrollment token'}
          </button>

          {enrollmentToken && (
            <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
              <p className="text-[0.7rem] font-semibold text-emerald-400 mb-1.5 uppercase tracking-wide">
                Enrollment token
              </p>
              <div className="flex items-start gap-2">
                <code className="flex-1 text-[0.72rem] text-emerald-300 font-mono break-all leading-relaxed">
                  {enrollmentToken}
                </code>
                <button
                  type="button"
                  onClick={handleCopyToken}
                  title="Copy token"
                  className="btn btn-secondary p-1.5 shrink-0"
                >
                  {copiedToken ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          )}

          <p className="text-[0.75rem] font-semibold text-text-secondary mb-2">Install command</p>
          <div className="rounded-lg border border-border-glass bg-black/40 p-3 flex items-start gap-2">
            <code className="flex-1 text-[0.7rem] text-sky-400 font-mono break-all leading-relaxed">
              {enrollmentToken ? installCmd : 'Generate a token first to get the install command.'}
            </code>
            {enrollmentToken && (
              <button
                type="button"
                onClick={handleCopyCmd}
                title="Copy command"
                className="btn btn-secondary p-1.5 shrink-0"
              >
                {copiedCmd ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              </button>
            )}
          </div>

          <p className="text-[0.72rem] text-text-muted mt-4 leading-relaxed">
            The command installs the edge agent, connects via WebSocket, and registers the device with your organization.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
