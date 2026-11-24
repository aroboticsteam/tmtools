import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTeamChecklist, useTeams, useUpdateTeam } from '../api/teams';
import { usePermission } from '../hooks/usePermission';
import { useUiStore } from '../stores/ui';
import { parsePitCsv } from '../lib/csv';
import { Button } from '../components/ui/Button';
import { ChecklistMark } from '../components/teams/ChecklistCard';
import { INSPECTION_LABELS } from '../lib/checklist';
import { useDebounce } from '../hooks/useDebounce';
import { PageHeader, Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';

export function TeamsPage() {
  const { data: teams, isLoading } = useTeams();
  const { data: checklist } = useTeamChecklist();
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const byTeam = new Map((checklist ?? []).map((c) => [c.team_number, c]));
  const completeCount = (checklist ?? []).filter((c) => c.complete).length;
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 200);
  const canEdit = usePermission('teams:edit');
  const updateTeam = useUpdateTeam();
  const pushToast = useUiStore((s) => s.pushToast);
  const fileRef = useRef<HTMLInputElement>(null);

  async function importPits(file: File) {
    const rows = parsePitCsv(await file.text());
    const known = new Set((teams ?? []).map((t) => t.team_number.toUpperCase()));
    const usable = rows.filter((r) => known.has(r.team.toUpperCase()));
    const real = new Map((teams ?? []).map((t) => [t.team_number.toUpperCase(), t.team_number]));
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

  // Plan §12 "Search/filter by team number, name, division" (AUDIT_FINDINGS.md
  // 3.6). `TeamProfile` (frontend/src/types/api.ts, backend/schemas/team.py)
  // has no `division`/`division_id` field at all — the teams list endpoint
  // doesn't return one — so division filtering isn't implementable without a
  // backend change; this is a backend gap, not something to fake here.
  // `robot_name` is present, so it's included alongside `team_number`.
  const needle = debouncedSearch.toLowerCase();
  const filtered = (teams ?? []).filter(
    (t) =>
      t.team_number.toLowerCase().includes(needle) ||
      (t.robot_name ?? '').toLowerCase().includes(needle),
  ).filter((t) => !incompleteOnly || !byTeam.get(t.team_number)?.complete);

  return (
    <div>
      <PageHeader
        title="Teams"
        subtitle="Profiles fill in from Tournament Manager"
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
                <Upload size={16} /> Import pits (CSV)
              </Button>
            </>
          )
        }
      />
      <Input
        placeholder="Search by team number or robot name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-2 max-w-xs"
      />
      {checklist && (
        <div className="mb-4 flex items-center gap-4 text-sm text-vmd-textMuted">
          <span>
            Checklist complete: {completeCount}/{checklist.length} teams
          </span>
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={incompleteOnly}
              onChange={(e) => setIncompleteOnly(e.target.checked)}
              aria-label="Show incomplete only"
            />
            Incomplete only
          </label>
        </div>
      )}

      {isLoading && <p className="text-sm text-vmd-textSubtle">Loading…</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((team) => (
          <Link key={team.team_number} to={`/teams/${team.team_number}`}>
            <Card className="h-full hover:border-neutral-400">
              <p className="font-medium text-vmd-textStrong">{team.team_number}</p>
              {team.robot_name && <p className="text-sm text-vmd-textMuted">{team.robot_name}</p>}
              {team.pit_location && <p className="text-xs text-vmd-textSubtle">Pit: {team.pit_location}</p>}
              {byTeam.get(team.team_number) && (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1" aria-label={`Checklist for ${team.team_number}`}>
                  <ChecklistMark
                    done={byTeam.get(team.team_number)!.inspection === 'PASSED'}
                    label={`Inspection: ${INSPECTION_LABELS[byTeam.get(team.team_number)!.inspection]}`}
                  />
                  <ChecklistMark done={byTeam.get(team.team_number)!.bot_photo} label="Robot photo" />
                  <ChecklistMark done={byTeam.get(team.team_number)!.team_photo} label="Team photo" />
                </div>
              )}
            </Card>
          </Link>
        ))}
      </div>
      {filtered.length === 0 && !isLoading && (
        <p className="text-sm text-vmd-textSubtle">No teams found yet — they auto-populate once matches are assigned.</p>
      )}
    </div>
  );
}
