/**
 * Tiny Markdown renderer for teleprompter cues: headers, bold, italic and lists.
 * Input is HTML-escaped first, so the result is safe for dangerouslySetInnerHTML.
 */
function inline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>');
}

export function renderMarkdown(src: unknown): string {
  if (!src) return '';
  const escaped = String(src).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html: string[] = [];
  let inList: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (inList) {
      html.push(`</${inList}>`);
      inList = null;
    }
  };
  for (const line of escaped.split(/\r?\n/)) {
    const header = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^[-*]\s+(.*)$/.exec(line);
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (header) {
      closeList();
      const level = header[1].length;
      html.push(`<h${level}>${inline(header[2])}</h${level}>`);
    } else if (ul) {
      if (inList !== 'ul') {
        closeList();
        html.push('<ul>');
        inList = 'ul';
      }
      html.push(`<li>${inline(ul[1])}</li>`);
    } else if (ol) {
      if (inList !== 'ol') {
        closeList();
        html.push('<ol>');
        inList = 'ol';
      }
      html.push(`<li>${inline(ol[1])}</li>`);
    } else if (line.trim() === '') {
      closeList();
      html.push('<br/>');
    } else {
      closeList();
      html.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return html.join('\n');
}

export function formatClock(totalSeconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m < 10 ? '0' : ''}${m}:${rem < 10 ? '0' : ''}${rem}`;
}

export interface PrompterTeam {
  team_number: string;
  team_name: string | null;
  robot_name: string | null;
  rank: number | null;
  awards: unknown[];
}

/** A team entry is a bare number or the enriched object the server sends; every field but the number may be missing. */
export function normalizePrompterTeam(team: unknown): PrompterTeam {
  if (typeof team === 'string' || typeof team === 'number') {
    return { team_number: String(team), team_name: null, robot_name: null, rank: null, awards: [] };
  }
  const t = (team || {}) as Record<string, unknown>;
  return {
    team_number: t.team_number != null ? String(t.team_number) : t.number != null ? String(t.number) : '',
    team_name: (t.team_name as string) || (t.name as string) || null,
    robot_name: (t.robot_name as string) || null,
    rank: typeof t.rank === 'number' ? t.rank : null,
    awards: Array.isArray(t.awards) ? t.awards : [],
  };
}

export function formatAwards(awards: unknown[]): string | null {
  const names = (awards || [])
    .map((a) => (typeof a === 'string' ? a : ((a as { title?: string; name?: string })?.title || (a as { name?: string })?.name) || null))
    .filter(Boolean);
  return names.length ? names.join(', ') : null;
}
