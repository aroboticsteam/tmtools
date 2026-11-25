import * as yaml from 'js-yaml';

function load(text: string | null): unknown[] {
  if (!text) return [];
  try {
    const v = yaml.load(text);
    return Array.isArray(v) ? v : v ? [v] : [];
  } catch {
    return [];
  }
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Short "When ..." chip text from a trigger YAML list. */
export function whenSummary(triggerYaml: string): string {
  const t = obj(load(triggerYaml)[0]);
  if (t.platform === 'timer_milestone') return `Timer reaches ${String(t.remaining ?? '')} remaining`;
  const event = typeof t.event_type === 'string' ? t.event_type.replace(/([A-Z])/g, ' $1').toLowerCase() : 'something happens';
  const source = typeof t.entity_id === 'string' ? t.entity_id : typeof t.tag === 'string' ? `tag ${t.tag}` : '';
  return source ? `${event} (${source})` : event;
}

/** Short "Then ..." chip text from an action YAML list. */
export function thenSummary(actionYaml: string): string {
  const actions = load(actionYaml).map(obj);
  if (actions.length === 0) return 'No actions';
  const first = actions[0];
  const label = String(first.service ?? first.script ?? (first.delay !== undefined ? `Wait ${String(first.delay)}` : 'Run actions'));
  return actions.length > 1 ? `${label} +${actions.length - 1} more` : label;
}

/** Read-only preview of what an automation saves as. */
export function previewYaml(alias: string, enabled: boolean, trigger: string, condition: string, action: string): string {
  const parts: Record<string, unknown> = { alias, enabled };
  const t = load(trigger);
  const c = load(condition);
  const a = load(action);
  if (t.length) parts.trigger = t;
  if (c.length) parts.condition = c;
  if (a.length) parts.action = a;
  try {
    return yaml.dump(parts, { lineWidth: 100 });
  } catch {
    return '';
  }
}
