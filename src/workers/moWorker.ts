import type { MOWorkerRequest, MOWorkerResponse } from '../types';
import { evaluateMOOnGrid } from '../core/moEvaluator';

self.onmessage = (e: MessageEvent<MOWorkerRequest>) => {
  const { shells, moCoefficients, grid, useSphericalD, useSphericalF } = e.data;

  const scalarField = evaluateMOOnGrid(
    shells,
    moCoefficients,
    grid,
    useSphericalD,
    useSphericalF,
    (percent) => {
      const progress: MOWorkerResponse = { type: 'progress', percent };
      self.postMessage(progress);
    },
  );

  const response: MOWorkerResponse = {
    type: 'result',
    scalarField,
    gridSize: [grid.size.x, grid.size.y, grid.size.z],
  };

  self.postMessage(response, { transfer: [scalarField.buffer] });
};
