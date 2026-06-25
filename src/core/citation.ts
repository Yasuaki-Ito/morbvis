/**
 * Citation metadata for MOrbVis.
 *
 * Workflow:
 *  - Pre-publication: status = 'software'. The displayed citation lists authors,
 *    title, year, and URL only — no claim about journal submission status.
 *  - Upon acceptance: status = 'published'. Fill in journal/volume/pages/doi.
 */

type CitationStatus = 'software' | 'published';

interface CitationInfo {
  bibtexKey: string;
  authors: string[];
  title: string;
  year: number;
  status: CitationStatus;
  /** Published-only fields */
  journal?: string;
  volume?: string;
  number?: string; // issue
  pages?: string;
  doi?: string;
  url: string;
}

export const CITATION: CitationInfo = {
  bibtexKey: 'morbvis2026',
  authors: ['Yasuaki Ito', 'Satoki Tsuji', 'Koji Nakano', 'Akihiko Kasagi'],
  title: 'MOrbVis: Browser-Based Molecular Orbital Visualization with WebGPU-Accelerated On-the-Fly Evaluation',
  year: 2026,
  status: 'published',
  journal: 'ACS Omega',
  volume: '11',
  number: '24',
  pages: '36291-36301',
  doi: '10.1021/acsomega.6c04162',
  url: 'https://yasuaki-ito.github.io/morbvis/',
};

/** Human-readable citation, single line. */
export function formattedCitation(): string {
  const c = CITATION;
  const authors = c.authors.join(', ');
  const parts: string[] = [
    `${authors}.`,
    `"${c.title}".`,
  ];
  if (c.status === 'published' && c.journal) {
    // e.g. "ACS Omega 2026, 11 (24), 36291-36301."
    let volPart = c.journal;
    if (c.year) volPart += ` ${c.year},`;
    if (c.volume) volPart += ` ${c.volume}`;
    if (c.number) volPart += ` (${c.number})`;
    if (c.pages) volPart += `, ${c.pages}`;
    parts.push(volPart + '.');
    if (c.doi) parts.push(`DOI: ${c.doi}`);
  } else {
    parts.push(`${c.year}.`);
    parts.push(c.url);
  }
  return parts.join(' ');
}

/** BibTeX-format entry: @software pre-publication, @article once published. */
export function bibtexEntry(): string {
  const c = CITATION;
  const lines: string[] = [];

  if (c.status === 'published') {
    lines.push(`@article{${c.bibtexKey},`);
    lines.push(`  author  = {${c.authors.join(' and ')}},`);
    lines.push(`  title   = {{${c.title}}},`);
    if (c.journal) lines.push(`  journal = {${c.journal}},`);
    lines.push(`  year    = {${c.year}},`);
    if (c.volume) lines.push(`  volume  = {${c.volume}},`);
    if (c.number) lines.push(`  number  = {${c.number}},`);
    if (c.pages) lines.push(`  pages   = {${c.pages}},`);
    if (c.doi) lines.push(`  doi     = {${c.doi}},`);
    if (c.url) lines.push(`  url     = {${c.url}},`);
  } else {
    lines.push(`@software{${c.bibtexKey},`);
    lines.push(`  author = {${c.authors.join(' and ')}},`);
    lines.push(`  title  = {{${c.title}}},`);
    lines.push(`  year   = {${c.year}},`);
    if (c.url) lines.push(`  url    = {${c.url}},`);
  }
  lines.push('}');
  return lines.join('\n');
}
