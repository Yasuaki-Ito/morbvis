import type { Atom } from '../types';

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

/**
 * Parse a simple XYZ file (single frame).
 * Format:
 *   <nAtoms>
 *   <comment line>
 *   Symbol x y z   (Angstrom, one atom per line)
 *   ...
 * Extra columns after z (charges, vectors, etc.) are ignored.
 */
export function parseXYZ(text: string): { atoms: Atom[] } {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) throw new Error('XYZ file too short');

  const nAtoms = parseInt(lines[0].trim(), 10);
  if (!Number.isFinite(nAtoms) || nAtoms <= 0) {
    throw new Error('Invalid atom count on line 1');
  }

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

    atoms.push({
      symbol,
      index: i + 1,
      atomicNumber,
      position: {
        x: parseFloat(parts[1]),
        y: parseFloat(parts[2]),
        z: parseFloat(parts[3]),
      },
    });
  }

  return { atoms };
}
