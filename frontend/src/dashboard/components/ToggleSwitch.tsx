
interface ToggleSwitchProps {
  checked: boolean;
  onChange: (val: boolean) => void;
  label: string;
}

export function ToggleSwitch({ checked, onChange, label }: ToggleSwitchProps) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-[0.78rem] font-semibold text-text-secondary">{label}</span>
      <label className="relative inline-flex items-center cursor-pointer select-none">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div className="w-8 h-4 bg-white/10 rounded-full relative peer peer-checked:bg-[var(--color-secondary)] transition-colors duration-200 after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-transform after:duration-200 peer-checked:after:translate-x-4 animate-none"></div>
      </label>
    </div>
  );
}
