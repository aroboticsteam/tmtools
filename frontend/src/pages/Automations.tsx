import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FolderPlus, Pencil, Play, Plus, Search, Trash2, Workflow } from 'lucide-react';
import {
  useAutomationFolders,
  useAutomations,
  useCreateAutomationFolder,
  useDeleteAutomation,
  useDeleteAutomationFolder,
  useTriggerAutomation,
  useUpdateAutomation,
  useUpdateAutomationFolder,
} from '../api/automations';
import { usePermission } from '../hooks/usePermission';
import { useUiStore } from '../stores/ui';
import { useWsStore } from '../stores/ws';
import { timeAgo } from '../lib/alerts';
import { thenSummary, whenSummary } from '../lib/automationSummary';
import { PageHeader, Section } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Toggle } from '../components/ui/Toggle';
import { EmptyState } from '../components/ui/EmptyState';
import type { Automation, AutomationFolder } from '../types/api';

export function AutomationsPage() {
  const navigate = useNavigate();
  const { data: folders = [] } = useAutomationFolders();
  const { data: automations = [], isLoading } = useAutomations();
  const createFolder = useCreateAutomationFolder();
  const updateFolder = useUpdateAutomationFolder();
  const deleteFolder = useDeleteAutomationFolder();
  const deleteAutomation = useDeleteAutomation();
  const updateAutomation = useUpdateAutomation();
  const triggerAutomation = useTriggerAutomation();
  const lastRun = useWsStore((s) => s.automationLastRun);
  const canEdit = usePermission('automations:edit');
  const canTrigger = usePermission('automations:trigger');
  const pushToast = useUiStore((s) => s.pushToast);

  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const counts = useMemo(() => {
    const m = new Map<string | null, number>();
    automations.forEach((a) => m.set(a.folder_id, (m.get(a.folder_id) ?? 0) + 1));
    return m;
  }, [automations]);

  const needle = query.trim().toLowerCase();
  const filtered = automations
    .filter((a) => selectedFolder === null || a.folder_id === selectedFolder)
    .filter((a) => !needle || a.alias.toLowerCase().includes(needle));
  const folderName = folders.find((f) => f.id === selectedFolder)?.name ?? 'All automations';

  function renameFolder(folder: AutomationFolder) {
    const name = window.prompt('Rename folder', folder.name);
    if (!name || name === folder.name) return;
    updateFolder.mutate({ id: folder.id, body: { name } }, {
      onSuccess: () => pushToast('Folder renamed', 'success'),
      onError: (err) => pushToast(err instanceof Error ? err.message : 'Failed to rename folder', 'error'),
    });
  }

  function removeFolder(folder: AutomationFolder) {
    if (!window.confirm(`Delete folder "${folder.name}"? Automations inside it are not deleted, but become unfiled.`)) return;
    deleteFolder.mutate(folder.id, {
      onSuccess: () => {
        pushToast('Folder deleted', 'success');
        if (selectedFolder === folder.id) setSelectedFolder(null);
      },
      onError: (err) => pushToast(err instanceof Error ? err.message : 'Failed to delete folder', 'error'),
    });
  }

  function remove(a: Automation) {
    if (!window.confirm(`Delete automation "${a.alias}"?`)) return;
    deleteAutomation.mutate(a.id);
  }

  function result(a: Automation): { label: string; tone: 'ok' | 'danger' | 'neutral'; when: string } {
    const live = lastRun[a.id];
    const status = live?.status;
    const when = live ? timeAgo(live.triggered_at) : a.last_triggered_at ? timeAgo(new Date(a.last_triggered_at).getTime() / 1000) : 'Never';
    if (!a.enabled) return { label: 'Disabled', tone: 'neutral', when };
    if (status) return { label: status === 'success' ? 'Done' : 'Failed', tone: status === 'success' ? 'ok' : 'danger', when };
    return { label: a.last_triggered_at ? 'Done' : 'Not run', tone: a.last_triggered_at ? 'ok' : 'neutral', when };
  }

  const railItem = (active: boolean) =>
    `flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${active ? 'bg-neutral-100 font-medium text-vmd-textStrong' : 'text-neutral-600 hover:bg-neutral-50'}`;

  return (
    <div>
      <PageHeader
        title="Automations"
        subtitle="When something happens at the event, do something."
        action={
          <>
            <Link to="/scripts"><Button>Scripts</Button></Link>
            {canEdit && (
              <Link to="/automations/new">
                <Button variant="primary"><Plus size={16} /> New automation</Button>
              </Link>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <aside className="shrink-0 rounded-xl border border-vmd-border bg-white p-2 lg:w-[220px]">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            <li className="flex shrink-0 lg:shrink">
              <button type="button" onClick={() => setSelectedFolder(null)} className={railItem(selectedFolder === null)}>
                <span className="flex-1 whitespace-nowrap">All automations</span>
                <span className="text-xs text-vmd-textSubtle">{automations.length}</span>
              </button>
            </li>
            {folders.map((f) => (
              <li key={f.id} className="group flex shrink-0 items-center lg:shrink">
                <button type="button" onClick={() => setSelectedFolder(f.id)} className={railItem(selectedFolder === f.id)}>
                  <span className="flex-1 whitespace-nowrap">{f.name}</span>
                  <span className="text-xs text-vmd-textSubtle">{counts.get(f.id) ?? 0}</span>
                </button>
                {canEdit && (
                  <span className="hidden items-center lg:flex lg:opacity-0 lg:group-hover:opacity-100">
                    <button type="button" onClick={() => renameFolder(f)} title="Rename folder" className="flex h-7 w-7 items-center justify-center rounded text-vmd-textSubtle hover:text-vmd-textStrong"><Pencil size={12} /></button>
                    <button type="button" onClick={() => removeFolder(f)} title="Delete folder" className="flex h-7 w-7 items-center justify-center rounded text-vmd-textSubtle hover:text-vmd-danger"><Trash2 size={12} /></button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                const name = window.prompt('Folder name');
                if (name) createFolder.mutate({ name });
              }}
              className="mt-1 flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] text-vmd-textSubtle hover:bg-neutral-50 hover:text-vmd-textStrong"
            >
              <FolderPlus size={14} /> New folder
            </button>
          )}
        </aside>

        <Section
          className="min-w-0 flex-1"
          title={folderName}
          action={
            <label className="flex h-8 w-full items-center gap-2 rounded-lg border border-vmd-border px-2.5 text-[13px] text-vmd-textSubtle focus-within:border-neutral-900 sm:w-[220px]">
              <Search size={14} aria-hidden="true" />
              <input aria-label="Search automations" placeholder="Search automations" value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent text-vmd-text outline-none placeholder:text-vmd-textSubtle" />
            </label>
          }
        >
          {isLoading && <p className="px-4 py-6 text-sm text-vmd-textSubtle">Loading…</p>}
          {!isLoading && filtered.length === 0 && (
            <EmptyState icon={Workflow} title="No automations here yet">Create one to react to match events.</EmptyState>
          )}
          {filtered.map((a) => {
            const r = result(a);
            return (
              <div key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-neutral-100 px-4 py-3 last:border-b-0">
                <Toggle checked={a.enabled} disabled={!canEdit} label={`Enable ${a.alias}`} onChange={(enabled) => updateAutomation.mutate({ id: a.id, body: { enabled } })} />
                <div className="min-w-0 flex-1 basis-60">
                  <Link to={`/automations/${a.id}`} className="block truncate font-medium text-vmd-textStrong hover:underline">{a.alias}</Link>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                    <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-vmd-textMuted">When {whenSummary(a.trigger_yaml)}</span>
                    <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-vmd-textMuted">Then {thenSummary(a.action_yaml)}</span>
                  </div>
                </div>
                <div className="w-24 text-xs text-vmd-textSubtle">{r.when}</div>
                <Badge tone={r.tone}>{r.label}</Badge>
                <div className="flex items-center gap-1">
                  {canTrigger && (
                    <button
                      type="button"
                      aria-label={`Run ${a.alias} now`}
                      title="Run now"
                      onClick={() =>
                        triggerAutomation.mutate(a.id, {
                          onSuccess: (res) => pushToast(`Test run: ${res.status}`, res.status === 'success' ? 'success' : 'error'),
                          onError: (err) => pushToast(err instanceof Error ? err.message : 'Run failed', 'error'),
                        })
                      }
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-vmd-border bg-white text-neutral-700 hover:bg-neutral-50"
                    >
                      <Play size={14} />
                    </button>
                  )}
                  <button type="button" aria-label={`Edit ${a.alias}`} title="Edit" onClick={() => navigate(`/automations/${a.id}`)} className="flex h-8 w-8 items-center justify-center rounded-lg text-vmd-textSubtle hover:bg-neutral-100 hover:text-vmd-textStrong">
                    <Pencil size={14} />
                  </button>
                  {canEdit && (
                    <button type="button" aria-label={`Delete ${a.alias}`} title="Delete" onClick={() => remove(a)} className="flex h-8 w-8 items-center justify-center rounded-lg text-vmd-textSubtle hover:bg-red-50 hover:text-vmd-danger">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </Section>
      </div>
    </div>
  );
}
