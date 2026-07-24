import type { Atom, XYZAnnotation } from '../types';
import { isColormap, sampleColormap } from './colormaps';

const ATOMIC_NUMBERS: Record<string, number> = {
  H: 1, He: 2, Li: 3, Be: 4, B: 5, C: 6, N: 7, O: 8, F: 9, Ne: 10,
  Na: 11, Mg: 12, Al: 13, Si: 14, P: 15, S: 16, Cl: 17, Ar: 18,
  K: 19, Ca: 20, Sc: 21, Ti: 22, V: 23, Cr: 24, Mn: 25, Fe: 26,
  Co: 27, Ni: 28, Cu: 29, Zn: 30, Ga: 31, Ge: 32, As: 33, Se: 34,
  Br: 35, Kr: 36, Rb: 37, Sr: 38, Y: 39, Zr: 40, Nb: 41, Mo: 42,
  Tc: 43, Ru: 44, Rh: 45, Pd: 46, Ag: 47, Cd: 48, In: 49, Sn: 50,
  Sb: 51, Te: 52, I: 53, Xe: 54, Cs: 55, Ba: 56,
  La: 57, Ce: 58, Pr: 59, Nd: 60, Pm: 61, Sm: 62, Eu: 63, Gd: 64,
  Tb: 65, Dy: 66, Ho: 67, Er: 68, Tm: 69, Yb: 70, Lu: 71,
  Hf: 72, Ta: 73, W: 74, Re: 75, Os: 76, Ir: 77, Pt: 78, Au: 79,
  Hg: 80, Tl: 81, Pb: 82, Bi: 83, Po: 84, At: 85, Rn: 86,
};

/** `key=value` directives from the comment line of an annotated XYZ. */
interface Directives {
  cmap?: string;
  vmin?: number;
  vmax?: number;
  focus?: string;
  focusMode: 'dim' | 'hidden';
  focusZoom: boolean;
  dimColor: string;
  colorbar: boolean;
  colorbarLabel?: string;
  novalueColor?: string;
}

const DIRECTIVE_KEYS = new Set([
  'cmap', 'colormap', 'vmin', 'vmax', 'range', 'focus', 'focus_mode', 'focus_zoom',
  'dim_color', 'colorbar', 'cblabel', 'novalue',
]);

/**
 * Parse the comment line for display directives. Returns null when the line
 * carries none, so ordinary XYZ files keep their previous behaviour exactly.
 */
