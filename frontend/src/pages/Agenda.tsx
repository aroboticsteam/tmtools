import { useState } from 'react';
import { GripVertical, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useAgenda, useDeleteAgendaItem, useImportAgenda, useReorderAgenda, useSaveAgendaItem } from '../api/agenda';
import { usePermission } from '../hooks/usePermission';
import { useUiStore } from '../stores/ui';
import { Button } from '../components/ui/Button';
import { Card, PageHeader } from '../components/ui/Card';
import { Input, Label } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Toggle } from '../components/ui/Toggle';
import { moveItem } from '../lib/actionBuilder';
import type { AgendaItem } from '../types/api';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function errorToast(push: (m: string, k: 'error') => void) {
  return (err: unknown) => push(err instanceof Error ? err.message : 'Request failed', 'error');
}

/** The run of show: day and finals agendas shown on the public site and announced to the rooms. */
export function AgendaPage() {
  const canView = usePermission('comms:read');
  const canManage = usePermission('comms:manage');
  return (
    <div>
      <PageHeader title="Agenda" subtitle="Day and finals run of show, shown on the public site and announced to the rooms." />
      {canView ? <AgendaEditor canManage={canManage} /> : <p className="text-sm text-vmd-textSubtle">You do not have access to the agenda.</p>}
    </div>
  );
}

function AgendaEditor({ canManage }: { canManage: boolean }) {
  const { data: items = [] } = useAgenda();
  const save = useSaveAgendaItem();
  const del = useDeleteAgendaItem();
  const reorder = useReorderAgenda();
  const pushToast = useUiStore((s) => s.pushToast);
  const [scope, setScope] = useState<'day' | 'finals'>('day');
  const [editing, setEditing] = useState<AgendaItem | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const shown = items.filter((i) => i.scope === scope);

  function drop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const ids = shown.map((i) => i.id);
    reorder.mutate({ scope, ids: moveItem(ids, ids.indexOf(dragId), ids.indexOf(targetId)) }, { onError: errorToast(pushToast) });
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-1.5">
          {(['day', 'finals'] as const).map((s) => (
            <Button key={s} variant={scope === s ? 'primary' : 'secondary'} onClick={() => setScope(s)}>
              {s === 'day' ? 'Day agenda' : 'Finals agenda'}
            </Button>
          ))}
        </div>
        {canManage && (
          <div className="flex gap-1.5">
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <Upload size={14} /> Import
            </Button>
            <Button variant="secondary" onClick={() => setEditing('new')}>
              <Plus size={14} /> Add item
            </Button>
          </div>
        )}
      </div>
      {shown.length === 0 && <p className="text-sm text-vmd-textSubtle">No items.</p>}
      {canManage && shown.length > 1 && <p className="mb-1 text-xs text-vmd-textSubtle">Drag rows to reorder.</p>}
      {shown.map((i) => (
        <div
          key={i.id}
          data-testid="agenda-row"
          draggable={canManage}
          onDragStart={() => setDragId(i.id)}
          onDragOver={(e) => canManage && e.preventDefault()}
          onDrop={() => {
            drop(i.id);
            setDragId(null);
          }}
          className="flex items-center justify-between gap-2 border-b border-vmd-border py-2 last:border-0"
        >
          <div className="flex items-center gap-2">
            {canManage && <GripVertical size={14} className="cursor-grab text-vmd-textSubtle" aria-hidden />}
            <div>
              <p className="text-sm text-vmd-textStrong"><span className="mr-3 tabular-nums text-vmd-textMuted">{i.start_time}{i.end_time ? `–${i.end_time}` : ''}</span>{i.title}</p>
              {i.details && <p className="text-xs text-vmd-textSubtle">{i.details}</p>}
            </div>
          </div>
          {canManage && (
            <div className="flex gap-1">
              <Button variant="ghost" onClick={() => setEditing(i)} title="Edit"><Pencil size={14} /></Button>
              <Button variant="ghost" title="Delete" onClick={() => del.mutate(i.id, { onError: errorToast(pushToast) })}><Trash2 size={14} /></Button>
            </div>
          )}
        </div>
      ))}
      <AgendaModal key={editing === null ? 'closed' : editing === 'new' ? `new-${scope}` : editing.id} editing={editing} scope={scope} onClose={() => setEditing(null)} save={save} />
      <AgendaImportModal key={importing ? `import-${scope}` : 'import-closed'} open={importing} scope={scope} onClose={() => setImporting(false)} />
    </Card>
  );
}

