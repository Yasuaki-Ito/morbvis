import type { MolecularOrbital } from '../types';

export interface MOLabels {
  /** e.g. "HOMO-1", or "HOMO-1 (β)" for unrestricted */
  labels: string[];
  /** compact form for the energy diagram, e.g. "H-1" / "H-1β" */
  shortLabels: string[];
  /** global index of the HOMO of each spin (-1 if that spin has no occupied MO) */
  homoIndices: number[];
  /** global index of the LUMO of each spin (-1 if that spin has no virtual MO) */
  lumoIndices: number[];
  isUnrestricted: boolean;
}

const isBeta = (mo: MolecularOrbital) => mo.spin === 'Beta';

/**
 * Build HOMO/LUMO labels. Alpha and beta manifolds are numbered independently:
 * in an unrestricted calculation each spin has its own HOMO and LUMO.
 */
export function computeMOLabels(orbitals: MolecularOrbital[]): MOLabels {
  const labels = new Array<string>(orbitals.length).fill('');
  const shortLabels = new Array<string>(orbitals.length).fill('');
  const homoIndices: number[] = [];
  const lumoIndices: number[] = [];

  const alpha: number[] = [];
  const beta: number[] = [];
  orbitals.forEach((mo, i) => (isBeta(mo) ? beta : alpha).push(i));
  const isUnrestricted = alpha.length > 0 && beta.length > 0;

  for (const group of [alpha, beta]) {
    if (group.length === 0) continue;
    const suffix = isUnrestricted ? (isBeta(orbitals[group[0]]) ? 'β' : 'α') : '';

    // Order within the spin manifold by energy (Molden usually already is)
    const ordered = [...group].sort((a, b) => orbitals[a].energy - orbitals[b].energy);

    let homoPos = -1;
    for (let p = ordered.length - 1; p >= 0; p--) {
      if (orbitals[ordered[p]].occupation > 0) { homoPos = p; break; }
    }
    homoIndices.push(homoPos >= 0 ? ordered[homoPos] : -1);
    lumoIndices.push(homoPos + 1 < ordered.length ? ordered[homoPos + 1] : -1);

    ordered.forEach((idx, p) => {
      let base: string;
      let short: string;
      if (p === homoPos) { base = 'HOMO'; short = 'H'; }
      else if (p === homoPos + 1) { base = 'LUMO'; short = 'L'; }
      else if (p < homoPos) { base = `HOMO-${homoPos - p}`; short = `H-${homoPos - p}`; }
      else { base = `LUMO+${p - homoPos - 1}`; short = `L+${p - homoPos - 1}`; }
      labels[idx] = suffix ? `${base} (${suffix})` : base;
      shortLabels[idx] = suffix ? `${short}${suffix}` : short;
    });
  }

  return { labels, shortLabels, homoIndices, lumoIndices, isUnrestricted };
}

/** Highest-energy occupied MO over all spins (used as the default selection). */
export function findHomoIndex(orbitals: MolecularOrbital[]): number {
  let best = -1;
  orbitals.forEach((mo, i) => {
    if (mo.occupation > 0 && (best < 0 || mo.energy > orbitals[best].energy)) best = i;
  });
  return best;
}
