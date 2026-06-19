import type { Atom, ContractedShell, ShellType } from '../types';

export interface AOLabel {
  /** Index into the MO coefficient vector (0-based). */
  basisIndex: number;
  /** Molden 1-based atom index. */
  atomIndex: number;
  /** Element symbol (e.g., "C"). */
  atomSymbol: string;
  /** Shell type (s/p/d/f/g). */
  shellType: ShellType;
  /** Per-shell component index (0..countForShell-1). */
  componentIndex: number;
  /** Whether the shell uses spherical harmonics. */
  spherical: boolean;
  /** Short component label, e.g., "s", "px", "dxy", "dz²". */
  componentLabel: string;
  /** Human-readable combined label, e.g., "C₁ 2pz" (we omit principal quantum number for now). */
  fullLabel: string;
}

/** Component labels per shell type, in Molden order. */
const S_COMPONENTS = ['s'];
const P_COMPONENTS = ['px', 'py', 'pz'];
const D_CART = ['dxx', 'dyy', 'dzz', 'dxy', 'dxz', 'dyz'];
const D_SPH = ['dz²', 'dxz', 'dyz', 'dx²-y²', 'dxy']; // d0, d+1, d-1, d+2, d-2
const F_CART = ['fxxx', 'fyyy', 'fzzz', 'fxyy', 'fxxy', 'fxxz', 'fxzz', 'fyzz', 'fyyz', 'fxyz'];
const F_SPH = ['fz³', 'fxz²', 'fyz²', 'fz(x²-y²)', 'fxyz', 'fx(x²-3y²)', 'fy(3x²-y²)'];
const G_CART = [
  'gxxxx', 'gyyyy', 'gzzzz',
  'gxxxy', 'gxxxz', 'gxyyy', 'gyyyz', 'gxzzz', 'gyzzz',
  'gxxyy', 'gxxzz', 'gyyzz',
  'gxxyz', 'gxyyz', 'gxyzz',
];
const G_SPH = [
  'gz⁴', 'gxz³', 'gyz³', 'gz²(x²-y²)', 'gxyz²',
  'gxz(x²-3y²)', 'gyz(3x²-y²)', 'g(x⁴-6x²y²+y⁴)', 'gxy(x²-y²)',
];

function componentLabels(shellType: ShellType, spherical: boolean): string[] {
  switch (shellType) {
    case 's': return S_COMPONENTS;
    case 'p': return P_COMPONENTS;
    case 'd': return spherical ? D_SPH : D_CART;
    case 'f': return spherical ? F_SPH : F_CART;
    case 'g': return spherical ? G_SPH : G_CART;
  }
}

/** Subscript a digit (e.g., 1 → "₁"). Multi-digit indices are concatenated subscripts. */
function subscript(n: number): string {
  const map = '₀₁₂₃₄₅₆₇₈₉';
  return String(n).split('').map((d) => map[parseInt(d, 10)] ?? d).join('');
}

/** Minimum principal quantum number for a given angular momentum: s→1, p→2, d→3, f→4, g→5 */
const MIN_N: Record<ShellType, number> = { s: 1, p: 2, d: 3, f: 4, g: 5 };

/**
 * Generate AO labels for every basis function in the given shells (Molden order).
 * The output `basisIndex` aligns 1:1 with the MO coefficient vector.
 *
 * Labels use the convention "{minN}{component}-{ord}" where:
 *   minN     = lowest principal quantum number for that angular momentum (1 for s, 2 for p, ...)
 *   ord      = 1-based ordinal within the atom (only appended when the atom has >1 shells of this l)
 * The "-{ord}" suffix makes it explicit that multiple shells of the same l (e.g., split-valence
 * inner / outer s on oxygen) are distinct basis-set entries rather than true different n.
 */
export function generateAOLabels(
  shells: ContractedShell[],
  atoms: Atom[],
  useSphericalD: boolean,
  useSphericalF: boolean,
  useSphericalG: boolean,
): AOLabel[] {
  // Pre-pass: how many shells of each angular momentum does each atom have?
  const totalPerType = new Map<string, number>();
  for (const shell of shells) {
    const key = `${shell.atomIndex}:${shell.shellType}`;
    totalPerType.set(key, (totalPerType.get(key) ?? 0) + 1);
  }

  const out: AOLabel[] = [];
  let basisIndex = 0;
  const shellOrdinal = new Map<string, number>();

  for (const shell of shells) {
    const spherical =
      (shell.shellType === 'd' && useSphericalD) ||
      (shell.shellType === 'f' && useSphericalF) ||
      (shell.shellType === 'g' && useSphericalG);
    const labels = componentLabels(shell.shellType, spherical);
    const atom = atoms.find((a) => a.index === shell.atomIndex);
    const atomSymbol = atom?.symbol ?? '?';

    const typeKey = `${shell.atomIndex}:${shell.shellType}`;
    const ord = (shellOrdinal.get(typeKey) ?? 0) + 1;
    shellOrdinal.set(typeKey, ord);
    const totalOfThisType = totalPerType.get(typeKey) ?? 1;
    const n = MIN_N[shell.shellType];

    for (let i = 0; i < labels.length; i++) {
      // baseLabel: "1s", "2px", "3dxy", "4fz³", "5gxxxx", ...
      const baseLabel = `${n}${labels[i]}`;
      // Only disambiguate when multiple shells of this angular momentum exist on the atom
      const componentLabel = totalOfThisType > 1 ? `${baseLabel}-${ord}` : baseLabel;
      out.push({
        basisIndex,
        atomIndex: shell.atomIndex,
        atomSymbol,
        shellType: shell.shellType,
        componentIndex: i,
        spherical,
        componentLabel,
        fullLabel: `${atomSymbol}${subscript(shell.atomIndex)} ${componentLabel}`,
      });
      basisIndex++;
    }
  }

  return out;
}
