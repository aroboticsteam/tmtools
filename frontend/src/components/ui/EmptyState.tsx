import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {Icon && <Icon size={24} className="text-vmd-textSubtle" aria-hidden="true" />}
      <p className="text-sm font-medium text-vmd-textStrong">{title}</p>
      {children && <div className="text-sm text-vmd-textSubtle">{children}</div>}
    </div>
  );
}
