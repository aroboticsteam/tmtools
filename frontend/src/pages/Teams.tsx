import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, Users2 } from 'lucide-react';
import { useTeamChecklist, useTeams, useUpdateTeam } from '../api/teams';
import { usePermission } from '../hooks/usePermission';
import { useUiStore } from '../stores/ui';
import { parsePitCsv } from '../lib/csv';
import { INSPECTION_LABELS } from '../lib/checklist';
import { useDebounce } from '../hooks/useDebounce';
import { PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge, type Tone } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { DataTable } from '../components/ui/DataTable';
import { FilterChips } from '../components/ui/FilterChips';
import { ProgressBar } from '../components/ui/Layouts';
import { EmptyState } from '../components/ui/EmptyState';
import type { InspectionStatus, TeamChecklistItem } from '../types/api';

type Filter = 'all' | 'open' | 'nopit' | 'uninspected';
const PAGE_SIZE = 25;
const INSPECTION_TONE: Record<InspectionStatus, Tone> = { PASSED: 'ok', IN_PROGRESS: 'warn', NOT_STARTED: 'neutral' };

function Tile({ label, value, of }: { label: string; value: number; of: number }) {
  return (
    <div className="rounded-xl border border-vmd-border bg-white p-4">
      <div className="text-[13px] text-vmd-textSubtle">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-[22px] font-semibold text-vmd-textStrong">{value}</span>
        <span className="text-xs text-vmd-textSubtle">of {of}</span>
      </div>
      <div className="mt-2"><ProgressBar value={value} max={of} tone={value === of && of > 0 ? 'ok' : 'dark'} /></div>
    </div>
  );
}

export function TeamsPage() {
  const { data: teams = [], isLoading } = useTeams();
  const { data: checklist } = useTeamChecklist();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const debounced = useDebounce(search, 200);
  const canEdit = usePermission('teams:edit');
  const updateTeam = useUpdateTeam();
  const pushToast = useUiStore((s) => s.pushToast);
  const fileRef = useRef<HTMLInputElement>(null);
  const byTeam = new Map<string, TeamChecklistItem>((checklist ?? []).map((c) => [c.team_number, c]));

  async function importPits(file: File) {
    const rows = parsePitCsv(await file.text());
    const real = new Map(teams.map((t) => [t.team_number.toUpperCase(), t.team_number]));
    const usable = rows.filter((r) => real.has(r.team.toUpperCase()));
    const results = await Promise.allSettled(
      usable.map((r) => updateTeam.mutateAsync({ number: real.get(r.team.toUpperCase())!, body: { pit_location: r.pit } })),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const skipped = rows.length - usable.length;
    const failed = results.length - ok;
    pushToast(
      `Set ${ok} pit location${ok === 1 ? '' : 's'}${skipped ? `, ${skipped} unknown team${skipped === 1 ? '' : 's'} skipped` : ''}${failed ? `, ${failed} failed` : ''}`,
      failed || ok === 0 ? 'error' : 'success',
    );
  }

  const total = teams.length;
  const complete = (checklist ?? []).filter((c) => c.complete).length;
  const withPit = teams.filter((t) => t.pit_location).length;
  const inspected = (checklist ?? []).filter((c) => c.inspection === 'PASSED').length;
  const photos = (checklist ?? []).filter((c) => c.bot_photo && c.team_photo).length;

  const needle = debounced.toLowerCase();
  const filtered = teams
    .filter((t) => t.team_number.toLowerCase().includes(needle) || (t.robot_name ?? '').toLowerCase().includes(needle))
    .filter((t) => {
      const c = byTeam.get(t.team_number);
      if (filter === 'open') return !c?.complete;
      if (filter === 'nopit') return !t.pit_location;
      if (filter === 'uninspected') return c?.inspection !== 'PASSED';
      return true;
    });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const rows = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  return (
    <div>
      <PageHeader
        title="Teams"
        subtitle="Check-in, pits and media for every team."
        action={
          canEdit && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                aria-label="Import pit locations CSV"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void importPits(f);
                }}
              />
              <Button onClick={() => fileRef.current?.click()}>
                <Upload size={16} /> Import CSV
              </Button>
            </>
          )
        }
      />
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
          <Tile label="Checklist done" value={complete} of={total} />
          <Tile label="Pit assigned" value={withPit} of={total} />
          <Tile label="Inspection passed" value={inspected} of={total} />
          <Tile label="Photos taken" value={photos} of={total} />
        </div>

        <section className="overflow-hidden rounded-xl border border-vmd-border bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-vmd-border p-3">
            <Input
              aria-label="Search teams"
              placeholder="Search number or name"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="max-w-xs flex-1 basis-56"
            />
            <FilterChips
              value={filter}
              onChange={(f) => { setFilter(f); setPage(0); }}
              options={[
                { id: 'all', label: `All ${total}` },
                { id: 'open', label: 'Checklist open' },
                { id: 'nopit', label: 'No pit' },
                { id: 'uninspected', label: 'Not inspected' },
              ]}
            />
          </div>
          {isLoading ? (
            <p className="px-4 py-6 text-sm text-vmd-textSubtle">Loading…</p>
          ) : (
            <DataTable
              minWidth={700}
              rows={rows}
              rowKey={(t) => t.team_number}
              empty={<EmptyState icon={Users2} title="No teams found">Teams fill in once matches are assigned.</EmptyState>}
              columns={[
                { key: 'team', header: 'Team', width: '90px', render: (t) => <Link to={`/teams/${t.team_number}`} className="font-semibold text-vmd-textStrong hover:underline">{t.team_number}</Link> },
                { key: 'name', header: 'Robot name', width: '2fr', render: (t) => <span className="font-medium text-vmd-textStrong">{t.robot_name ?? '—'}</span> },
                { key: 'pit', header: 'Pit', width: '90px', render: (t) => <span className="text-vmd-textMuted">{t.pit_location ?? 'None'}</span> },
                {
                  key: 'list',
                  header: 'Checklist',
                  width: '1.4fr',
                  render: (t) => {
                    const c = byTeam.get(t.team_number);
                    if (!c) return <span className="text-vmd-textSubtle">—</span>;
                    return (
                      <span className="flex items-center gap-2" aria-label={`Checklist for ${t.team_number}`}>
                        <span className="flex-1"><ProgressBar value={c.done} max={c.total} tone={c.complete ? 'ok' : 'dark'} /></span>
                        <span className="w-8 text-xs text-vmd-textSubtle">{c.done}/{c.total}</span>
                      </span>
                    );
                  },
                },
                {
                  key: 'status',
                  header: 'Inspection',
                  width: '120px',
                  render: (t) => {
                    const c = byTeam.get(t.team_number);
                    return c ? <Badge tone={INSPECTION_TONE[c.inspection]}>{INSPECTION_LABELS[c.inspection]}</Badge> : null;
                  },
                },
              ]}
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-vmd-border px-4 py-3 text-[13px] text-vmd-textSubtle">
            <span>
              {filtered.length === 0 ? 'No teams' : `Showing ${current * PAGE_SIZE + 1}–${current * PAGE_SIZE + rows.length} of ${filtered.length} teams`}
            </span>
            <span className="flex gap-2">
              <Button size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</Button>
              <Button size="sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</Button>
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
