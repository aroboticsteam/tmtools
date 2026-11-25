import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Play } from 'lucide-react';
import {
  useAutomationFolders,
  useAutomationRuns,
  useAutomations,
  useCreateAutomation,
  useTriggerAutomation,
  useUpdateAutomation,
  useValidateAutomation,
} from '../api/automations';
import { usePermission } from '../hooks/usePermission';
import { useUiStore } from '../stores/ui';
import { timeAgo } from '../lib/alerts';
import { previewYaml } from '../lib/automationSummary';
import { Section } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Select } from '../components/ui/Input';
import { Toggle } from '../components/ui/Toggle';
import { Segmented } from '../components/ui/Tabs';
import { YamlEditor } from '../components/ui/YamlEditor';
import { EmptyState } from '../components/ui/EmptyState';
import { TriggerBuilder } from '../components/automations/TriggerBuilder';
import { ConditionBuilder } from '../components/automations/ConditionBuilder';
import { ActionChainBuilder } from '../components/automations/ActionChainBuilder';
import type { Automation } from '../types/api';

/** Full-page editor: numbered When / Only if / Then steps, recent runs and a YAML preview. */
export function AutomationEditorPage() {
  const { id } = useParams();
  const { data: automations, isLoading } = useAutomations();
  if (id && id !== 'new') {
    if (isLoading) return <p className="text-sm text-vmd-textSubtle">Loading…</p>;
    const found = automations?.find((a) => a.id === id);
    if (!found) return <EmptyState title="Automation not found">It may have been deleted. <Link to="/automations" className="underline">Back to automations</Link></EmptyState>;
    return <Editor key={found.id} editing={found} />;
  }
  return <Editor key="new" editing={null} />;
}

function Step({ n, title, hint, dashed, action, children }: { n: number; title: string; hint: string; dashed?: boolean; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className={`overflow-hidden rounded-xl bg-white ${dashed ? 'border border-dashed border-neutral-300' : 'border border-vmd-border'}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${dashed ? 'bg-neutral-200 text-neutral-600' : 'bg-neutral-900 text-white'}`}>{n}</span>
          <h2 className="text-[15px] font-semibold text-vmd-textStrong">{title}</h2>
          <span className="text-[13px] text-vmd-textSubtle">{hint}</span>
        </div>
        {action}
      </header>
      {children && <div className="border-t border-vmd-border p-4">{children}</div>}
    </section>
  );
}

