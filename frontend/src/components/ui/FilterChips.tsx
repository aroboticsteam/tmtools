/** Pill filters: the active one is solid black. */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
          className={`h-8 rounded-full border px-3 text-[13px] font-medium transition-colors ${
            o.id === value ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-vmd-border bg-white text-neutral-700 hover:bg-neutral-50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
