import { useState } from 'react';
import { Bell } from 'lucide-react';

export interface NotificationBellProps {
  unreadCount: number;
  onClick: () => void;
}

export function NotificationBell({ unreadCount, onClick }: NotificationBellProps) {
  const [prevCount, setPrevCount] = useState(unreadCount);
  const [animationKey, setAnimationKey] = useState(0);

  if (unreadCount !== prevCount) {
    if (unreadCount > prevCount && unreadCount > 0) {
      setAnimationKey((key) => key + 1);
    }
    setPrevCount(unreadCount);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="btn btn-secondary p-2.5 rounded-lg border-none hover:bg-white/10 transition-all duration-200 relative flex items-center justify-center"
      title="View notifications"
    >
      <Bell
        key={animationKey}
        size={18}
        className={`text-text-secondary hover:text-text-primary transition-colors ${
          animationKey > 0 ? 'animate-bell-shake text-primary' : ''
        }`}
      />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[0.65rem] font-black w-4.5 h-4.5 rounded-full flex items-center justify-center border border-[#0c0c14] shadow-[0_0_8px_rgba(239,68,68,0.5)]">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}

      {/* Bell Shake CSS Keyframes injected inline */}
      <style>{`
        @keyframes bellShake {
          0%, 100% { transform: rotate(0); }
          15% { transform: rotate(15deg); }
          30% { transform: rotate(-12deg); }
          45% { transform: rotate(10deg); }
          60% { transform: rotate(-8deg); }
          75% { transform: rotate(4deg); }
          90% { transform: rotate(-2deg); }
        }
        .animate-bell-shake {
          animation: bellShake 0.5s ease-in-out;
        }
      `}</style>
    </button>
  );
}
