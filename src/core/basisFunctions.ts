import type { ContractedShell, ShellType, Vec3 } from '../types';

/** Angstrom -> Bohr conversion factor (GTO exponents are always in Bohr^-2) */
const ANG_TO_BOHR = 1.0 / 0.529177249;

/**
 * Number of basis functions per angular momentum type
 */
export function basisCountForShell(type: ShellType, spherical: boolean): number {
  switch (type) {
    case 's': return 1;
    case 'p': return 3;
    case 'd': return spherical ? 5 : 6;
    case 'f': return spherical ? 7 : 10;
  }
}

/**
 * Total basis function count across all shells
 */
export function totalBasisCount(
  shells: ContractedShell[],
  useSphericalD: boolean,
  useSphericalF: boolean,
): number {
  let count = 0;
  for (const shell of shells) {
    const spherical =
      (shell.shellType === 'd' && useSphericalD) ||
      (shell.shellType === 'f' && useSphericalF);
    count += basisCountForShell(shell.shellType, spherical);
  }
  return count;
}

// =============================================
// Primitive Gaussian normalization coefficients
// =============================================

/**
 * Double factorial: (2n-1)!! = 1*3*5*...*(2n-1)
 */
function doubleFactorial(n: number): number {
  if (n <= 0) return 1;
  let result = 1;
  for (let i = n; i >= 1; i -= 2) {
    result *= i;
  }
  return result;
}

/**
 * Normalization coefficient for primitive Gaussian x^l * y^m * z^n * exp(-alpha*r^2)
 * N = (2*alpha/pi)^(3/4) * (4*alpha)^((l+m+n)/2) / sqrt((2l-1)!! * (2m-1)!! * (2n-1)!!)
 */
function primitiveNorm(alpha: number, l: number, m: number, n: number): number {
  const L = l + m + n;
  const norm = Math.pow(2 * alpha / Math.PI, 0.75) *
    Math.pow(4 * alpha, L / 2) /
    Math.sqrt(doubleFactorial(2 * l - 1) * doubleFactorial(2 * m - 1) * doubleFactorial(2 * n - 1));
  return norm;
}

// =============================================
// Evaluate all basis functions at point (x,y,z)
// =============================================

/**
 * Compute basis function values for all shells and store in result array
 * @returns values[basisIndex] = chi_mu(r)
 */
export function evaluateAllBasis(
  point: Vec3,
  shells: ContractedShell[],
  useSphericalD: boolean,
  useSphericalF: boolean,
  values: Float64Array,
): void {
  let idx = 0;

  for (const shell of shells) {
    // Convert coordinate differences from Angstrom to Bohr (GTO exponent alpha is in Bohr^-2)
    const dx = (point.x - shell.center.x) * ANG_TO_BOHR;
    const dy = (point.y - shell.center.y) * ANG_TO_BOHR;
    const dz = (point.z - shell.center.z) * ANG_TO_BOHR;
    const r2 = dx * dx + dy * dy + dz * dz;

    switch (shell.shellType) {
      case 's':
        values[idx++] = evaluateContractedS(shell, r2);
        break;
      case 'p':
        evaluateContractedP(shell, dx, dy, dz, r2, values, idx);
        idx += 3;
        break;
      case 'd':
        if (useSphericalD) {
          evaluateContractedDSpherical(shell, dx, dy, dz, r2, values, idx);
          idx += 5;
        } else {
          evaluateContractedDCartesian(shell, dx, dy, dz, r2, values, idx);
          idx += 6;
        }
        break;
      case 'f':
        if (useSphericalF) {
          evaluateContractedFSpherical(shell, dx, dy, dz, r2, values, idx);
          idx += 7;
        } else {
          evaluateContractedFCartesian(shell, dx, dy, dz, r2, values, idx);
          idx += 10;
        }
        break;
    }
  }
}

// =============================================
// s shell
// =============================================

function evaluateContractedS(shell: ContractedShell, r2: number): number {
  let value = 0;
  for (const prim of shell.primitives) {
    const N = primitiveNorm(prim.exponent, 0, 0, 0);
    value += prim.coefficient * N * Math.exp(-prim.exponent * r2);
  }
  return value;
}

