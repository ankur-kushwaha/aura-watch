import { useState } from 'react';
import { Check, Copy, Info } from 'lucide-react';

export function IdsInfoIcon({
  ids,
  className = '',
}: {
  ids: { label: string; value: string }[];
  className?: string;
}) {
  const [showTip, setShowTip] = useState(false);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const entries = ids.filter((id) => id.value && id.value !== '—');

  const stopBubble = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  const handleCopy = (e: React.MouseEvent, label: string, value: string) => {
    stopBubble(e);
    navigator.clipboard.writeText(value).then(() => {
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
          className="absolute bottom-full left-0 mb-1.5 z-[200] w-64 rounded-lg border border-border-glass bg-[rgba(15,17,26,0.98)] p-2.5 shadow-xl backdrop-blur-md"
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
