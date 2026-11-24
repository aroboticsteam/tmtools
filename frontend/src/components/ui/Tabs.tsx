/** Underlined tab strip. Controlled: the caller owns which tab is active. */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-vmd-border">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          onClick={() => onChange(tab.id)}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors ${
            tab.id === active
              ? 'border-neutral-900 font-medium text-vmd-textStrong'
              : 'border-transparent text-vmd-textSubtle hover:text-vmd-textStrong'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Pill switch between a few options, e.g. Field 1 / Field 2. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="group" className="inline-flex rounded-lg bg-neutral-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
          className={`h-8 rounded-md px-3.5 text-sm transition-colors ${
            o.id === value ? 'bg-white font-semibold text-vmd-textStrong shadow-sm' : 'font-medium text-vmd-textSubtle'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