// =============================================
// p shell: Molden order = x, y, z
// =============================================

function evaluateContractedP(
  shell: ContractedShell,
  dx: number, dy: number, dz: number, r2: number,
  values: Float64Array, offset: number,
): void {
  let radial = 0;
  for (const prim of shell.primitives) {
    const N = primitiveNorm(prim.exponent, 1, 0, 0);
    radial += prim.coefficient * N * Math.exp(-prim.exponent * r2);
  }
  values[offset]     = radial * dx; // px
  values[offset + 1] = radial * dy; // py
  values[offset + 2] = radial * dz; // pz
}

// =============================================
// d shell (Cartesian): Molden order = xx, yy, zz, xy, xz, yz
// =============================================

function evaluateContractedDCartesian(
  shell: ContractedShell,
  dx: number, dy: number, dz: number, r2: number,
  values: Float64Array, offset: number,
): void {
  // Different normalization for each angular momentum component
  let radialXX = 0, radialXY = 0;
  for (const prim of shell.primitives) {
    const exp_val = Math.exp(-prim.exponent * r2);
    const Nxx = primitiveNorm(prim.exponent, 2, 0, 0); // xx, yy, zz
    const Nxy = primitiveNorm(prim.exponent, 1, 1, 0); // xy, xz, yz
    radialXX += prim.coefficient * Nxx * exp_val;
    radialXY += prim.coefficient * Nxy * exp_val;
  }
  values[offset]     = radialXX * dx * dx; // xx
  values[offset + 1] = radialXX * dy * dy; // yy
  values[offset + 2] = radialXX * dz * dz; // zz
  values[offset + 3] = radialXY * dx * dy; // xy
  values[offset + 4] = radialXY * dx * dz; // xz
  values[offset + 5] = radialXY * dy * dz; // yz
}

// =============================================
// d shell (spherical harmonics, 5 components)
// Molden order: d0, d+1, d-1, d+2, d-2
// =============================================

function evaluateContractedDSpherical(
  shell: ContractedShell,
  dx: number, dy: number, dz: number, r2: number,
  values: Float64Array, offset: number,
): void {
  // First compute Cartesian d radial parts
  let radialXX = 0, radialXY = 0;
  for (const prim of shell.primitives) {
    const exp_val = Math.exp(-prim.exponent * r2);
    const Nxx = primitiveNorm(prim.exponent, 2, 0, 0);
    const Nxy = primitiveNorm(prim.exponent, 1, 1, 0);
    radialXX += prim.coefficient * Nxx * exp_val;
    radialXY += prim.coefficient * Nxy * exp_val;
  }

  const xx = radialXX * dx * dx;
  const yy = radialXX * dy * dy;
  const zz = radialXX * dz * dz;
  const xy = radialXY * dx * dy;
  const xz = radialXY * dx * dz;
  const yz = radialXY * dy * dz;

  // Cartesian -> spherical transformation (Molden convention)
  // d0  = (2zz - xx - yy) * normalization
  // d+1 = xz
  // d-1 = yz
  // d+2 = (xx - yy) * normalization
  // d-2 = xy

  // Scaling based on Nxx/Nxy ratio
  const s3 = Math.sqrt(3);
  values[offset]     = zz - 0.5 * (xx + yy); // d0:  (2zz - xx - yy) / 2 (includes Nxx)
  values[offset + 1] = s3 * xz;              // d+1: sqrt(3) * xz
  values[offset + 2] = s3 * yz;              // d-1: sqrt(3) * yz
  values[offset + 3] = s3 * 0.5 * (xx - yy); // d+2: sqrt(3)/2 * (xx - yy)
  values[offset + 4] = s3 * xy;              // d-2: sqrt(3) * xy
}

// =============================================
// f shell (Cartesian, 10 components)
// Molden order: xxx, yyy, zzz, xxy, xxz, xyy, yyz, xzz, yzz, xyz
// =============================================

