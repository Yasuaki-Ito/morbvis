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
    case 'g': return spherical ? 9 : 15;
  }
}

/**
 * Total basis function count across all shells
 */
export function totalBasisCount(
  shells: ContractedShell[],
  useSphericalD: boolean,
  useSphericalF: boolean,
  useSphericalG: boolean,
): number {
  let count = 0;
  for (const shell of shells) {
    const spherical =
      (shell.shellType === 'd' && useSphericalD) ||
      (shell.shellType === 'f' && useSphericalF) ||
      (shell.shellType === 'g' && useSphericalG);
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
  useSphericalG: boolean,
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
      case 'g':
        if (useSphericalG) {
          evaluateContractedGSpherical(shell, dx, dy, dz, r2, values, idx);
          idx += 9;
        } else {
          evaluateContractedGCartesian(shell, dx, dy, dz, r2, values, idx);
          idx += 15;
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
// Molden order: xxx, yyy, zzz, xyy, xxy, xxz, xzz, yzz, yyz, xyz
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
  values[offset + 3] = radial210 * dx * dy * dy; // xyy
  values[offset + 4] = radial210 * dx * dx * dy; // xxy
  values[offset + 5] = radial210 * dx * dx * dz; // xxz
  values[offset + 6] = radial210 * dx * dz * dz; // xzz
  values[offset + 7] = radial210 * dy * dz * dz; // yzz
  values[offset + 8] = radial210 * dy * dy * dz; // yyz
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

// =============================================
// g shell (Cartesian, 15 components)
// Molden order: xxxx, yyyy, zzzz, xxxy, xxxz, xyyy, yyyz, xzzz, yzzz,
//               xxyy, xxzz, yyzz, xxyz, xyyz, xyzz
// =============================================

function evaluateContractedGCartesian(
  shell: ContractedShell,
  dx: number, dy: number, dz: number, r2: number,
  values: Float64Array, offset: number,
): void {
  // Radial parts grouped by (l_x,l_y,l_z) normalization class
  let radial400 = 0; // (4,0,0): xxxx, yyyy, zzzz
  let radial310 = 0; // (3,1,0): xxxy, xxxz, xyyy, yyyz, xzzz, yzzz
  let radial220 = 0; // (2,2,0): xxyy, xxzz, yyzz
  let radial211 = 0; // (2,1,1): xxyz, xyyz, xyzz

  for (const prim of shell.primitives) {
    const exp_val = Math.exp(-prim.exponent * r2);
    radial400 += prim.coefficient * primitiveNorm(prim.exponent, 4, 0, 0) * exp_val;
    radial310 += prim.coefficient * primitiveNorm(prim.exponent, 3, 1, 0) * exp_val;
    radial220 += prim.coefficient * primitiveNorm(prim.exponent, 2, 2, 0) * exp_val;
    radial211 += prim.coefficient * primitiveNorm(prim.exponent, 2, 1, 1) * exp_val;
  }

  const x2 = dx * dx, y2 = dy * dy, z2 = dz * dz;
  values[offset]      = radial400 * x2 * x2;             // xxxx
  values[offset + 1]  = radial400 * y2 * y2;             // yyyy
  values[offset + 2]  = radial400 * z2 * z2;             // zzzz
  values[offset + 3]  = radial310 * x2 * dx * dy;        // xxxy
  values[offset + 4]  = radial310 * x2 * dx * dz;        // xxxz
  values[offset + 5]  = radial310 * dx * y2 * dy;        // xyyy
  values[offset + 6]  = radial310 * y2 * dy * dz;        // yyyz
  values[offset + 7]  = radial310 * dx * z2 * dz;        // xzzz
  values[offset + 8]  = radial310 * dy * z2 * dz;        // yzzz
  values[offset + 9]  = radial220 * x2 * y2;             // xxyy
  values[offset + 10] = radial220 * x2 * z2;             // xxzz
  values[offset + 11] = radial220 * y2 * z2;             // yyzz
  values[offset + 12] = radial211 * x2 * dy * dz;        // xxyz
  values[offset + 13] = radial211 * dx * y2 * dz;        // xyyz
  values[offset + 14] = radial211 * dx * dy * z2;        // xyzz
}

// =============================================
// g shell (spherical harmonics, 9 components)
// Molden order: g0, g+1, g-1, g+2, g-2, g+3, g-3, g+4, g-4
// =============================================

function evaluateContractedGSpherical(
  shell: ContractedShell,
  dx: number, dy: number, dz: number, r2: number,
  values: Float64Array, offset: number,
): void {
  let radial400 = 0, radial310 = 0, radial220 = 0, radial211 = 0;
  for (const prim of shell.primitives) {
    const exp_val = Math.exp(-prim.exponent * r2);
    radial400 += prim.coefficient * primitiveNorm(prim.exponent, 4, 0, 0) * exp_val;
    radial310 += prim.coefficient * primitiveNorm(prim.exponent, 3, 1, 0) * exp_val;
    radial220 += prim.coefficient * primitiveNorm(prim.exponent, 2, 2, 0) * exp_val;
    radial211 += prim.coefficient * primitiveNorm(prim.exponent, 2, 1, 1) * exp_val;
  }

  const x2 = dx * dx, y2 = dy * dy, z2 = dz * dz;

  // Cartesian basis values (each normalized with its own primitive_norm)
  const xxxx = radial400 * x2 * x2;
  const yyyy = radial400 * y2 * y2;
  const zzzz = radial400 * z2 * z2;
  const xxxy = radial310 * x2 * dx * dy;
  const xxxz = radial310 * x2 * dx * dz;
  const xyyy = radial310 * dx * y2 * dy;
  const yyyz = radial310 * y2 * dy * dz;
  const xzzz = radial310 * dx * z2 * dz;
  const yzzz = radial310 * dy * z2 * dz;
  const xxyy = radial220 * x2 * y2;
  const xxzz = radial220 * x2 * z2;
  const yyzz = radial220 * y2 * z2;
  const xxyz = radial211 * x2 * dy * dz;
  const xyyz = radial211 * dx * y2 * dz;
  const xyzz = radial211 * dx * dy * z2;

  const s5  = Math.sqrt(5);
  const s10 = Math.sqrt(10);
  const s35 = Math.sqrt(35);
  const s70 = Math.sqrt(70);

  // g0   = z^4 + (3/8)(x^4+y^4) + (3/4)x^2y^2 - 3 x^2z^2 - 3 y^2z^2
  values[offset]     = zzzz + (3 / 8) * (xxxx + yyyy) + (3 / 4) * xxyy - 3 * xxzz - 3 * yyzz;
  // g+1  = sqrt(10) [ xz^3 - (3/4)(x^3 z + xy^2 z) ]
  values[offset + 1] = s10 * (xzzz - 0.75 * (xxxz + xyyz));
  // g-1  = sqrt(10) [ yz^3 - (3/4)(x^2 y z + y^3 z) ]
  values[offset + 2] = s10 * (yzzz - 0.75 * (xxyz + yyyz));
  // g+2  = sqrt(5) [ (3/2)(x^2 z^2 - y^2 z^2) - (1/4)(x^4 - y^4) ]
  values[offset + 3] = s5 * (1.5 * (xxzz - yyzz) - 0.25 * (xxxx - yyyy));
  // g-2  = sqrt(5) [ 3 xyz^2 - (1/2)(x^3 y + x y^3) ]
  values[offset + 4] = s5 * (3 * xyzz - 0.5 * (xxxy + xyyy));
  // g+3  = (sqrt(70)/4) (x^3 z - 3 x y^2 z)
  values[offset + 5] = (s70 / 4) * (xxxz - 3 * xyyz);
  // g-3  = (sqrt(70)/4) (3 x^2 y z - y^3 z)
  values[offset + 6] = (s70 / 4) * (3 * xxyz - yyyz);
  // g+4  = (sqrt(35)/8) (x^4 - 6 x^2 y^2 + y^4)
  values[offset + 7] = (s35 / 8) * (xxxx - 6 * xxyy + yyyy);
  // g-4  = (sqrt(35)/2) (x^3 y - x y^3)
  values[offset + 8] = (s35 / 2) * (xxxy - xyyy);
}
