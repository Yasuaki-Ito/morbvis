/**
 * Benchmark Worker: runs CPU MO/density evaluation off the main thread
 */
import { evaluateMOOnGrid, autoGrid } from '../core/moEvaluator';
import type { ContractedShell, Grid3D } from '../types';

export interface BenchmarkRequest {
  type: 'mo' | 'density';
  shells: ContractedShell[];
  grid: Grid3D;
  useSphericalD: boolean;
  useSphericalF: boolean;
  coefficients?: number[];
  occupiedMOs?: { coefficients: number[]; occupation: number }[];
  numTrials: number;
}

export interface TrialResult {
  totalMs: number;
  /** Per-MO step times (density only) */
  steps?: number[];
}

export interface BenchmarkResponse {
  type: 'result';
  trials: TrialResult[];
}

self.onmessage = (e: MessageEvent<BenchmarkRequest>) => {
  const { type, shells, grid, useSphericalD, useSphericalF, numTrials } = e.data;
  const trials: TrialResult[] = [];

  if (type === 'mo' && e.data.coefficients) {
    const coeffs = e.data.coefficients;
    for (let t = 0; t < numTrials; t++) {
      const t0 = performance.now();
      evaluateMOOnGrid(shells, coeffs, grid, useSphericalD, useSphericalF);
      trials.push({ totalMs: performance.now() - t0 });
    }
  } else if (type === 'density' && e.data.occupiedMOs) {
    const occupiedMOs = e.data.occupiedMOs;
    for (let t = 0; t < numTrials; t++) {
      const total = grid.size.x * grid.size.y * grid.size.z;
      const density = new Float64Array(total);
      const steps: number[] = [];
      const tStart = performance.now();
      for (const mo of occupiedMOs) {
        const s0 = performance.now();
        const field = evaluateMOOnGrid(shells, mo.coefficients, grid, useSphericalD, useSphericalF);
        const occ = mo.occupation;
        for (let i = 0; i < total; i++) {
          density[i] += occ * field[i] * field[i];
        }
        steps.push(performance.now() - s0);
      }
      trials.push({ totalMs: performance.now() - tStart, steps });
    }
  }

  const resp: BenchmarkResponse = { type: 'result', trials };
  self.postMessage(resp);
};
