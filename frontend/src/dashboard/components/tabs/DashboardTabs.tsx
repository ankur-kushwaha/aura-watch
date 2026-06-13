import { Fingerprint, Video } from 'lucide-react';

export interface DashboardTabsProps {
  activeTab: 'events' | 'reid';
  hasOnlineDevices: boolean;
  onSelectEvents: () => void;
  onSelectReid: () => void;
}

export function DashboardTabs({
  activeTab,
  hasOnlineDevices,
  onSelectEvents,
  onSelectReid,
}: DashboardTabsProps) {
  if (!hasOnlineDevices) return null;

  return (
      <div className="flex gap-2 sm:gap-3 mb-6 bg-[rgba(255,255,255,0.02)] p-1.5 rounded-xl border border-border-glass w-full lg:w-fit overflow-x-auto">
        {hasOnlineDevices && (
          <button
            onClick={() => onSelectEvents()}
            className={`py-2 px-3 sm:px-4 rounded-lg text-[0.8rem] sm:text-[0.85rem] font-semibold flex items-center gap-2 transition-all duration-200 border-none outline-none whitespace-nowrap shrink-0 ${activeTab === 'events'
              ? 'bg-primary text-white shadow-[0_4px_12px_rgba(124,58,237,0.25)]'
              : 'text-text-secondary hover:text-text-primary bg-transparent'
              }`}
          >
            <Video size={16} /> Event Archive
          </button>
        )}
        
        {hasOnlineDevices && (
          <button
            onClick={() => onSelectReid()}
            className={`py-2 px-3 sm:px-4 rounded-lg text-[0.8rem] sm:text-[0.85rem] font-semibold flex items-center gap-2 transition-all duration-200 border-none outline-none whitespace-nowrap shrink-0 ${activeTab === 'reid'
              ? 'bg-primary text-white shadow-[0_4px_12px_rgba(124,58,237,0.25)]'
              : 'text-text-secondary hover:text-text-primary bg-transparent'
              }`}
          >
            <Fingerprint size={16} /> Cross-Camera ReID Tracker
          </button>
        )}
      </div>
  );
}