function evaluateContractedFCartesian(
  shell: ContractedShell,
  dx: number, dy: number, dz: number, r2: number,
  values: Float64Array, offset: number,
): void {
  let radial300 = 0; // xxx, yyy, zzz type
  let radial210 = 0; // xxy, xxz, xyy, yyz, xzz, yzz type
  let radial111 = 0; // xyz type

  for (const prim of shell.primitives) {
    const exp_val = Math.exp(-prim.exponent * r2);
    radial300 += prim.coefficient * primitiveNorm(prim.exponent, 3, 0, 0) * exp_val;
    radial210 += prim.coefficient * primitiveNorm(prim.exponent, 2, 1, 0) * exp_val;
    radial111 += prim.coefficient * primitiveNorm(prim.exponent, 1, 1, 1) * exp_val;
  }

  values[offset]     = radial300 * dx * dx * dx; // xxx
  values[offset + 1] = radial300 * dy * dy * dy; // yyy
  values[offset + 2] = radial300 * dz * dz * dz; // zzz
  values[offset + 3] = radial210 * dx * dx * dy; // xxy
  values[offset + 4] = radial210 * dx * dx * dz; // xxz
  values[offset + 5] = radial210 * dx * dy * dy; // xyy
  values[offset + 6] = radial210 * dy * dy * dz; // yyz
  values[offset + 7] = radial210 * dx * dz * dz; // xzz
  values[offset + 8] = radial210 * dy * dz * dz; // yzz
  values[offset + 9] = radial111 * dx * dy * dz; // xyz
}

// =============================================
// f shell (spherical harmonics, 7 components)
// Molden order: f0, f+1, f-1, f+2, f-2, f+3, f-3
// =============================================

function evaluateContractedFSpherical(
  shell: ContractedShell,
  dx: number, dy: number, dz: number, r2: number,
  values: Float64Array, offset: number,
): void {
  // First compute Cartesian f components
  let radial300 = 0, radial210 = 0, radial111 = 0;
  for (const prim of shell.primitives) {
    const exp_val = Math.exp(-prim.exponent * r2);
    radial300 += prim.coefficient * primitiveNorm(prim.exponent, 3, 0, 0) * exp_val;
    radial210 += prim.coefficient * primitiveNorm(prim.exponent, 2, 1, 0) * exp_val;
    radial111 += prim.coefficient * primitiveNorm(prim.exponent, 1, 1, 1) * exp_val;
  }

  const xxx = radial300 * dx * dx * dx;
  const yyy = radial300 * dy * dy * dy;
  const zzz = radial300 * dz * dz * dz;
  const xxy = radial210 * dx * dx * dy;
  const xxz = radial210 * dx * dx * dz;
  const xyy = radial210 * dx * dy * dy;
  const yyz = radial210 * dy * dy * dz;
  const xzz = radial210 * dx * dz * dz;
  const yzz = radial210 * dy * dz * dz;
  const xyz = radial111 * dx * dy * dz;

  const r2val = dx * dx + dy * dy + dz * dz;
  const s5 = Math.sqrt(5);
  const s10 = Math.sqrt(10);
  const s15 = Math.sqrt(15);
  const s6 = Math.sqrt(6);

  // Spherical harmonic transformation (Molden / real solid harmonics)
  // f0   = z*(2zz - 3(xx+yy))/2 -> zzz - 3/2*(xxz + yyz)
  values[offset]     = zzz - 1.5 * (xxz + yyz);
  // f+1  = sqrt(6)/4 * x*(4zz - xx - yy) -> sqrt(6)/4 * (4*xzz - xxx - xyy)
  values[offset + 1] = s6 / 4 * (4 * xzz - xxx - xyy);
  // f-1  = sqrt(6)/4 * y*(4zz - xx - yy)
  values[offset + 2] = s6 / 4 * (4 * yzz - xxy - yyy);
  // f+2  = sqrt(15)/2 * z*(xx - yy)
  values[offset + 3] = s15 / 2 * (xxz - yyz);
  // f-2  = sqrt(15) * xyz
  values[offset + 4] = s15 * xyz;
  // f+3  = sqrt(10)/4 * x*(xx - 3yy)
  values[offset + 5] = s10 / 4 * (xxx - 3 * xyy);
  // f-3  = sqrt(10)/4 * y*(3xx - yy)
  values[offset + 6] = s10 / 4 * (3 * xxy - yyy);
}
