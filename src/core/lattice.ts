import type {
  Atom,
  ContractedShell,
  Grid3D,
  IsosurfaceMesh,
  LatticeVectors,
  Vec3,
} from '../types';
import { basisCountForShell } from './basisFunctions';

/**
 * Periodic-system (PBC) core: lattice math, image-cell enumeration and
 * shell/coefficient expansion for lattice-summed evaluation.
 *
 * Strategy: the crystal orbital
 *   psi_nk(r) = sum_mu C_mu_n(k) sum_T e^{ik.T} chi_mu(r - tau_mu - T)
 * is evaluated by REUSING the existing molecular evaluators (CPU / Worker / GPU)
 * on an expanded shell list (one copy of each shell per relevant image cell T)
 * with an expanded real coefficient vector:
 *   - Gamma point (k=0, real C): coefficients are tiled per image.
 *   - General k: Re(psi) and Im(psi) are each a real linear combination with
 *     coefficients Re(C e^{ik.T}) and Im(C e^{ik.T}) — two real evaluations.
 */

const BOHR_TO_ANG = 0.529177249;

// =============================================
// Basic lattice math
// =============================================

/** T = n1 a1 + n2 a2 + n3 a3 (Angstrom) */
export function latticeTranslation(cell: LatticeVectors, n1: number, n2: number, n3: number): Vec3 {
  return {
    x: n1 * cell.a1.x + n2 * cell.a2.x + n3 * cell.a3.x,
    y: n1 * cell.a1.y + n2 * cell.a2.y + n3 * cell.a3.y,
    z: n1 * cell.a1.z + n2 * cell.a2.z + n3 * cell.a3.z,
  };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function norm(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

/** Signed cell volume |a1 . (a2 x a3)| (Angstrom^3) */
export function cellVolume(cell: LatticeVectors): number {
  return Math.abs(dot(cell.a1, cross(cell.a2, cell.a3)));
}

/** Perpendicular cell heights along a/b/c (distance between opposite faces, Angstrom) */
export function cellHeights(cell: LatticeVectors): [number, number, number] {
  const vol = cellVolume(cell);
  return [
    vol / norm(cross(cell.a2, cell.a3)),
    vol / norm(cross(cell.a3, cell.a1)),
    vol / norm(cross(cell.a1, cell.a2)),
  ];
}

/**
 * Fractional coordinates of a Cartesian point: p = f1 a1 + f2 a2 + f3 a3.
 * Uses the inverse of the row-vector matrix M (rows = a1,a2,a3).
 */
export function fractionalCoords(cell: LatticeVectors, p: Vec3): [number, number, number] {
  const m = [
    [cell.a1.x, cell.a1.y, cell.a1.z],
    [cell.a2.x, cell.a2.y, cell.a2.z],
    [cell.a3.x, cell.a3.y, cell.a3.z],
  ];
  const det =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  if (Math.abs(det) < 1e-12) throw new Error('Singular lattice matrix');
  // inv[j][i] = cofactor / det, for f = p . M^{-1}
  const inv = [
    [
      (m[1][1] * m[2][2] - m[1][2] * m[2][1]) / det,
      (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / det,
      (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / det,
    ],
    [
      (m[1][2] * m[2][0] - m[1][0] * m[2][2]) / det,
      (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / det,
      (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / det,
    ],
    [
      (m[1][0] * m[2][1] - m[1][1] * m[2][0]) / det,
      (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / det,
      (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / det,
    ],
  ];
  const pv = [p.x, p.y, p.z];
  const f: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    let s = 0;
    for (let j = 0; j < 3; j++) s += pv[j] * inv[j][i];
    f[i] = s;
  }
  return f;
}

// =============================================
// Display helpers: supercell atoms & cell wireframe
// =============================================

/** Fractional tolerance for "this atom sits on the cell boundary" */
const BOUNDARY_EPS = 1e-3;

/**
 * Replicate atoms over an na x nb x nc supercell for display.
 *
 * With includeBoundary (crystal-viewer convention, cf. VESTA): atoms lying on a
 * boundary of the displayed supercell are also drawn on the opposite face/edge/
 * corner, so e.g. a corner atom of a conventional cell appears at all 8 corners
 * instead of the cell looking lopsided toward the origin.
 *
 * The home copy (T = 0) keeps its original index; image atoms get fresh unique
 * indices past the original range so picking/measurement still work.
 */
export function replicateAtoms(
  atoms: Atom[],
  cell: LatticeVectors,
  repeats: [number, number, number],
  periodic: [boolean, boolean, boolean] = [true, true, true],
  includeBoundary: boolean = true,
): Atom[] {
  const result: Atom[] = [];
  let imageCounter = 0;
  for (const a of atoms) {
    const f = fractionalCoords(cell, a.position);
    // Per-direction lattice shifts placing this atom inside (or on the surface
    // of) the displayed supercell [0, repeats].
    const shifts: number[][] = [[], [], []];
    for (let d = 0; d < 3; d++) {
      if (!periodic[d]) {
        shifts[d].push(0);
        continue;
      }
      if (!includeBoundary) {
        for (let n = 0; n < repeats[d]; n++) shifts[d].push(n);
        continue;
      }
      for (let n = -1; n <= repeats[d]; n++) {
        const t = f[d] + n;
        if (t >= -BOUNDARY_EPS && t <= repeats[d] + BOUNDARY_EPS) shifts[d].push(n);
      }
    }
    for (const n1 of shifts[0]) {
      for (const n2 of shifts[1]) {
        for (const n3 of shifts[2]) {
          const isHome = n1 === 0 && n2 === 0 && n3 === 0;
          if (isHome) {
            result.push(a);
            continue;
          }
          const T = latticeTranslation(cell, n1, n2, n3);
          result.push({
            ...a,
            index: atoms.length + (++imageCounter),
            position: { x: a.position.x + T.x, y: a.position.y + T.y, z: a.position.z + T.z },
          });
        }
      }
    }
  }
  return result;
}

/**
 * Wireframe edges of every unit cell in the na x nb x nc supercell
 * (deduplicated shared edges). Cell origin is assumed at (0,0,0).
 */
export function supercellEdges(
  cell: LatticeVectors,
  repeats: [number, number, number],
): [Vec3, Vec3][] {
  const [na, nb, nc] = repeats;
  const seen = new Set<string>();
  const edges: [Vec3, Vec3][] = [];
  const corner = (i: number, j: number, k: number): Vec3 => latticeTranslation(cell, i, j, k);
  const key = (a: [number, number, number], b: [number, number, number]) =>
    `${a.join(',')}|${b.join(',')}`;
  const addEdge = (a: [number, number, number], b: [number, number, number]) => {
    const ka = key(a, b);
    const kb = key(b, a);
    if (seen.has(ka) || seen.has(kb)) return;
    seen.add(ka);
    edges.push([corner(...a), corner(...b)]);
  };
  for (let i = 0; i < na; i++) {
    for (let j = 0; j < nb; j++) {
      for (let k = 0; k < nc; k++) {
        // 12 edges of cell (i,j,k)
        const c = [
          [i, j, k], [i + 1, j, k], [i, j + 1, k], [i, j, k + 1],
          [i + 1, j + 1, k], [i + 1, j, k + 1], [i, j + 1, k + 1], [i + 1, j + 1, k + 1],
        ] as [number, number, number][];
        addEdge(c[0], c[1]); addEdge(c[0], c[2]); addEdge(c[0], c[3]);
        addEdge(c[1], c[4]); addEdge(c[1], c[5]);
        addEdge(c[2], c[4]); addEdge(c[2], c[6]);
        addEdge(c[3], c[5]); addEdge(c[3], c[6]);
        addEdge(c[4], c[7]); addEdge(c[5], c[7]); addEdge(c[6], c[7]);
      }
    }
  }
  return edges;
}

// =============================================
// Grid generation for periodic systems
// =============================================

/**
 * Grid covering the displayed na x nb x nc supercell (AABB of the parallelepiped,
 * anchored at the origin). Same spacing convention as autoGrid: gridPoints along
 * the longest axis.
 */
export function periodicAutoGrid(
  cell: LatticeVectors,
  repeats: [number, number, number],
  gridPoints: number = 60,
  margin: number = 0.0,
): Grid3D {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i <= 1; i++) {
    for (let j = 0; j <= 1; j++) {
      for (let k = 0; k <= 1; k++) {
        const p = latticeTranslation(cell, i * repeats[0], j * repeats[1], k * repeats[2]);
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
      }
    }
  }
  minX -= margin; minY -= margin; minZ -= margin;
  maxX += margin; maxY += margin; maxZ += margin;

  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  const rangeZ = maxZ - minZ;
  const maxRange = Math.max(rangeX, rangeY, rangeZ);
  const spacing = maxRange / (gridPoints - 1);
  const nx = Math.max(2, Math.ceil(rangeX / spacing) + 1);
  const ny = Math.max(2, Math.ceil(rangeY / spacing) + 1);
  const nz = Math.max(2, Math.ceil(rangeZ / spacing) + 1);

  return { origin: { x: minX, y: minY, z: minZ }, size: { x: nx, y: ny, z: nz }, spacing };
}

// =============================================
// Image-cell enumeration + shell expansion
// =============================================

export interface PBCExpansion {
  /** Image-expanded shells: feed directly to the existing evaluators */
  shells: ContractedShell[];
  /** For each expanded shell: source shell index + image cell integers n */
  entries: { shellIndex: number; n: [number, number, number] }[];
  /** Number of candidate image cells examined */
  nImages: number;
  /** True when the safety cap kicked in (result incomplete) */
  truncated: boolean;
}

/**
 * Decay radius of a contracted shell in Angstrom: distance beyond which the
 * most diffuse primitive has fallen below ~1e-8, plus a margin for the
 * polynomial prefactor of higher angular momenta.
 */
export function shellDecayRadiusAng(shell: ContractedShell): number {
  let alphaMin = Infinity;
  for (const prim of shell.primitives) {
    if (prim.exponent < alphaMin) alphaMin = prim.exponent;
  }
  if (!Number.isFinite(alphaMin) || alphaMin <= 0) return 10;
  const LN_INV_EPS = Math.log(1e8); // epsilon = 1e-8
  const rBohr = Math.sqrt(LN_INV_EPS / alphaMin);
  return rBohr * BOHR_TO_ANG + 1.0;
}

/** Squared distance from a point to an axis-aligned box */
function distSqToBox(
  p: Vec3,
  min: Vec3,
  max: Vec3,
): number {
  const dx = p.x < min.x ? min.x - p.x : p.x > max.x ? p.x - max.x : 0;
  const dy = p.y < min.y ? min.y - p.y : p.y > max.y ? p.y - max.y : 0;
  const dz = p.z < min.z ? min.z - p.z : p.z > max.z ? p.z - max.z : 0;
  return dx * dx + dy * dy + dz * dz;
}

/** Hard cap on expanded shell count (safety against pathological diffuse bases) */
const MAX_EXPANDED_SHELLS = 250000;

/**
 * Enumerate the image cells T whose basis functions reach the grid, and build
 * the expanded shell list. Per-shell decay radii are used, so only diffuse
 * shells get far images.
 */
export function buildPBCExpansion(
  shells: ContractedShell[],
  cell: LatticeVectors,
  periodic: [boolean, boolean, boolean],
  grid: Grid3D,
): PBCExpansion {
  const gridMin: Vec3 = { ...grid.origin };
  const gridMax: Vec3 = {
    x: grid.origin.x + (grid.size.x - 1) * grid.spacing,
    y: grid.origin.y + (grid.size.y - 1) * grid.spacing,
    z: grid.origin.z + (grid.size.z - 1) * grid.spacing,
  };

  const rcuts = shells.map(shellDecayRadiusAng);
  const rmax = Math.max(...rcuts, 0);
  const heights = cellHeights(cell);

  // Fractional bounds of the grid AABB corners and of the shell centers
  const fminG = [Infinity, Infinity, Infinity];
  const fmaxG = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i <= 1; i++) {
    for (let j = 0; j <= 1; j++) {
      for (let k = 0; k <= 1; k++) {
        const f = fractionalCoords(cell, {
          x: i === 0 ? gridMin.x : gridMax.x,
          y: j === 0 ? gridMin.y : gridMax.y,
          z: k === 0 ? gridMin.z : gridMax.z,
        });
        for (let d = 0; d < 3; d++) {
          if (f[d] < fminG[d]) fminG[d] = f[d];
          if (f[d] > fmaxG[d]) fmaxG[d] = f[d];
        }
      }
    }
  }
  const fminC = [Infinity, Infinity, Infinity];
  const fmaxC = [-Infinity, -Infinity, -Infinity];
  for (const s of shells) {
    const f = fractionalCoords(cell, s.center);
    for (let d = 0; d < 3; d++) {
      if (f[d] < fminC[d]) fminC[d] = f[d];
      if (f[d] > fmaxC[d]) fmaxC[d] = f[d];
    }
  }

  const nLo: number[] = [0, 0, 0];
  const nHi: number[] = [0, 0, 0];
  for (let d = 0; d < 3; d++) {
    if (!periodic[d]) continue; // slab/wire: no images along non-periodic directions
    const marginFrac = rmax / heights[d];
    nLo[d] = Math.floor(fminG[d] - fmaxC[d] - marginFrac);
    nHi[d] = Math.ceil(fmaxG[d] - fminC[d] + marginFrac);
  }

  const expanded: ContractedShell[] = [];
  const entries: { shellIndex: number; n: [number, number, number] }[] = [];
  let nImages = 0;
  let truncated = false;

  outer:
  for (let n1 = nLo[0]; n1 <= nHi[0]; n1++) {
    for (let n2 = nLo[1]; n2 <= nHi[1]; n2++) {
      for (let n3 = nLo[2]; n3 <= nHi[2]; n3++) {
        nImages++;
        const T = latticeTranslation(cell, n1, n2, n3);
        for (let s = 0; s < shells.length; s++) {
          const shell = shells[s];
          const c: Vec3 = {
            x: shell.center.x + T.x,
            y: shell.center.y + T.y,
            z: shell.center.z + T.z,
          };
          if (distSqToBox(c, gridMin, gridMax) > rcuts[s] * rcuts[s]) continue;
          expanded.push({ ...shell, center: c });
          entries.push({ shellIndex: s, n: [n1, n2, n3] });
          if (expanded.length >= MAX_EXPANDED_SHELLS) {
            truncated = true;
            break outer;
          }
        }
      }
    }
  }

  return { shells: expanded, entries, nImages, truncated };
}

// =============================================
// Coefficient expansion (Gamma / general k)
// =============================================

/** Basis-function offset of each shell in the original AO ordering */
export function shellBasisOffsets(
  shells: ContractedShell[],
  useSphericalD: boolean,
  useSphericalF: boolean,
  useSphericalG: boolean,
): { offsets: number[]; counts: number[] } {
  const offsets: number[] = [];
  const counts: number[] = [];
  let off = 0;
  for (const shell of shells) {
    const spherical =
      (shell.shellType === 'd' && useSphericalD) ||
      (shell.shellType === 'f' && useSphericalF) ||
      (shell.shellType === 'g' && useSphericalG);
    const cnt = basisCountForShell(shell.shellType, spherical);
    offsets.push(off);
    counts.push(cnt);
    off += cnt;
  }
  return { offsets, counts };
}

/**
 * Build the expanded real coefficient vector(s) matching a PBCExpansion.
 *
 * - kFrac omitted (Gamma, real C): returns { re } with coefficients tiled per image.
 * - kFrac given: theta = 2*pi*(k . n) per image;
 *     re = Re(C) cos(theta) - Im(C) sin(theta)   -> evaluates Re(psi)
 *     im = Re(C) sin(theta) + Im(C) cos(theta)   -> evaluates Im(psi)
 */
export function expandCoefficients(
  expansion: PBCExpansion,
  origShells: ContractedShell[],
  useSphericalD: boolean,
  useSphericalF: boolean,
  useSphericalG: boolean,
  coeffRe: number[],
  coeffIm?: number[] | null,
  kFrac?: [number, number, number] | null,
): { re: number[]; im: number[] | null } {
  const { offsets, counts } = shellBasisOffsets(origShells, useSphericalD, useSphericalF, useSphericalG);
  const complex = kFrac != null;
  const re: number[] = [];
  const im: number[] | null = complex ? [] : null;

  for (const entry of expansion.entries) {
    const off = offsets[entry.shellIndex];
    const cnt = counts[entry.shellIndex];
    if (!complex) {
      for (let j = 0; j < cnt; j++) re.push(coeffRe[off + j] ?? 0);
      continue;
    }
    const theta = 2 * Math.PI * (
      kFrac![0] * entry.n[0] + kFrac![1] * entry.n[1] + kFrac![2] * entry.n[2]
    );
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    for (let j = 0; j < cnt; j++) {
      const cr = coeffRe[off + j] ?? 0;
      const ci = coeffIm?.[off + j] ?? 0;
      re.push(cr * cos - ci * sin);
      im!.push(cr * sin + ci * cos);
    }
  }
  return { re, im };
}

// =============================================
// Complex-field helpers (|psi| isosurface + phase coloring)
// =============================================

/** |psi| field from Re/Im fields */
export function magnitudeField(re: Float64Array, im: Float64Array): Float64Array {
  const out = new Float64Array(re.length);
  for (let i = 0; i < re.length; i++) {
    out[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }
  return out;
}

/** Trilinear interpolation of a scalar field at a Cartesian point */
function sampleField(field: Float64Array, grid: Grid3D, x: number, y: number, z: number): number {
  const nx = grid.size.x, ny = grid.size.y, nz = grid.size.z;
  const fx = (x - grid.origin.x) / grid.spacing;
  const fy = (y - grid.origin.y) / grid.spacing;
  const fz = (z - grid.origin.z) / grid.spacing;
  const ix = Math.max(0, Math.min(nx - 2, Math.floor(fx)));
  const iy = Math.max(0, Math.min(ny - 2, Math.floor(fy)));
  const iz = Math.max(0, Math.min(nz - 2, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - ix));
  const ty = Math.max(0, Math.min(1, fy - iy));
  const tz = Math.max(0, Math.min(1, fz - iz));
  const idx = (i: number, j: number, k: number) => field[k * ny * nx + j * nx + i];
  const c00 = idx(ix, iy, iz) * (1 - tx) + idx(ix + 1, iy, iz) * tx;
  const c10 = idx(ix, iy + 1, iz) * (1 - tx) + idx(ix + 1, iy + 1, iz) * tx;
  const c01 = idx(ix, iy, iz + 1) * (1 - tx) + idx(ix + 1, iy, iz + 1) * tx;
  const c11 = idx(ix, iy + 1, iz + 1) * (1 - tx) + idx(ix + 1, iy + 1, iz + 1) * tx;
  const c0 = c00 * (1 - ty) + c10 * ty;
  const c1 = c01 * (1 - ty) + c11 * ty;
  return c0 * (1 - tz) + c1 * tz;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

/**
 * Per-vertex phase colors arg(psi) for a |psi| isosurface mesh.
 * Hue: arg(psi) mapped over the full color circle (0 -> red, pi/2 -> green-ish, pi -> cyan, ...).
 */
export function phaseColorsForMesh(
  mesh: IsosurfaceMesh,
  reField: Float64Array,
  imField: Float64Array,
  grid: Grid3D,
): Float32Array {
  const nVerts = mesh.vertices.length / 3;
  const colors = new Float32Array(mesh.vertices.length);
  for (let v = 0; v < nVerts; v++) {
    const x = mesh.vertices[3 * v];
    const y = mesh.vertices[3 * v + 1];
    const z = mesh.vertices[3 * v + 2];
    const reVal = sampleField(reField, grid, x, y, z);
    const imVal = sampleField(imField, grid, x, y, z);
    const hue = (Math.atan2(imVal, reVal) * 180) / Math.PI; // -180..180
    const [r, g, b] = hslToRgb(hue, 0.85, 0.55);
    colors[3 * v] = r;
    colors[3 * v + 1] = g;
    colors[3 * v + 2] = b;
  }
  return colors;
}
