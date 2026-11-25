import { useState } from 'react';
import { FileCode2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useScripts, useDeleteScript } from '../api/scripts';
import { usePermission } from '../hooks/usePermission';
import { PageHeader, Section } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { DataTable } from '../components/ui/DataTable';
import { EmptyState } from '../components/ui/EmptyState';
import { ScriptEditorModal } from '../components/automations/ScriptEditorModal';
import type { Script } from '../types/api';

export function ScriptsPage() {
  const { data: scripts = [], isLoading } = useScripts();
  const deleteScript = useDeleteScript();
  const canEdit = usePermission('automations:edit');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Script | null>(null);

  const open = (s: Script | null) => {
    setEditing(s);
    setModalOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Scripts"
        subtitle="Reusable action sequences you can call from any automation."
        action={canEdit && <Button variant="primary" onClick={() => open(null)}><Plus size={16} /> New script</Button>}
      />
      <Section title="All scripts" description="Call one with script: <name> in an automation.">
        {isLoading ? (
          <p className="px-4 py-6 text-sm text-vmd-textSubtle">Loading…</p>
        ) : (
          <DataTable
            minWidth={480}
            rows={scripts}
            rowKey={(s) => s.id}
            empty={<EmptyState icon={FileCode2} title="No scripts yet">Create one to reuse a sequence of actions.</EmptyState>}
            columns={[
              { key: 'name', header: 'Name', width: '1.2fr', render: (s) => <span className="font-mono text-[13px] font-medium text-vmd-textStrong">{s.name}</span> },
              { key: 'desc', header: 'Description', width: '2fr', render: (s) => <span className="text-vmd-textMuted">{s.description ?? '—'}</span> },
              {
                key: 'act',
                header: '',
                width: '80px',
                render: (s) => (
                  <span className="flex justify-end gap-1">
                    <button type="button" aria-label={`Edit ${s.name}`} onClick={() => open(s)} className="flex h-8 w-8 items-center justify-center rounded-lg text-vmd-textSubtle hover:bg-neutral-100 hover:text-vmd-textStrong"><Pencil size={14} /></button>
                    {canEdit && <button type="button" aria-label={`Delete ${s.name}`} onClick={() => deleteScript.mutate(s.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-vmd-textSubtle hover:bg-red-50 hover:text-vmd-danger"><Trash2 size={14} /></button>}
                  </span>
                ),
              },
            ]}
          />
        )}
      </Section>
      <ScriptEditorModal open={modalOpen} onClose={() => setModalOpen(false)} editing={editing} />
    </div>
  );
}
