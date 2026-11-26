import { useState } from 'react';
import { RefreshCw, ScrollText } from 'lucide-react';
import { useAuditLog } from '../api/audit';
import { PageHeader } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Badge, type Tone } from '../components/ui/Badge';
import { DataTable } from '../components/ui/DataTable';
import { FilterChips } from '../components/ui/FilterChips';
import { EmptyState } from '../components/ui/EmptyState';
import type { AuditLogFilters } from '../types/api';

const PAGE_SIZE = 50;
const ACTIONS = ['', 'create', 'update', 'delete', 'trigger', 'service_call'] as const;
const ACTION_TONE: Record<string, Tone> = { create: 'ok', update: 'neutral', delete: 'danger', trigger: 'warn', service_call: 'neutral' };

/** Create/update/delete operations across the system (REST-owned, see `useAuditLog`). */
export function AuditLogPage() {
  const [filters, setFilters] = useState<AuditLogFilters>({ limit: PAGE_SIZE, offset: 0 });
  const { data: entries = [], isLoading, isError, refetch, isFetching } = useAuditLog(filters);
  const offset = filters.offset ?? 0;

  function updateFilter<K extends keyof AuditLogFilters>(key: K, value: AuditLogFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value || undefined, offset: 0 }));
  }

  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle="Who changed what, across the whole system."
        action={
          <Button onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} /> Refresh
          </Button>
        }
      />
      <section className="overflow-hidden rounded-xl border border-vmd-border bg-white">
        <div className="flex flex-col gap-3 border-b border-vmd-border p-3">
          <FilterChips
            value={(filters.action ?? '') as (typeof ACTIONS)[number]}
            onChange={(a) => updateFilter('action', a)}
            options={ACTIONS.map((a) => ({ id: a, label: a === '' ? 'All actions' : a.replace('_', ' ') }))}
          />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2">
            <Input aria-label="User" placeholder="User id" value={filters.user ?? ''} onChange={(e) => updateFilter('user', e.target.value)} />
            <Input aria-label="Resource type" placeholder="Resource type, e.g. integration" value={filters.resource_type ?? ''} onChange={(e) => updateFilter('resource_type', e.target.value)} />
            <Input aria-label="From" type="datetime-local" value={filters.start_date ?? ''} onChange={(e) => updateFilter('start_date', e.target.value)} />
            <Input aria-label="To" type="datetime-local" value={filters.end_date ?? ''} onChange={(e) => updateFilter('end_date', e.target.value)} />
          </div>
        </div>
        {isLoading ? (
          <p className="px-4 py-6 text-sm text-vmd-textSubtle">Loading…</p>
        ) : isError ? (
          <p className="px-4 py-6 text-sm text-vmd-danger">Failed to load audit log.</p>
        ) : (
          <DataTable
            minWidth={760}
            rows={entries}
            rowKey={(e) => e.id}
            empty={<EmptyState icon={ScrollText} title="No entries match these filters" />}
            columns={[
              { key: 'time', header: 'Time', width: '170px', render: (e) => <span className="whitespace-nowrap text-[13px] text-vmd-textMuted">{new Date(e.created_at).toLocaleString()}</span> },
              { key: 'user', header: 'User', width: '1fr', render: (e) => <span className="truncate">{e.user_id ?? '—'}</span> },
              { key: 'action', header: 'Action', width: '110px', render: (e) => <Badge tone={ACTION_TONE[e.action] ?? 'neutral'}>{e.action}</Badge> },
              { key: 'res', header: 'Resource', width: '1.3fr', render: (e) => <span className="text-[13px]">{e.resource_type ?? '—'} / {e.resource_id ?? '—'}</span> },
              { key: 'chg', header: 'Changes', width: '2fr', render: (e) => e.changes ? <code className="block truncate text-xs text-vmd-textMuted" title={JSON.stringify(e.changes)}>{JSON.stringify(e.changes)}</code> : <span className="text-vmd-textSubtle">—</span> },
            ]}
          />
        )}
        <div className="flex items-center justify-between border-t border-vmd-border px-4 py-3 text-[13px] text-vmd-textSubtle">
          <span>{entries.length ? `Showing ${offset + 1}–${offset + entries.length}` : 'No entries'}</span>
          <span className="flex gap-2">
            <Button size="sm" disabled={offset === 0} onClick={() => setFilters((p) => ({ ...p, offset: Math.max(0, (p.offset ?? 0) - PAGE_SIZE) }))}>Previous</Button>
            <Button size="sm" disabled={entries.length < PAGE_SIZE} onClick={() => setFilters((p) => ({ ...p, offset: (p.offset ?? 0) + PAGE_SIZE }))}>Next</Button>
          </span>
        </div>
      </section>
    </div>
  );
}
