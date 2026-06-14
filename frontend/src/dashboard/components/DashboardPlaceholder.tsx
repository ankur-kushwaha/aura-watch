import { Camera, Cpu, RefreshCw } from 'lucide-react';

export function DashboardPlaceholder({ reason }: { reason: 'loading' | 'offline' | 'no-devices' }) {
  return (
    <div className="glass-panel p-4 sm:p-5 flex flex-col">
      <div className="flex-1 flex flex-col justify-center items-center text-center text-text-muted p-8">
        {reason === 'loading' ? (
          <>
            <RefreshCw size={36} className="animate-spin mb-4 text-primary" />
            <p className="text-[0.95rem] font-semibold text-text-primary">Loading dashboard…</p>
            <p className="text-[0.8rem] mt-2 max-w-[320px]">Fetching devices, camera streams, and recordings.</p>
          </>
        ) : reason === 'no-devices' ? (
          <>
            <Cpu size={40} className="mb-4 opacity-50" />
            <p className="text-[0.95rem] font-semibold text-text-primary">No edge devices registered</p>
            <p className="text-[0.8rem] mt-2 max-w-[320px]">
              Run the edge agent install script on a device to register it with your organization.
            </p>
          </>
        ) : (
          <>
            <Camera size={40} className="mb-4 opacity-50" />
            <p className="text-[0.95rem] font-semibold text-text-primary">All cameras offline</p>
            <p className="text-[0.8rem] mt-2 max-w-[320px]">
              Start the edge agent to connect. Event archive and ReID views require at least one online device.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
