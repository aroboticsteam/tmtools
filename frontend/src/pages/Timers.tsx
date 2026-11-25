import { useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Play, Plus, RotateCw, Square, Timer, Trash2 } from 'lucide-react';
import { useDeleteTimer, useResetTimer, useStartTimer, useStopTimer, useTimers, useUpdateTimer } from '../api/timers';
import { useWebSocket } from '../hooks/useWebSocket';
import { usePermission } from '../hooks/usePermission';
import { useWsStore } from '../stores/ws';
import { useUiStore } from '../stores/ui';
import { PageHeader, Section } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { CopyButton } from '../components/ui/CopyButton';
import { EmptyState } from '../components/ui/EmptyState';
import { CuesPanel } from '../components/timers/CuesPanel';
import { TimerEditorModal } from '../components/timers/TimerEditorModal';
import type { TimerInstance } from '../types/api';

/** Timers and teleprompter: each timer instance with its controls, prompter link and cues. */
export function TimersPage() {
  useWebSocket('/ws/events');
  const { data: timers = [], isLoading } = useTimers();
  const deleteTimer = useDeleteTimer();
  const updateTimer = useUpdateTimer();
  const startTimer = useStartTimer();
  const stopTimer = useStopTimer();
  const resetTimer = useResetTimer();
  const canView = usePermission('timers:read');
  const canEdit = usePermission('timers:edit');
  const canControl = usePermission('prompter:control');
  const pushToast = useUiStore((s) => s.pushToast);
  const live = useWsStore((s) => s.timerStates);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TimerInstance | null>(null);

  const open = (t: TimerInstance | null) => {
    setEditing(t);
    setModalOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Timers"
        subtitle="Match timers, teleprompter links and cues."
        action={canEdit && <Button variant="primary" onClick={() => open(null)}><Plus size={16} /> New timer</Button>}
      />
      {!canView ? (
        <p className="text-sm text-vmd-textSubtle">You do not have access to timers.</p>
      ) : (
        <div className="flex flex-col gap-4" data-testid="timers-section">
          {isLoading && <p className="text-sm text-vmd-textSubtle">Loading…</p>}
          {!isLoading && timers.length === 0 && <EmptyState icon={Timer} title="No timers yet">Create one to drive the match clock and teleprompter.</EmptyState>}
          {timers.map((timer) => {
            const state = live[timer.entity_id];
            const prompterUrl = `${window.location.origin}/prompter/${timer.entity_id}?token=${timer.prompter_token}`;
            const isOpen = expanded === timer.entity_id;
            const phase = state ? String(state.phase ?? (state.running ? 'running' : 'idle')) : null;
            return (
              <Section
                key={timer.entity_id}
                title={timer.display_name}
                description={`${timer.entity_id} · fieldset ${timer.field_set_id}, field ${timer.field_id} · ${timer.duration_s}s`}
                action={phase ? <Badge tone={state?.running ? 'live' : 'neutral'}>{phase}{state?.remaining !== undefined ? ` · ${state.remaining}` : ''}</Badge> : undefined}
              >
                <div className="flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {canControl && (
                      <>
                        <Button variant="primary" onClick={() => startTimer.mutate(timer.entity_id)}><Play size={14} /> Start</Button>
                        <Button onClick={() => stopTimer.mutate(timer.entity_id)}><Square size={14} /> Stop</Button>
                        <Button aria-label="Reset timer" title="Reset" onClick={() => resetTimer.mutate(timer.entity_id)}><RotateCw size={14} /></Button>
                      </>
                    )}
                    <span className="ml-auto flex gap-1">
                      <button type="button" aria-label={`Edit ${timer.display_name}`} onClick={() => open(timer)} className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-vmd-text hover:bg-neutral-100"><Pencil size={14} /> Edit</button>
                      {canEdit && (
                        <button type="button" aria-label={`Delete ${timer.display_name}`} onClick={() => deleteTimer.mutate(timer.entity_id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-vmd-textSubtle hover:bg-red-50 hover:text-vmd-danger"><Trash2 size={14} /></button>
                      )}
                    </span>
                  </div>
                  <div>
                    <div className="mb-1.5 text-[13px] font-medium text-neutral-700">Teleprompter link</div>
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-vmd-border bg-neutral-50 px-3 py-2 text-xs text-vmd-textMuted">
                      <span className="min-w-0 flex-1 basis-60 truncate">{prompterUrl}</span>
                      <CopyButton value={prompterUrl} />
                      {canEdit && (
                        <Button
                          size="sm"
                          onClick={() =>
                            updateTimer.mutate(
                              { entityId: timer.entity_id, body: { regenerate_token: true } },
                              { onSuccess: () => pushToast('Token regenerated, old links are now invalid', 'success') },
                            )
                          }
                        >
                          Regenerate token
                        </Button>
                      )}
                    </div>
                  </div>
                  <button type="button" onClick={() => setExpanded(isOpen ? null : timer.entity_id)} className="flex items-center gap-1 self-start text-[13px] font-medium text-vmd-text hover:underline">
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    {isOpen ? 'Hide cues' : 'Manage cues'}
                  </button>
                  {isOpen && <div className="border-t border-vmd-border pt-3"><CuesPanel entityId={timer.entity_id} /></div>}
                </div>
              </Section>
            );
          })}
        </div>
      )}
      <TimerEditorModal open={modalOpen} onClose={() => setModalOpen(false)} editing={editing} />
    </div>
  );
}
