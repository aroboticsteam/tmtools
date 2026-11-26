import { useState } from 'react';
import { DoorOpen, ExternalLink, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { useBroadcast, useNotificationStats, useTestPush } from '../api/notifications';
import { useCreateRoom, useDeleteRoom, useRooms, useUpdateRoom } from '../api/rooms';
import { usePermission } from '../hooks/usePermission';
import { useUiStore } from '../stores/ui';
import { Button } from '../components/ui/Button';
import { PageHeader, Section } from '../components/ui/Card';
import { DataTable } from '../components/ui/DataTable';
import { SplitLayout, Check } from '../components/ui/Layouts';
import { EmptyState } from '../components/ui/EmptyState';
import { Input, Label, Textarea } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Toggle } from '../components/ui/Toggle';
import { parseTeams } from '../lib/teams';
import { TeamAlertCard } from '../components/teams/TeamAlertCard';
import type { Room } from '../types/api';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}$/;

/** Rooms: named groups of teams. Each has a public display page (`/room/<slug>`,
 * with an optional livestream embed and live match alerts). Phone alerts are
 * open to everyone at `/notify` (any team, no QR), so rooms carry no QR. */
export function RoomsPage() {
  const { data: rooms, isLoading } = useRooms();
  const canManage = usePermission('rooms:manage');
  const canBroadcast = usePermission('notifications:broadcast');
  const canSeeStats = usePermission('notifications:manage');
  const { data: stats } = useNotificationStats(canSeeStats);
  const deleteRoom = useDeleteRoom();
  const pushToast = useUiStore((s) => s.pushToast);

  const [editing, setEditing] = useState<Room | 'new' | null>(null);

  function remove(room: Room) {
    if (!window.confirm(`Delete room "${room.name}"?`)) return;
    deleteRoom.mutate(room.slug, {
      onSuccess: () => pushToast('Room deleted', 'success'),
      onError: (err) => pushToast(err instanceof Error ? err.message : 'Delete failed', 'error'),
    });
  }

  const list = rooms ?? [];
  return (
    <div>
      <PageHeader
        title="Rooms"
        subtitle="Team allocations and the display page for each room."
        action={
          canManage && (
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus size={14} /> New room
            </Button>
          )
        }
      />

      {stats && !stats.push_configured && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Phone push notifications are not configured on this server (set <code>VAPID_PRIVATE_KEY</code> /{' '}
          <code>VAPID_PUBLIC_KEY</code>; see <code>tools/generate_vapid_keys.py</code>). Room displays still receive alerts.
        </p>
      )}

      <SplitLayout
        main={
          <Section title="All rooms" description="Phone alerts are open to everyone at /notify, for any team.">
            {isLoading ? (
              <p className="px-4 py-6 text-sm text-vmd-textSubtle">Loading…</p>
            ) : (
              <DataTable
                minWidth={620}
                rows={list}
                rowKey={(r) => r.slug}
                empty={<EmptyState icon={DoorOpen} title="No rooms yet">Create one and assign the teams that are in it.</EmptyState>}
                columns={[
                  { key: 'name', header: 'Room', width: '1.4fr', render: (r) => (<><div className="font-medium text-vmd-textStrong">{r.name}</div><div className="text-xs text-vmd-textSubtle">/room/{r.slug}</div></>) },
                  { key: 'teams', header: 'Teams', width: '2fr', render: (r) => (<><div className="text-vmd-text">{r.teams.length} team{r.teams.length === 1 ? '' : 's'}{r.stream_url ? ' · livestream' : ''}</div><div className="truncate text-xs text-vmd-textSubtle">{r.teams.join(', ') || 'No teams yet'}</div></>) },
                  { key: 'phones', header: 'Phones', width: '80px', render: (r) => <span className="text-vmd-textMuted">{stats ? (stats.subscriptions_by_room[r.slug] ?? 0) : '—'}</span> },
                  {
                    key: 'act',
                    header: '',
                    width: '150px',
                    render: (r) => (
                      <span className="flex justify-end gap-1">
                        <a href={`/room/${r.slug}`} target="_blank" rel="noreferrer"><Button size="sm"><ExternalLink size={14} /> Display</Button></a>
                        {canManage && (
                          <>
                            <button type="button" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)} className="flex h-8 w-8 items-center justify-center rounded-lg text-vmd-textSubtle hover:bg-neutral-100 hover:text-vmd-textStrong"><Pencil size={14} /></button>
                            <button type="button" aria-label={`Delete ${r.name}`} onClick={() => remove(r)} className="flex h-8 w-8 items-center justify-center rounded-lg text-vmd-textSubtle hover:bg-red-50 hover:text-vmd-danger"><Trash2 size={14} /></button>
                          </>
                        )}
                      </span>
                    ),
                  },
                ]}
              />
            )}
          </Section>
        }
        aside={
          <>
            {canBroadcast && list.length > 0 && <BroadcastCard rooms={list} />}
            {canBroadcast && list.length > 0 && <TeamAlertCard />}
            {canSeeStats && stats?.push_configured && <StaffPushCard staffCount={stats.staff_subscriptions} />}
          </>
        }
      />

      <RoomFormModal key={editing === null ? 'closed' : editing === 'new' ? 'new' : editing.slug} editing={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function RoomFormModal({ editing, onClose }: { editing: Room | 'new' | null; onClose: () => void }) {
  const existing = editing && editing !== 'new' ? editing : null;
  const createRoom = useCreateRoom();
  const updateRoom = useUpdateRoom();
  const pushToast = useUiStore((s) => s.pushToast);

  const [slug, setSlug] = useState(existing?.slug ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [streamUrl, setStreamUrl] = useState(existing?.stream_url ?? '');
  const [teamsText, setTeamsText] = useState(existing?.teams.join(', ') ?? '');

  const slugOk = existing !== null || SLUG_PATTERN.test(slug);
  const busy = createRoom.isPending || updateRoom.isPending;

  function submit() {
    const body = { name: name.trim(), stream_url: streamUrl.trim() || null, teams: parseTeams(teamsText) };
    const callbacks = {
      onSuccess: () => {
        pushToast(existing ? 'Room updated' : 'Room created', 'success');
        onClose();
      },
      onError: (err: unknown) => pushToast(err instanceof Error ? err.message : 'Save failed', 'error'),
    };
    if (existing) updateRoom.mutate({ slug: existing.slug, body }, callbacks);
    else createRoom.mutate({ slug: slug.trim(), ...body }, callbacks);
  }

  return (
    <Modal open={editing !== null} onClose={onClose} title={existing ? `Edit ${existing.name}` : 'New room'}>
      <div className="space-y-3">
        {!existing && (
          <div>
            <Label>URL name (lowercase letters, numbers, dashes)</Label>
            <Input placeholder="pit-room-1" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
            {slug && !slugOk && <p className="mt-1 text-xs text-vmd-danger">Use a-z, 0-9 and dashes only.</p>}
          </div>
        )}
        <div>
          <Label>Display name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label>Livestream URL (optional — YouTube links are converted to embeds)</Label>
          <Input placeholder="https://www.youtube.com/watch?v=…" value={streamUrl} onChange={(e) => setStreamUrl(e.target.value)} />
        </div>
        <div>
          <Label>Teams in this room (commas, spaces or new lines)</Label>
          <Textarea rows={5} value={teamsText} onChange={(e) => setTeamsText(e.target.value)} />
          <p className="mt-1 text-xs text-vmd-textSubtle">{parseTeams(teamsText).length} teams</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !name.trim() || !slugOk || (!existing && !slug)}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function BroadcastCard({ rooms }: { rooms: Room[] }) {
  const broadcast = useBroadcast();
  const pushToast = useUiStore((s) => s.pushToast);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<string[]>([]); // empty = all rooms
  const [push, setPush] = useState(true);
  const [modal, setModal] = useState(true);

  function toggleRoom(slug: string) {
    setSelected((cur) => (cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug]));
  }

  function send() {
    broadcast.mutate(
      { title: title.trim(), message: message.trim(), rooms: selected.length ? selected : null, push, modal },
      {
        onSuccess: (res) => {
          pushToast(`Sent to ${res.rooms} room display${res.rooms === 1 ? '' : 's'}, ${res.pushed} phone${res.pushed === 1 ? '' : 's'}`, 'success');
          setTitle('');
          setMessage('');
        },
        onError: (err) => pushToast(err instanceof Error ? err.message : 'Broadcast failed', 'error'),
      },
    );
  }

  return (
    <Section title="Broadcast" description="Send a message to room displays and phones.">
      <div className="flex flex-col gap-3 p-4">
        <div>
          <Label>Title</Label>
          <Input maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label>Message</Label>
          <Textarea rows={3} maxLength={500} className="font-sans" value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span>Also push to phones</span>
          <Toggle checked={push} onChange={setPush} label="Also push to phones" />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span>Full-screen popup on displays</span>
          <Toggle checked={modal} onChange={setModal} label="Full-screen popup on displays" />
        </div>
        <div>
          <Label>Rooms ({selected.length === 0 ? 'all rooms' : `${selected.length} selected`})</Label>
          <div className="grid max-h-40 gap-1.5 overflow-auto">
            {rooms.map((room) => (
              <Check key={room.slug} checked={selected.includes(room.slug)} onChange={() => toggleRoom(room.slug)} label={room.name} />
            ))}
          </div>
          <p className="mt-1 text-xs text-vmd-textSubtle">Leave all unchecked to send to every room.</p>
        </div>
        <Button variant="primary" onClick={send} disabled={broadcast.isPending || !title.trim() || !message.trim()}>
          <Send size={14} /> Send broadcast
        </Button>
      </div>
    </Section>
  );
}

function StaffPushCard({ staffCount }: { staffCount: number }) {
  const testPush = useTestPush();
  const pushToast = useUiStore((s) => s.pushToast);
  return (
    <Section title="Staff push alerts" description={`${staffCount} staff device${staffCount === 1 ? '' : 's'} subscribed. Staff turn alerts on from the Staff alerts button.`}>
      <div className="p-4">
        <Button
          disabled={testPush.isPending || staffCount === 0}
          onClick={() =>
            testPush.mutate(undefined, {
              onSuccess: (res) => pushToast(`Test sent to ${res.pushed} device${res.pushed === 1 ? '' : 's'}`, 'success'),
              onError: (err) => pushToast(err instanceof Error ? err.message : 'Test failed', 'error'),
            })
          }
        >
          Send test
        </Button>
      </div>
    </Section>
  );
}
