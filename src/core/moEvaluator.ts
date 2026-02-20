import type { ContractedShell, Grid3D, Vec3 } from '../types';
import { evaluateAllBasis, totalBasisCount } from './basisFunctions';

/**
 * Evaluate a molecular orbital on a 3D grid
 *
 * psi_i(r) = sum_mu C_mu_i * chi_mu(r)
 *
 * @returns flat array field[iz*ny*nx + iy*nx + ix]
 */
export function evaluateMOOnGrid(
  shells: ContractedShell[],
  moCoefficients: number[],
  grid: Grid3D,
  useSphericalD: boolean,
  useSphericalF: boolean,
  onProgress?: (percent: number) => void,
): Float64Array {
  const nx = grid.size.x;
  const ny = grid.size.y;
  const nz = grid.size.z;
  const nBasis = totalBasisCount(shells, useSphericalD, useSphericalF);
  const field = new Float64Array(nx * ny * nz);
  const basisValues = new Float64Array(nBasis);

  const point: Vec3 = { x: 0, y: 0, z: 0 };

  for (let iz = 0; iz < nz; iz++) {
    point.z = grid.origin.z + iz * grid.spacing;
    for (let iy = 0; iy < ny; iy++) {
      point.y = grid.origin.y + iy * grid.spacing;
      for (let ix = 0; ix < nx; ix++) {
        point.x = grid.origin.x + ix * grid.spacing;

        // Evaluate all basis functions
        evaluateAllBasis(point, shells, useSphericalD, useSphericalF, basisValues);

        // MO value = sum C_mu * chi_mu
        let moValue = 0;
        for (let mu = 0; mu < nBasis; mu++) {
          moValue += moCoefficients[mu] * basisValues[mu];
        }

        field[iz * ny * nx + iy * nx + ix] = moValue;
      }
    }
    if (onProgress) {
      onProgress(Math.round(((iz + 1) / nz) * 100));
    }
  }

  return field;
}

/**
 * Auto-generate grid parameters from atom coordinates
 */
export function autoGrid(
  shells: ContractedShell[],
  gridPoints: number = 60,
  margin: number = 3.0,
): Grid3D {
  // Bounding box of all atom centers
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const shell of shells) {
    const c = shell.center;
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.z < minZ) minZ = c.z;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
    if (c.z > maxZ) maxZ = c.z;
  }

  // Add margin
  minX -= margin; minY -= margin; minZ -= margin;
  maxX += margin; maxY += margin; maxZ += margin;

  // Square grid matching longest axis
  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  const rangeZ = maxZ - minZ;
  const maxRange = Math.max(rangeX, rangeY, rangeZ);
  const spacing = maxRange / (gridPoints - 1);

  // Calculate grid points per axis
  const nx = Math.max(2, Math.ceil(rangeX / spacing) + 1);
  const ny = Math.max(2, Math.ceil(rangeY / spacing) + 1);
  const nz = Math.max(2, Math.ceil(rangeZ / spacing) + 1);

  return {
    origin: { x: minX, y: minY, z: minZ },
    size: { x: nx, y: ny, z: nz },
    spacing,
  };
}