function Editor({ editing }: { editing: Automation | null }) {
  const navigate = useNavigate();
  const canEdit = usePermission('automations:edit');
  const canTrigger = usePermission('automations:trigger');
  const { data: folders = [] } = useAutomationFolders();
  const create = useCreateAutomation();
  const update = useUpdateAutomation();
  const validate = useValidateAutomation();
  const trigger = useTriggerAutomation();
  const { data: runs = [] } = useAutomationRuns(editing?.id ?? null);
  const pushToast = useUiStore((s) => s.pushToast);

  const [mode, setMode] = useState<'builder' | 'yaml'>(editing ? 'yaml' : 'builder');
  const [alias, setAlias] = useState(editing?.alias ?? '');
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);
  const [folderId, setFolderId] = useState(editing?.folder_id ?? '');
  const [triggerYaml, setTriggerYaml] = useState(editing?.trigger_yaml ?? '');
  const [conditionYaml, setConditionYaml] = useState(editing?.condition_yaml ?? '');
  const [actionYaml, setActionYaml] = useState(editing?.action_yaml ?? '');
  const [showCondition, setShowCondition] = useState(Boolean(editing?.condition_yaml));
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[] } | null>(null);

  function handleValidate() {
    validate.mutate(
      { trigger_yaml: triggerYaml, condition_yaml: conditionYaml || null, action_yaml: actionYaml },
      { onSuccess: setValidation, onError: (err) => pushToast(err instanceof Error ? err.message : 'Validation failed', 'error') },
    );
  }

  function save() {
    if (!alias || !triggerYaml || !actionYaml) {
      pushToast('Name, trigger and action are required.', 'error');
      return;
    }
    const body = { alias, enabled, folder_id: folderId || null, trigger_yaml: triggerYaml, condition_yaml: conditionYaml || null, action_yaml: actionYaml };
    const mutation = editing ? update.mutateAsync({ id: editing.id, body }) : create.mutateAsync(body);
    mutation
      .then(() => {
        pushToast('Saved', 'success');
        navigate('/automations');
      })
      .catch((err: unknown) => pushToast(err instanceof Error ? err.message : 'Save failed', 'error'));
  }

  const folderName = folders.find((f) => f.id === folderId)?.name;
  const preview = previewYaml(alias || 'Untitled', enabled, triggerYaml, conditionYaml, actionYaml);

  return (
    <div>
      <div className="-mx-4 -mt-5 mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-vmd-border bg-white px-4 py-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:-mt-8 lg:px-8">
        <div className="flex min-w-0 flex-1 basis-80 items-center gap-3">
          <Link to="/automations" aria-label="Back to automations" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-vmd-border bg-white hover:bg-neutral-50">
            <ArrowLeft size={16} />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-vmd-textSubtle">Automations{folderName ? ` / ${folderName}` : ''}</div>
            <input
              aria-label="Automation name"
              placeholder="Name this automation"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              disabled={!canEdit}
              className="w-full bg-transparent text-xl font-semibold tracking-tight text-vmd-textStrong outline-none placeholder:text-neutral-400"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[13px] text-vmd-textMuted">
            <Toggle checked={enabled} onChange={setEnabled} disabled={!canEdit} label="Enabled" /> Enabled
          </label>
          {editing && canTrigger && (
            <Button
              onClick={() =>
                trigger.mutate(editing.id, {
                  onSuccess: (res) => pushToast(`Test run: ${res.status}`, res.status === 'success' ? 'success' : 'error'),
                  onError: (err) => pushToast(err instanceof Error ? err.message : 'Run failed', 'error'),
                })
              }
            >
              <Play size={14} /> Test run
            </Button>
          )}
          <Button onClick={handleValidate} disabled={validate.isPending}>Validate</Button>
          {canEdit && <Button variant="primary" onClick={save} disabled={create.isPending || update.isPending}>Save</Button>}
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented options={[{ id: 'builder' as const, label: 'Builder' }, { id: 'yaml' as const, label: 'YAML' }]} value={mode} onChange={setMode} />
            <Select aria-label="Folder" value={folderId} onChange={(e) => setFolderId(e.target.value)} className="w-48" disabled={!canEdit}>
              <option value="">No folder</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </div>

          {validation && (
            <div className={`rounded-lg border px-3 py-2 text-sm ${validation.valid ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
              {validation.valid ? 'Valid.' : validation.errors.join('; ')}
            </div>
          )}

          {mode === 'builder' ? (
            <>
              <Step n={1} title="When" hint="this happens"><TriggerBuilder onYamlChange={setTriggerYaml} /></Step>
              {showCondition ? (
                <Step n={2} title="Only if" hint="optional conditions"><ConditionBuilder onYamlChange={setConditionYaml} /></Step>
              ) : (
                <Step n={2} title="Only if" hint="optional conditions" dashed action={<Button size="sm" onClick={() => setShowCondition(true)}><Plus size={14} /> Add condition</Button>} />
              )}
              <Step n={3} title="Then" hint="do these, in order"><ActionChainBuilder onYamlChange={setActionYaml} /></Step>
            </>
          ) : (
            <Section title="YAML" description="Edit the three parts directly.">
              <div className="flex flex-col gap-3 p-4">
                <div><div className="mb-1.5 text-[13px] font-medium text-neutral-700">Trigger</div><YamlEditor value={triggerYaml} onChange={setTriggerYaml} rows={4} /></div>
                <div><div className="mb-1.5 text-[13px] font-medium text-neutral-700">Condition (optional)</div><YamlEditor value={conditionYaml} onChange={setConditionYaml} rows={3} /></div>
                <div><div className="mb-1.5 text-[13px] font-medium text-neutral-700">Action</div><YamlEditor value={actionYaml} onChange={setActionYaml} rows={6} /></div>
              </div>
            </Section>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Section title="Recent runs">
            {!editing ? (
              <p className="px-4 py-6 text-sm text-vmd-textSubtle">Runs show up after you save and the automation fires.</p>
            ) : runs.length === 0 ? (
              <p className="px-4 py-6 text-sm text-vmd-textSubtle">No runs recorded yet.</p>
            ) : (
              runs.slice(0, 8).map((r) => (
                <div key={r.id} className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-vmd-textStrong" title={r.error ?? undefined}>{r.error ?? (r.trigger_event ? String(r.trigger_event.type ?? 'Triggered') : 'Triggered')}</div>
                    <div className="text-xs text-vmd-textSubtle">{timeAgo(new Date(r.triggered_at).getTime() / 1000)}</div>
                  </div>
                  <Badge tone={r.status === 'success' ? 'ok' : 'danger'}>{r.status === 'success' ? 'Done' : 'Failed'}</Badge>
                </div>
              ))
            )}
          </Section>
          <Section title="What this saves as" action={<span className="text-xs text-vmd-textSubtle">YAML, read only</span>}>
            <pre className="overflow-x-auto bg-neutral-50 p-4 font-mono text-xs leading-5 text-vmd-text">{preview || '# Fill in a trigger and an action'}</pre>
          </Section>
        </div>
      </div>
    </div>
  );
}
