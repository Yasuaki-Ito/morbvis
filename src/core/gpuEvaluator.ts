/**
 * WebGPU Compute Shader based MO evaluator
 *
 * Replaces the CPU Web Worker path with GPU parallel computation.
 * Falls back gracefully when WebGPU is unavailable.
 */

import type { ContractedShell, Grid3D, ShellType } from '../types';
import { basisCountForShell } from './basisFunctions';
import shaderSource from '../shaders/mo_eval.wgsl?raw';

// ---------- GPU buffer struct layouts ----------

// Must match WGSL struct GridParams (48 bytes, 12 × f32/u32)
function encodeGridParams(
  grid: Grid3D,
  nBasis: number,
  nShells: number,
  useSphericalD: boolean,
  useSphericalF: boolean,
): ArrayBuffer {
  const buf = new ArrayBuffer(48);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  f[0] = grid.origin.x;  // origin_x
  f[1] = grid.origin.y;  // origin_y
  f[2] = grid.origin.z;  // origin_z
  f[3] = grid.spacing;   // spacing
  u[4] = grid.size.x;    // nx
  u[5] = grid.size.y;    // ny
  u[6] = grid.size.z;    // nz
  u[7] = nBasis;         // n_basis
  u[8] = nShells;        // n_shells
  u[9] = useSphericalD ? 1 : 0;
  u[10] = useSphericalF ? 1 : 0;
  u[11] = 0;             // _pad
  return buf;
}

// Must match WGSL struct ShellInfo (32 bytes, 8 × f32/u32)
// Must match WGSL struct PrimData (8 bytes, 2 × f32)
function flattenShells(
  shells: ContractedShell[],
  useSphericalD: boolean,
  useSphericalF: boolean,
): { shellBuf: ArrayBuffer; primBuf: ArrayBuffer } {
  const shellTypeMap: Record<ShellType, number> = { s: 0, p: 1, d: 2, f: 3 };

  let totalPrims = 0;
  for (const s of shells) totalPrims += s.primitives.length;

  const shellBuf = new ArrayBuffer(shells.length * 32);
  const primBuf = new ArrayBuffer(totalPrims * 8);
  const sf = new Float32Array(shellBuf);
  const su = new Uint32Array(shellBuf);
  const pf = new Float32Array(primBuf);

  let primOffset = 0;
  let basisOffset = 0;

  for (let i = 0; i < shells.length; i++) {
    const shell = shells[i];
    const off = i * 8; // 8 u32/f32 per ShellInfo
    sf[off + 0] = shell.center.x;
    sf[off + 1] = shell.center.y;
    sf[off + 2] = shell.center.z;
    su[off + 3] = shellTypeMap[shell.shellType];
    su[off + 4] = primOffset;
    su[off + 5] = shell.primitives.length;
    su[off + 6] = basisOffset;
    su[off + 7] = 0; // _pad

    for (const prim of shell.primitives) {
      pf[primOffset * 2] = prim.exponent;
      pf[primOffset * 2 + 1] = prim.coefficient;
      primOffset++;
    }

    const spherical =
      (shell.shellType === 'd' && useSphericalD) ||
      (shell.shellType === 'f' && useSphericalF);
    basisOffset += basisCountForShell(shell.shellType, spherical);
  }

  return { shellBuf, primBuf };
}

// ---------- Public API ----------

export interface GPUContext {
  device: GPUDevice;
  pipeline: GPUComputePipeline;
  bindGroupLayout: GPUBindGroupLayout;
}

/**
 * Initialize WebGPU device and compile the compute shader.
 * Returns null if WebGPU is not available.
 */
export async function initGPU(): Promise<GPUContext | null> {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    console.warn('WebGPU not available in this browser');
    return null;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      console.warn('No WebGPU adapter found');
      return null;
    }

    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    });

    const shaderModule = device.createShaderModule({
      label: 'MO Eval Compute',
      code: shaderSource,
    });

    const bindGroupLayout = device.createBindGroupLayout({
      label: 'MO Eval BGL',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    const pipelineLayout = device.createPipelineLayout({
      label: 'MO Eval PL',
      bindGroupLayouts: [bindGroupLayout],
    });

    const pipeline = device.createComputePipeline({
      label: 'MO Eval Pipeline',
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    });

    console.log('WebGPU initialized successfully');
    return { device, pipeline, bindGroupLayout };
  } catch (e) {
    console.warn('WebGPU initialization failed:', e);
    return null;
  }
}

