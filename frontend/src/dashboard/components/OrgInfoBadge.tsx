import { useState } from 'react';
import { Building2, Check, Copy } from 'lucide-react';
import type { AuthOrg } from '../../api';

export function OrgInfoBadge({
  org,
  availableOrgs,
  switchingOrg,
  onSwitchOrg,
}: {
  org: AuthOrg;
  availableOrgs: AuthOrg[];
  switchingOrg: boolean;
  onSwitchOrg: (orgId: string) => void;
}) {
  const [showTip, setShowTip] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyId = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(org.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className="relative flex items-center gap-2"
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
    >
      <Building2 size={14} className="text-text-muted" />
      {availableOrgs.length > 1 ? (
        <select
          value={org.id}
          onChange={(e) => onSwitchOrg(e.target.value)}
          disabled={switchingOrg}
          className="text-[0.8rem] bg-transparent border border-border-glass rounded-md py-1 px-2"
        >
          {availableOrgs.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      ) : (
        <span className="text-[0.8rem] text-text-secondary cursor-default">{org.name}</span>
      )}

      {showTip && (
        <div className="absolute top-full right-0 mt-2 z-[100] w-72 rounded-lg border border-border-glass bg-[rgba(15,17,26,0.98)] p-3 shadow-xl backdrop-blur-md">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-text-muted mb-1.5">
            Organization ID
          </p>
          <div className="flex items-start gap-2">
            <code className="flex-1 text-[0.68rem] font-mono text-sky-400 break-all leading-relaxed">
              {org.id}
            </code>
            <button
              type="button"
              onClick={handleCopyId}
              title="Copy organization ID"
              className="btn btn-secondary p-1.5 shrink-0"
            >
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
