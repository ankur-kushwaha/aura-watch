
interface ToggleSwitchProps {
  checked: boolean;
  onChange: (val: boolean) => void;
  label: string;
  disabled?: boolean;
  description?: string;
}

export function ToggleSwitch({ checked, onChange, label, disabled = false, description }: ToggleSwitchProps) {
  return (
    <div className={`flex flex-col gap-0.5 py-1 ${disabled ? 'opacity-40' : ''}`}>
      <div className="flex justify-between items-center">
        <span className="text-[0.78rem] font-semibold text-text-secondary">{label}</span>
        <label className={`relative inline-flex items-center select-none ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            className="sr-only peer"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          <div className="w-8 h-4 bg-white/10 rounded-full relative peer peer-checked:bg-[var(--color-secondary)] transition-colors duration-200 after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-transform after:duration-200 peer-checked:after:translate-x-4 animate-none"></div>
        </label>
      </div>
      {description && (
        <p className="text-[0.65rem] text-text-muted leading-snug pr-10">{description}</p>
      )}
    </div>
  );
}
