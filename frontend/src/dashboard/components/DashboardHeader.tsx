import { Cpu, LogOut, PanelLeft, Settings } from 'lucide-react';
import type { AuthOrg } from '../../api';
import { OrgInfoBadge } from './OrgInfoBadge';

export interface DashboardHeaderProps {
  appView: 'settings' | 'dashboard';
  currentOrg: AuthOrg | null;
  availableOrgs: AuthOrg[];
  switchingOrg: boolean;
  selectedDeviceId: string;
  status: string;
  onSwitchOrg: (orgId: string) => void;
  onOpenSidebar: () => void;
  onToggleSettings: () => void;
  onLogout: () => void;
}

export function DashboardHeader({
  appView,
  currentOrg,
  availableOrgs,
  switchingOrg,
  selectedDeviceId,
  status,
  onSwitchOrg,
  onOpenSidebar,
  onToggleSettings,
  onLogout,
}: DashboardHeaderProps) {
  return (
    <header className="glass-panel p-4 sm:p-5 px-4 sm:px-6 flex flex-wrap justify-between items-center gap-4 mb-6">
      <div className="flex items-center gap-3 min-w-0">
        {appView === 'dashboard' && (
          <button
            type="button"
            onClick={onOpenSidebar}
            className="btn btn-secondary p-2 rounded-lg lg:hidden shrink-0"
            aria-label="Open devices and cameras panel"
          >
            <PanelLeft size={20} />
          </button>
        )}
        <div className="bg-primary p-2.5 rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(124,58,237,0.2)] shrink-0">
          <Cpu size={24} color="white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-gradient-purple text-[1.25rem] sm:text-[1.6rem] font-extrabold truncate">AURA WATCH AI</h1>
          <p className="text-[0.75rem] sm:text-[0.8rem] text-text-muted hidden sm:block">Smart surveillance — see everything, ask anything</p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4 flex-wrap justify-end">
        {currentOrg && (
          <OrgInfoBadge
            org={currentOrg}
            availableOrgs={availableOrgs}
            switchingOrg={switchingOrg}
            onSwitchOrg={onSwitchOrg}
          />
        )}
        {selectedDeviceId && appView === 'dashboard' && (
          <div className={`status-indicator ${status.toLowerCase().replace(' ', '')}`}>
            <span className="w-2 h-2 rounded-full bg-current inline-block" />
            {status}
          </div>
        )}
        {currentOrg && (
          <button
            type="button"
            onClick={onToggleSettings}
            className={`btn py-1.5 px-3 text-[0.8rem] rounded-md flex items-center gap-1.5 ${
              appView === 'settings' ? 'btn-primary' : 'btn-secondary'
            }`}
          >
            <Settings size={14} /> Org settings
          </button>
        )}
        <button
          type="button"
          onClick={onLogout}
          className="btn btn-secondary py-1.5 px-3 text-[0.8rem] rounded-md flex items-center gap-1.5"
        >
          <LogOut size={14} /> Logout
        </button>
      </div>
    </header>
  );
}
