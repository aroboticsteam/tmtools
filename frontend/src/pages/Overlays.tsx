import { useState } from 'react';
import { Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { useDeleteOverlay, useOverlayPreview, useOverlays, useSpotlightTeam } from '../api/overlays';
import { useTeams } from '../api/teams';
import { useUiStore } from '../stores/ui';
import { Input } from '../components/ui/Input';
import { usePermission } from '../hooks/usePermission';
import { PageHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { CopyButton } from '../components/ui/CopyButton';
import { DetailPanel } from '../components/ui/Layouts';
import { EmptyState } from '../components/ui/EmptyState';
import { OverlayEditorModal } from '../components/overlays/OverlayEditorModal';
import type { OverlayInstance } from '../types/api';

/** Overlay instances (OBS browser sources). Pick one to see its URL, run the
 * finals spotlight and preview it. The backend's `/preview` is a documented
 * stub, so the preview says so rather than faking match data. */
export function OverlaysPage() {
  const { data: overlays = [], isLoading } = useOverlays();
  const deleteOverlay = useDeleteOverlay();
  const canEdit = usePermission('overlays:edit');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<OverlayInstance | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = overlays.find((o) => o.entity_id === selectedId) ?? null;
  const { data: preview } = useOverlayPreview(selectedId);

  return (
    <div>
      <PageHeader
        title="Overlays"
        subtitle="Browser sources for OBS that show team photos and match info."
        action={
          canEdit && (
            <Button variant="primary" onClick={() => { setEditing(null); setModalOpen(true); }}>
              <Plus size={16} /> New overlay
            </Button>
          )
        }
      />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {isLoading && <p className="text-sm text-vmd-textSubtle">Loading…</p>}
          {!isLoading && overlays.length === 0 && <EmptyState icon={Layers} title="No overlays yet">Create one, then add its URL to OBS as a browser source.</EmptyState>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {overlays.map((overlay) => {
              const sel = overlay.entity_id === selectedId;
              return (
                <section
                  key={overlay.entity_id}
                  onClick={() => setSelectedId(overlay.entity_id)}
                  className={`flex cursor-pointer flex-col gap-3 rounded-xl border bg-white p-4 ${sel ? 'border-neutral-900' : 'border-vmd-border hover:border-neutral-400'}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700"><Layers size={18} /></span>
                    <div className="min-w-0">
                      <button type="button" className="block max-w-full truncate text-left font-semibold text-vmd-textStrong" onClick={() => setSelectedId(overlay.entity_id)}>{overlay.display_name}</button>
                      <div className="truncate text-xs text-vmd-textSubtle">{overlay.entity_id}</div>
                    </div>
                  </div>
                  <div className="text-[13px] text-vmd-textMuted">Fieldset {overlay.field_set_id}</div>
                </section>
              );
            })}
          </div>
        </div>

        {selected && (
          <DetailPanel
            key={selected.entity_id}
            title={selected.display_name}
            subtitle={selected.entity_id}
            onClose={() => setSelectedId(null)}
            footer={
              canEdit ? (
                <>
                  <button type="button" onClick={() => { deleteOverlay.mutate(selected.entity_id); setSelectedId(null); }} className="flex h-8 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-[13px] font-medium text-vmd-danger hover:bg-red-50"><Trash2 size={14} /> Delete</button>
                  <Button size="sm" variant="primary" onClick={() => { setEditing(selected); setModalOpen(true); }}><Pencil size={14} /> Edit</Button>
                </>
              ) : undefined
            }
          >
            <div>
              <div className="mb-1.5 text-[13px] font-medium text-neutral-700">Browser source URL</div>
              <div className="flex items-center gap-2 rounded-lg border border-vmd-border bg-neutral-50 px-3 py-2 text-xs text-vmd-textMuted">
                <span className="min-w-0 flex-1 truncate">{`${window.location.origin}/overlay/${selected.entity_id}`}</span>
                <CopyButton value={`${window.location.origin}/overlay/${selected.entity_id}`} />
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[13px] font-medium text-neutral-700">Preview</div>
              <div className="rounded-lg bg-neutral-900 p-4 text-center text-sm text-white">
                {preview?.teams && preview.teams.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {preview.teams.map((team) => (<div key={team} className="rounded border border-white/20 p-2">{team}</div>))}
                  </div>
                ) : (
                  <span className="text-white/70">No match currently queued (transparent).</span>
                )}
              </div>
              <p className="mt-1.5 text-xs text-vmd-textSubtle">The backend preview is a stub and always reports no queued match.</p>
            </div>
            {canEdit && <SpotlightControls entityId={selected.entity_id} />}
          </DetailPanel>
        )}
      </div>

      <OverlayEditorModal open={modalOpen} onClose={() => setModalOpen(false)} editing={editing} />
    </div>
  );
}

/** Finals "team spotlight" operator control: pick a team to put on the
 * overlay (bot photo + info + team photo), or return to the match view. */
function SpotlightControls({ entityId }: { entityId: string }) {
  const { data: teams = [] } = useTeams();
  const spotlight = useSpotlightTeam();
  const pushToast = useUiStore((s) => s.pushToast);
  const [team, setTeam] = useState('');
  const listId = `spotlight-teams-${entityId}`;
  const send = (value: string | null) =>
    spotlight.mutate(
      { entityId, team: value },
      {
        onSuccess: () => pushToast(value ? `Spotlighting ${value}` : 'Back to the match view', 'success'),
        onError: (err) => pushToast(err instanceof Error ? err.message : 'Request failed', 'error'),
      },
    );
  const clean = team.trim().toUpperCase();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-full text-[13px] font-medium text-neutral-700">Finals spotlight</span>
      <Input
        className="max-w-[10rem]"
        placeholder="Team, e.g. 1234A"
        aria-label={`Spotlight team for ${entityId}`}
        list={listId}
        value={team}
        onChange={(e) => setTeam(e.target.value)}
      />
      <datalist id={listId}>
        {teams.map((t) => (
          <option key={t.team_number} value={t.team_number} />
        ))}
      </datalist>
      <Button variant="primary" disabled={!clean || spotlight.isPending} onClick={() => send(clean)}>
        Show team
      </Button>
      <Button variant="secondary" disabled={spotlight.isPending} onClick={() => send(null)}>
        Back to match view
      </Button>
    </div>
  );
}
