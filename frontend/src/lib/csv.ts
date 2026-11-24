/** Parse CSV text (quotes, escaped quotes, CRLF) into rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** Pit assignments from a CSV with `team` and `pit` columns (header row optional). */
export function parsePitCsv(text: string): { team: string; pit: string }[] {
  const rows = parseCsv(text).map((r) => r.map((v) => v.trim()));
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.toLowerCase());
  const hasHeader = header.some((h) => /team|pit/.test(h));
  const ti = hasHeader ? Math.max(header.findIndex((h) => h.includes('team')), 0) : 0;
  const pi = hasHeader ? header.findIndex((h) => h.includes('pit')) : 1;
  const body = hasHeader ? rows.slice(1) : rows;
  return body
    .map((r) => ({ team: r[ti] ?? '', pit: pi >= 0 ? (r[pi] ?? '') : '' }))
    .filter((r) => r.team && r.pit);
}
