import type { LucideIcon } from 'lucide-react';

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-xl border border-vmd-border bg-white p-4">
      <div className="flex items-center justify-between text-[13px] text-vmd-textSubtle">
        <span>{label}</span>
        {Icon && <Icon size={16} aria-hidden="true" />}
      </div>
      <div className="mt-2 text-[28px] font-semibold leading-8 tracking-tight text-vmd-textStrong">{value}</div>
      {hint && <div className="mt-1 text-xs text-vmd-textSubtle">{hint}</div>}
    </div>
  );
}