const IMPORT_HINT = `# one item per line: HH:MM[-HH:MM] Title [| details]
09:00 Doors open | Teams check in at registration
10:30-11:00 Opening ceremony
12:00-13:00 Lunch`;

/** Paste a run of show; check it (dry run) before adding. All-or-nothing:
 * any bad line is reported by number and nothing is written. */
function AgendaImportModal({ open, scope, onClose }: { open: boolean; scope: 'day' | 'finals'; onClose: () => void }) {
  const run = useImportAgenda();
  const pushToast = useUiStore((s) => s.pushToast);
  const [text, setText] = useState('');
  const [replace, setReplace] = useState(false);
  const [problems, setProblems] = useState<{ line: number; error: string }[]>([]);
  const [preview, setPreview] = useState<number | null>(null);

  function submit(dryRun: boolean) {
    run.mutate(
      { scope, text, replace, dry_run: dryRun },
      {
        onSuccess: (result) => {
          setProblems(result.errors);
          if (result.errors.length) return setPreview(null);
          if (dryRun) return setPreview(result.items.length);
          pushToast(`Imported ${result.created} item${result.created === 1 ? '' : 's'}`, 'success');
          onClose();
        },
        onError: errorToast(pushToast),
      },
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={`Import ${scope === 'day' ? 'day' : 'finals'} agenda`}>
      <div className="space-y-3">
        <textarea
          className="vmd-code-block h-48 w-full rounded-lg border border-vmd-border bg-vmd-elevated p-2 font-mono text-xs"
          placeholder={IMPORT_HINT}
          aria-label="Agenda text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
            setProblems([]);
          }}
          spellCheck={false}
        />
        <label className="flex items-center gap-2 text-sm text-vmd-textMuted">
          <Toggle checked={replace} onChange={setReplace} /> Replace the existing {scope} agenda
        </label>
        {problems.length > 0 && (
          <ul className="text-xs text-vmd-danger" data-testid="import-errors">
            {problems.map((p) => (
              <li key={`${p.line}-${p.error}`}>Line {p.line}: {p.error}</li>
            ))}
          </ul>
        )}
        {preview !== null && <p className="text-xs text-vmd-success" data-testid="import-preview">{preview} item{preview === 1 ? '' : 's'} look good.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" disabled={!text.trim() || run.isPending} onClick={() => submit(true)}>Check</Button>
          <Button variant="primary" disabled={!text.trim() || run.isPending} onClick={() => submit(false)}>Import</Button>
        </div>
      </div>
    </Modal>
  );
}

function AgendaModal({
  editing,
  scope,
  onClose,
  save,
}: {
  editing: AgendaItem | 'new' | null;
  scope: 'day' | 'finals';
  onClose: () => void;
  save: ReturnType<typeof useSaveAgendaItem>;
}) {
  const existing = editing && editing !== 'new' ? editing : null;
  const pushToast = useUiStore((s) => s.pushToast);
  const [start, setStart] = useState(existing?.start_time ?? '');
  const [end, setEnd] = useState(existing?.end_time ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [details, setDetails] = useState(existing?.details ?? '');
  const [announce, setAnnounce] = useState(existing?.announce_lead_minutes == null ? '' : String(existing.announce_lead_minutes));
  const announceNum = announce.trim() === '' ? null : Number(announce);
  const announceOk = announceNum === null || (Number.isInteger(announceNum) && announceNum >= 0 && announceNum <= 240);
  const valid = announceOk && TIME_PATTERN.test(start) && (!end || TIME_PATTERN.test(end)) && !!title.trim();
  return (
    <Modal open={editing !== null} onClose={onClose} title={existing ? 'Edit agenda item' : `New ${scope} agenda item`}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Label>Start (HH:MM)</Label><Input placeholder="09:15" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div><Label>End (optional)</Label><Input placeholder="09:45" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        <div><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div><Label>Details (optional)</Label><Input value={details} onChange={(e) => setDetails(e.target.value)} /></div>
        <div>
          <Label>Announce to rooms N minutes before (blank = default, 0 = never)</Label>
          <Input type="number" min={0} max={240} value={announce} onChange={(e) => setAnnounce(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!valid || save.isPending}
            onClick={() =>
              save.mutate(
                { id: existing?.id, body: { scope: existing?.scope ?? scope, start_time: start, end_time: end || null, title: title.trim(), details: details.trim() || null, announce_lead_minutes: announceNum } },
                { onSuccess: onClose, onError: errorToast(pushToast) },
              )
            }
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
