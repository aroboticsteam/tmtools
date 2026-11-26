import { describe, expect, it } from 'vitest';
import { formatAwards, formatClock, normalizePrompterTeam, renderMarkdown } from './miniMarkdown';

describe('teleprompter helpers', () => {
  it('renders headers, emphasis and lists, escaping HTML first', () => {
    expect(renderMarkdown('# Hi\n**bold** and _it_\n- a\n- b\n1. one')).toBe(
      '<h1>Hi</h1>\n<p><strong>bold</strong> and <em>it</em></p>\n<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n<ol>\n<li>one</li>\n</ol>',
    );
    expect(renderMarkdown('<script>x</script>')).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>');
    expect(renderMarkdown('')).toBe('');
  });
  it('formats the clock and awards, and tolerates bare or partial team entries', () => {
    expect(formatClock(75)).toBe('01:15');
    expect(formatClock(-3)).toBe('00:00');
    expect(formatAwards(['Excellence', { title: 'Design' }, { name: 'Judges' }])).toBe('Excellence, Design, Judges');
    expect(formatAwards([])).toBeNull();
    expect(normalizePrompterTeam('1A')).toMatchObject({ team_number: '1A', rank: null, awards: [] });
    expect(normalizePrompterTeam({ number: 7, name: 'Bot', rank: 2 })).toMatchObject({ team_number: '7', team_name: 'Bot', rank: 2 });
  });
});
