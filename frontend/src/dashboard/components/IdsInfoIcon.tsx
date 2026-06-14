import { useState } from 'react';
import { Check, Copy, Info } from 'lucide-react';
import { copyToClipboard, filterIdEntries, type IdEntry } from './idEntries';

export type { IdEntry } from './idEntries';

export function InlineCopyIds({
  ids,
  className = '',
  defaultOpen = false,
}: {
  ids: IdEntry[];
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const entries = filterIdEntries(ids);

  if (entries.length === 0) return null;

  const handleCopy = async (label: string, value: string) => {
    await copyToClipboard(value);
    setCopiedLabel(label);
    setTimeout(() => setCopiedLabel(null), 2000);
  };

  return (
    <div className={`mt-1.5 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1 text-[0.6rem] text-text-muted hover:text-sky-400 opacity-70 hover:opacity-100"
      >
        <Info size={11} />
        {open ? 'Hide IDs' : 'Show IDs'}
      </button>
      {open && (
        <div className="mt-1 rounded-md border border-border-glass bg-[rgba(0,0,0,0.25)] overflow-hidden">
          {entries.map((entry, index) => (
            <div
              key={entry.label}
              className={`flex items-center gap-2 px-2 py-1 min-w-0 ${index > 0 ? 'border-t border-border-glass' : ''}`}
            >
              <span className="text-[0.58rem] font-semibold uppercase tracking-wide text-text-muted w-18 shrink-0">
                {entry.label}
              </span>
              <code
                className="flex-1 min-w-0 text-[0.6rem] font-mono text-sky-400 truncate select-all"
                title={entry.value}
              >
                {entry.value}
              </code>
              <button
                type="button"
                onClick={() => { void handleCopy(entry.label, entry.value); }}
                title={`Copy ${entry.label}`}
                className="btn btn-secondary p-1 shrink-0 opacity-70 hover:opacity-100"
              >
                {copiedLabel === entry.label ? (
                  <Check size={11} className="text-emerald-400" />
                ) : (
                  <Copy size={11} />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function IdsInfoIcon({
  ids,
  className = '',
}: {
  ids: IdEntry[];
  className?: string;
}) {
  const [showTip, setShowTip] = useState(false);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const entries = filterIdEntries(ids);

  const stopBubble = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  const handleCopy = (e: React.MouseEvent, label: string, value: string) => {
    stopBubble(e);
    void copyToClipboard(value).then(() => {
      setCopiedLabel(label);
      setTimeout(() => setCopiedLabel(null), 2000);
    });
  };

  if (entries.length === 0) return null;

  return (
    <div
      className={`relative inline-flex shrink-0 ${className}`}
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => {
        setShowTip(false);
        setCopiedLabel(null);
      }}
      onMouseDown={stopBubble}
      onClick={stopBubble}
    >
      <span
        className="inline-flex items-center text-text-muted hover:text-sky-400 cursor-default select-none opacity-60 hover:opacity-100"
        title="View IDs"
      >
        <Info size={11} />
      </span>
      {showTip && (
        <div
          className="absolute bottom-full left-0 mb-1.5 z-200 w-64 rounded-lg border border-border-glass bg-[rgba(15,17,26,0.98)] p-2.5 shadow-xl backdrop-blur-md"
          onMouseDown={stopBubble}
          onClick={stopBubble}
        >
          <div className="flex flex-col gap-2">
            {entries.map((entry) => (
              <div key={entry.label}>
                <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-text-muted mb-0.5">
                  {entry.label}
                </p>
                <div className="flex items-start gap-1.5">
                  <code className="flex-1 text-[0.62rem] font-mono text-sky-400 break-all leading-relaxed">
                    {entry.value}
                  </code>
                  <button
                    type="button"
                    onClick={(e) => handleCopy(e, entry.label, entry.value)}
                    title={`Copy ${entry.label}`}
                    className="btn btn-secondary p-1 shrink-0"
                  >
                    {copiedLabel === entry.label ? (
                      <Check size={12} className="text-emerald-400" />
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function EntityIds({
  identityId,
  detectionId,
  clipId,
  className = '',
}: {
  identityId: string;
  detectionId?: string | null;
  clipId?: string | null;
  className?: string;
}) {
  const ids = [
    { label: 'identity', value: identityId },
    ...(detectionId ? [{ label: 'detection', value: detectionId }] : []),
    ...(clipId ? [{ label: 'clip', value: clipId }] : []),
  ];
  return <IdsInfoIcon ids={ids} className={className} />;
}
