import type { DensityWorkerRequest, DensityWorkerResponse } from '../types';
import { evaluateMOOnGrid } from '../core/moEvaluator';

self.onmessage = (e: MessageEvent<DensityWorkerRequest>) => {
  const { shells, occupiedMOs, grid, useSphericalD, useSphericalF } = e.data;
  const nx = grid.size.x, ny = grid.size.y, nz = grid.size.z;
  const totalPoints = nx * ny * nz;
  const density = new Float64Array(totalPoints);

  for (let m = 0; m < occupiedMOs.length; m++) {
    const mo = occupiedMOs[m];

    // Progress per MO
    const progress: DensityWorkerResponse = {
      type: 'progress',
      percent: Math.round((m / occupiedMOs.length) * 100),
      currentMO: m + 1,
      totalMOs: occupiedMOs.length,
    };
    self.postMessage(progress);

    // Evaluate MO on grid
    const moField = evaluateMOOnGrid(shells, mo.coefficients, grid, useSphericalD, useSphericalF);

    // Accumulate: density += occupation * |psi|^2
    const occ = mo.occupation;
    for (let i = 0; i < totalPoints; i++) {
      density[i] += occ * moField[i] * moField[i];
    }
  }

  const response: DensityWorkerResponse = {
    type: 'result',
    scalarField: density,
    gridSize: [nx, ny, nz],
  };

  self.postMessage(response, { transfer: [density.buffer] });
};
