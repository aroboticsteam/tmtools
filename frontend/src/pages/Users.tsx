import { useState } from 'react';
import { Plus, ShieldCheck, X } from 'lucide-react';
import { usePermissionCatalog, useReplaceRolePermissions, useRolePermissions } from '../api/settings';
import { usePermission } from '../hooks/usePermission';
import { useUiStore } from '../stores/ui';
import { ALL_PERMISSIONS } from '../stores/auth';
import { PageHeader, Section } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input, Label, Select } from '../components/ui/Input';
import { DataTable } from '../components/ui/DataTable';
import { SplitLayout } from '../components/ui/Layouts';
import { EmptyState } from '../components/ui/EmptyState';

/** Authentik group -> permission mappings. `PUT /api/v1/users/roles` replaces
 * the whole table, so each change saves the full desired list. */
export function UsersPage() {
  const { data: rolePermissions = [] } = useRolePermissions();
  const replaceRolePermissions = useReplaceRolePermissions();
  const canEdit = usePermission('settings:edit');
  const pushToast = useUiStore((s) => s.pushToast);
  const { data: catalog } = usePermissionCatalog();
  const permissionNames = catalog ? catalog.permissions.map((p) => p.name) : [...ALL_PERMISSIONS];
  const [newGroup, setNewGroup] = useState('');
  const [newPermission, setNewPermission] = useState<string>(ALL_PERMISSIONS[0]);

  const groups = Array.from(new Set(rolePermissions.map((r) => r.authentik_group))).sort();

  function save(next: { authentik_group: string; permission: string }[]) {
    replaceRolePermissions.mutate(next, {
      onError: (err) => pushToast(err instanceof Error ? err.message : 'Save failed', 'error'),
    });
  }
  function addMapping() {
    if (!newGroup) return;
    if (rolePermissions.some((r) => r.authentik_group === newGroup && r.permission === newPermission)) return;
    save([...rolePermissions, { authentik_group: newGroup, permission: newPermission }]);
    setNewGroup('');
  }
  function removeMapping(group: string, permission: string) {
    save(rolePermissions.filter((r) => !(r.authentik_group === group && r.permission === permission)));
  }

  return (
    <div>
      <PageHeader title="Users and roles" subtitle="Which sign-in group can do what." />
      <SplitLayout
        main={
          <Section title="Groups" description="Each Authentik group gets the permissions listed here.">
            <DataTable
              minWidth={480}
              rows={groups}
              rowKey={(g) => g}
              empty={<EmptyState icon={ShieldCheck} title="No role mappings yet">Add a group and a permission on the right.</EmptyState>}
              columns={[
                { key: 'group', header: 'Group', width: '1fr', render: (g) => <span className="font-medium text-vmd-textStrong">{g}</span> },
                {
                  key: 'perms',
                  header: 'Permissions',
                  width: '2.5fr',
                  render: (g) => (
                    <div className="flex flex-wrap gap-1.5">
                      {rolePermissions.filter((r) => r.authentik_group === g).map((r) => (
                        <span key={r.permission} className="vmd-chip gap-1 text-vmd-text">
                          {r.permission}
                          {canEdit && (
                            <button type="button" aria-label={`Remove ${r.permission} from ${g}`} onClick={() => removeMapping(g, r.permission)} className="text-vmd-textSubtle hover:text-vmd-danger">
                              <X size={12} />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  ),
                },
              ]}
            />
          </Section>
        }
        aside={
          canEdit ? (
            <Section title="Add mapping">
              <div className="flex flex-col gap-3 p-4">
                <div>
                  <Label htmlFor="role-group">Group</Label>
                  <Input id="role-group" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="tmtools-operator" />
                </div>
                <div>
                  <Label htmlFor="role-perm">Permission</Label>
                  <Select id="role-perm" value={newPermission} onChange={(e) => setNewPermission(e.target.value)}>
                    <option value="*">* (all permissions)</option>
                    {permissionNames.map((p) => (<option key={p} value={p}>{p}</option>))}
                  </Select>
                </div>
                <Button variant="primary" onClick={addMapping} disabled={!newGroup}><Plus size={16} /> Add mapping</Button>
              </div>
            </Section>
          ) : undefined
        }
      />
    </div>
  );
}
