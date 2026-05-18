import type { Atom, Vec3 } from '../types';

/** Oriented plane: origin point + orthonormal frame (u, v, normal). */
export interface OrientedPlane {
  origin: Vec3;   // a point on the plane (centroid of the 3 atoms)
  normal: Vec3;   // unit normal
  u: Vec3;        // unit in-plane basis vector
  v: Vec3;        // unit in-plane basis vector (= normal × u)
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });

/**
 * Build an oriented plane from 2 atom indices: the connecting vector (b - a) is the plane
 * normal, and the plane passes through the midpoint of a and b.
 * Returns null if atoms are missing or coincident.
 */
export function planeFromBond(atoms: Atom[], atomIndices: number[]): OrientedPlane | null {
  if (atomIndices.length !== 2) return null;
  const found = atomIndices.map((idx) => atoms.find((a) => a.index === idx));
  if (found.some((a) => a === undefined)) return null;
  const [a, b] = found as Atom[];

  const ab = sub(b.position, a.position);
  const abLen = norm(ab);
  if (abLen < 1e-9) return null;

  const normal = scale(ab, 1 / abLen);

  // Build an arbitrary in-plane reference (not parallel to normal)
  const refVec: Vec3 = Math.abs(normal.x) > 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const uRaw = cross(normal, refVec);
  const uLen = norm(uRaw);
  if (uLen < 1e-9) return null;
  const u = scale(uRaw, 1 / uLen);
  const v = cross(normal, u);

  const origin: Vec3 = {
    x: (a.position.x + b.position.x) / 2,
    y: (a.position.y + b.position.y) / 2,
    z: (a.position.z + b.position.z) / 2,
  };

  return { origin, normal, u, v };
}

/**
 * Build an oriented plane from 3 atom indices (Molden-style 1-based).
 * Returns null if any atom is missing, indices are degenerate, or the 3 points are collinear.
 */
export function planeFromAtoms(atoms: Atom[], atomIndices: number[]): OrientedPlane | null {
  if (atomIndices.length !== 3) return null;
  const found = atomIndices.map((idx) => atoms.find((a) => a.index === idx));
  if (found.some((a) => a === undefined)) return null;
  const [a, b, c] = found as Atom[];

  const ab = sub(b.position, a.position);
  const ac = sub(c.position, a.position);
  const n = cross(ab, ac);
  const nLen = norm(n);
  if (nLen < 1e-9) return null; // collinear

  const normal = scale(n, 1 / nLen);

  // u = normalized (b - a)
  const abLen = norm(ab);
  if (abLen < 1e-9) return null;
  const u = scale(ab, 1 / abLen);

  // v = normal × u (already unit length since both are unit and orthogonal)
  const v = cross(normal, u);

  // Origin = centroid
  const origin: Vec3 = {
    x: (a.position.x + b.position.x + c.position.x) / 3,
    y: (a.position.y + b.position.y + c.position.y) / 3,
    z: (a.position.z + b.position.z + c.position.z) / 3,
  };

  return { origin, normal, u, v };
}