function parseDirectives(comment: string): Directives | null {
  const tokens = [...comment.matchAll(/([A-Za-z_]+)\s*=\s*("[^"]*"|'[^']*'|\S+)/g)];
  const found = tokens.filter(m => DIRECTIVE_KEYS.has(m[1].toLowerCase()));
  if (found.length === 0) return null;

  const d: Directives = {
    focusMode: 'dim',
    focusZoom: false,
    dimColor: '#BFBFBF',
    colorbar: false,
  };
  const truthy = (v: string) => !/^(0|false|no|off)$/i.test(v);

  for (const m of found) {
    const key = m[1].toLowerCase();
    const raw = m[2].replace(/^["']|["']$/g, '');
    switch (key) {
      case 'cmap':
      case 'colormap':
        d.cmap = raw;
        break;
      case 'vmin': d.vmin = parseFloat(raw); break;
      case 'vmax': d.vmax = parseFloat(raw); break;
      case 'range': {
        // range=0:1 or range=0,1
        const [lo, hi] = raw.split(/[:,]/).map(parseFloat);
        if (Number.isFinite(lo)) d.vmin = lo;
        if (Number.isFinite(hi)) d.vmax = hi;
        break;
      }
      case 'focus': d.focus = raw; break;
      case 'focus_mode': d.focusMode = /^hid|^hide/i.test(raw) ? 'hidden' : 'dim'; break;
      case 'focus_zoom': d.focusZoom = truthy(raw); break;
      case 'dim_color': d.dimColor = raw; break;
      case 'colorbar': d.colorbar = truthy(raw); break;
      case 'cblabel': d.colorbarLabel = raw; break;
      case 'novalue': d.novalueColor = raw; break;
    }
  }
  return d;
}

/**
 * Expand a focus spec into a matcher. Accepts 1-based indices, inclusive ranges
 * and element symbols, e.g. `focus=1,4-7,Fe`.
 */
function makeFocusMatcher(spec: string): (index1: number, symbol: string) => boolean {
  const indices = new Set<number>();
  const symbols = new Set<string>();
  for (const part of spec.split(/[,\s]+/).filter(Boolean)) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const lo = parseInt(range[1], 10);
      const hi = parseInt(range[2], 10);
      for (let i = Math.min(lo, hi); i <= Math.max(lo, hi); i++) indices.add(i);
    } else if (/^\d+$/.test(part)) {
      indices.add(parseInt(part, 10));
    } else {
      symbols.add(part.toLowerCase());
    }
  }
  return (index1, symbol) => indices.has(index1) || symbols.has(symbol.toLowerCase());
}

/**
 * Parse a simple XYZ file (single frame).
 * Format:
 *   <nAtoms>
 *   <comment line>
 *   Symbol x y z   (Angstrom, one atom per line)
 *   ...
 * Extra columns after z (charges, vectors, etc.) are ignored, unless the comment
 * line carries display directives — see parseDirectives / docs/annotated-xyz.md,
 * in which case a 5th column is read as a scalar value (or a literal #RRGGBB color).
 */
export function parseXYZ(text: string): { atoms: Atom[]; annotation: XYZAnnotation | null } {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) throw new Error('XYZ file too short');

  const nAtoms = parseInt(lines[0].trim(), 10);
  if (!Number.isFinite(nAtoms) || nAtoms <= 0) {
    throw new Error('Invalid atom count on line 1');
  }

  const directives = parseDirectives(lines[1] ?? '');
  const atoms: Atom[] = [];
  for (let i = 0; i < nAtoms; i++) {
    const line = lines[2 + i];
    if (line === undefined) throw new Error(`Missing atom line at index ${i}`);
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) throw new Error(`Malformed atom line: "${line}"`);

    let symbol = parts[0];
    let atomicNumber: number;
    // Support either element symbol (e.g. "C") or atomic number ("6")
    const asNumber = parseInt(symbol, 10);
    if (Number.isFinite(asNumber) && String(asNumber) === symbol) {
      atomicNumber = asNumber;
      symbol = Object.keys(ATOMIC_NUMBERS).find(s => ATOMIC_NUMBERS[s] === asNumber) ?? symbol;
    } else {
      const norm = symbol.charAt(0).toUpperCase() + symbol.slice(1).toLowerCase();
      atomicNumber = ATOMIC_NUMBERS[norm] ?? 0;
      symbol = norm;
    }

    const atom: Atom = {
      symbol,
      index: i + 1,
      atomicNumber,
      position: {
        x: parseFloat(parts[1]),
        y: parseFloat(parts[2]),
        z: parseFloat(parts[3]),
      },
    };

    // 5th column: scalar value, or a literal color
    if (directives && parts.length >= 5) {
      const col = parts[4];
      if (/^#[0-9A-Fa-f]{6}$/.test(col)) {
        atom.colorOverride = col;
      } else {
        const v = parseFloat(col);
        if (Number.isFinite(v)) atom.scalarValue = v;
      }
    }

    atoms.push(atom);
  }

  if (!directives) return { atoms, annotation: null };
  return { atoms, annotation: applyDirectives(atoms, directives) };
}

/** Resolve colors + focus emphasis onto the atoms, and return the display annotation. */
function applyDirectives(atoms: Atom[], d: Directives): XYZAnnotation {
  const values = atoms
    .map(a => a.scalarValue)
    .filter((v): v is number => v !== undefined);
  const hasValues = values.length > 0;

  // Auto-range from the data unless the file pins vmin/vmax
  const vmin = d.vmin !== undefined && Number.isFinite(d.vmin)
    ? d.vmin
    : (hasValues ? Math.min(...values) : 0);
  const vmax = d.vmax !== undefined && Number.isFinite(d.vmax)
    ? d.vmax
    : (hasValues ? Math.max(...values) : 1);
  const span = vmax - vmin;

  const cmap = d.cmap && isColormap(d.cmap) ? d.cmap : 'viridis';
  if (d.cmap && !isColormap(d.cmap)) {
    console.warn(`Unknown colormap "${d.cmap}" — falling back to viridis`);
  }

  for (const a of atoms) {
    if (a.scalarValue !== undefined && a.colorOverride === undefined) {
      const t = span === 0 ? 0.5 : (a.scalarValue - vmin) / span;
      a.colorOverride = sampleColormap(cmap, t);
    } else if (a.scalarValue === undefined && d.novalueColor && a.colorOverride === undefined) {
      a.colorOverride = d.novalueColor;
    }
  }

  if (d.focus) {
    const matches = makeFocusMatcher(d.focus);
    for (const a of atoms) {
      if (!matches(a.index, a.symbol)) {
        a.emphasis = d.focusMode;
        if (d.focusMode === 'dim') a.colorOverride = d.dimColor;
      }
    }
  }

  return {
    hasValues,
    cmap,
    vmin,
    vmax,
    colorbar: d.colorbar && hasValues,
    colorbarLabel: d.colorbarLabel,
    focusZoom: d.focusZoom && !!d.focus,
  };
}