/**
 * Evaluate a molecular orbital on a 3D grid using the GPU.
 *
 * @returns Float64Array of scalar field values (same format as CPU evaluator)
 */
export async function evaluateMOOnGridGPU(
  ctx: GPUContext,
  shells: ContractedShell[],
  moCoefficients: number[],
  grid: Grid3D,
  useSphericalD: boolean,
  useSphericalF: boolean,
): Promise<Float64Array> {
  const { device, pipeline, bindGroupLayout } = ctx;

  const nx = grid.size.x;
  const ny = grid.size.y;
  const nz = grid.size.z;
  const totalPoints = nx * ny * nz;

  // Compute total basis count
  let nBasis = 0;
  for (const shell of shells) {
    const spherical =
      (shell.shellType === 'd' && useSphericalD) ||
      (shell.shellType === 'f' && useSphericalF);
    nBasis += basisCountForShell(shell.shellType, spherical);
  }

  // Flatten data for GPU
  const paramsBuf = encodeGridParams(grid, nBasis, shells.length, useSphericalD, useSphericalF);
  const { shellBuf, primBuf } = flattenShells(shells, useSphericalD, useSphericalF);
  const coeffsBuf = new Float32Array(moCoefficients);

  // Create GPU buffers
  const paramsGPU = device.createBuffer({
    label: 'GridParams',
    size: paramsBuf.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(paramsGPU, 0, paramsBuf);

  const shellsGPU = device.createBuffer({
    label: 'Shells',
    size: Math.max(shellBuf.byteLength, 32), // min 32 bytes
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(shellsGPU, 0, shellBuf);

  const primsGPU = device.createBuffer({
    label: 'Primitives',
    size: Math.max(primBuf.byteLength, 8), // min 8 bytes
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(primsGPU, 0, primBuf);

  const coeffsGPU = device.createBuffer({
    label: 'MO Coefficients',
    size: Math.max(coeffsBuf.byteLength, 4), // min 4 bytes
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(coeffsGPU, 0, coeffsBuf);

  const fieldByteSize = totalPoints * 4; // f32
  const fieldGPU = device.createBuffer({
    label: 'Field Output',
    size: fieldByteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  const readbackGPU = device.createBuffer({
    label: 'Readback',
    size: fieldByteSize,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'MO Eval BG',
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: paramsGPU } },
      { binding: 1, resource: { buffer: shellsGPU } },
      { binding: 2, resource: { buffer: primsGPU } },
      { binding: 3, resource: { buffer: coeffsGPU } },
      { binding: 4, resource: { buffer: fieldGPU } },
    ],
  });

  // Dispatch compute
  const workgroupCount = Math.ceil(totalPoints / 256);
  const encoder = device.createCommandEncoder({ label: 'MO Eval Encoder' });
  const pass = encoder.beginComputePass({ label: 'MO Eval Pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(workgroupCount);
  pass.end();

  // Copy result to readback buffer
  encoder.copyBufferToBuffer(fieldGPU, 0, readbackGPU, 0, fieldByteSize);
  device.queue.submit([encoder.finish()]);

  // Read back result
  await readbackGPU.mapAsync(GPUMapMode.READ);
  const resultF32 = new Float32Array(readbackGPU.getMappedRange().slice(0));
  readbackGPU.unmap();

  // Convert f32 → f64 (matching CPU evaluator output format)
  const result = new Float64Array(totalPoints);
  for (let i = 0; i < totalPoints; i++) {
    result[i] = resultF32[i];
  }

  // Cleanup GPU buffers
  paramsGPU.destroy();
  shellsGPU.destroy();
  primsGPU.destroy();
  coeffsGPU.destroy();
  fieldGPU.destroy();
  readbackGPU.destroy();

  return result;
}
