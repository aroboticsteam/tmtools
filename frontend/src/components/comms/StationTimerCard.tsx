import { useState } from 'react';
import { MonitorUp } from 'lucide-react';
import { usePushScreen, type Audience } from '../../api/comms';
import { useTimers } from '../../api/timers';
import { useWsStore } from '../../stores/ws';
import { useUiStore } from '../../stores/ui';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Label, Select } from '../ui/Input';

/** Puts one of the timer instances (Timers & teleprompter, above) on the station iPads' timer screen.
 * The iPads then follow that timer live; it is started, stopped and reset where it is managed, exactly
 * like the prompter, not from here. */
export function StationTimerCard({ audience }: { audience: Audience }) {
  const { data: timers = [] } = useTimers();
  const pushScreen = usePushScreen();
  const pushToast = useUiStore((s) => s.pushToast);
  const live = useWsStore((s) => s.timerStates);
  const [chosen, setChosen] = useState('');

  const selected = chosen && timers.some((t) => t.entity_id === chosen) ? chosen : (timers[0]?.entity_id ?? '');
  const state = selected ? live[selected] : undefined;

  function show() {
    pushScreen.mutate(
      { ...audience, screen: 'timer', timer: selected },
      {
        onSuccess: (r) => pushToast(`Timer shown on ${r.stations.length} station${r.stations.length === 1 ? '' : 's'}`, 'success'),
        onError: (err) => pushToast(err instanceof Error ? err.message : 'Request failed', 'error'),
      },
    );
  }

  return (
    <Card className="mb-4" data-testid="station-timer-card">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-vmd-textMuted">Timer on stations</h2>
      {timers.length === 0 ? (
        <p className="text-sm text-vmd-textSubtle">Create a timer under Timers &amp; teleprompter to show it on the iPads.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64">
            <Label>Timer</Label>
            <Select value={selected} onChange={(e) => setChosen(e.target.value)} aria-label="Timer to show">
              {timers.map((t) => (
                <option key={t.entity_id} value={t.entity_id}>
                  {t.display_name} ({t.duration_s}s)
                </option>
              ))}
            </Select>
          </div>
          <Button variant="primary" disabled={!selected || pushScreen.isPending} onClick={show}>
            <MonitorUp size={14} /> Show on stations
          </Button>
          {state && (
            <p className="text-xs text-vmd-success">
              {String(state.phase ?? (state.running ? 'running' : 'idle'))}
              {state.remaining !== undefined ? ` · remaining ${state.remaining}` : ''}
            </p>
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-vmd-textSubtle">
        The iPads follow the timer live. Start, stop and reset it in Timers &amp; teleprompter above.
      </p>
    </Card>
  );
}
