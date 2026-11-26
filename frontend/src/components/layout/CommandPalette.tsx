import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCan } from '../../hooks/useCan';
import { NAV_GROUPS } from '../../lib/nav';

/** "Cmd K" on Apple devices, "Ctrl K" elsewhere. */
const SHORTCUT =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) ? 'Cmd K' : 'Ctrl K';

/** Search box in the page header; Ctrl/Cmd+K focuses it. Jumps to a page. */
export function PageSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const can = useCan();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title })))
      .filter((i) => can(i.permission))
      .filter((i) => !needle || i.label.toLowerCase().includes(needle) || i.group.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [q, can]);

  const go = (to: string) => {
    setOpen(false);
    setQ('');
    inputRef.current?.blur();
    navigate(to);
  };

  return (
    <div className="relative hidden md:block">
      <label className="flex h-9 w-[220px] items-center gap-2 rounded-lg border border-vmd-border bg-white px-3 text-sm text-vmd-textSubtle focus-within:border-neutral-900">
        <Search size={16} aria-hidden="true" />
        <input
          ref={inputRef}
          aria-label="Search pages"
          placeholder="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) go(results[0].to);
            if (e.key === 'Escape') inputRef.current?.blur();
          }}
          className="min-w-0 flex-1 bg-transparent text-vmd-text outline-none placeholder:text-vmd-textSubtle"
        />
        <kbd className="rounded border border-vmd-border px-1.5 text-[11px] text-vmd-textSubtle">{SHORTCUT}</kbd>
      </label>
      {open && results.length > 0 && (
        <ul role="listbox" className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-xl border border-vmd-border bg-white py-1">
          {results.map((r) => (
            <li key={r.to}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => go(r.to)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-vmd-text hover:bg-neutral-50">
                <r.icon size={16} className="text-vmd-textSubtle" />
                <span className="flex-1">{r.label}</span>
                <span className="text-xs text-vmd-textSubtle">{r.group}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
