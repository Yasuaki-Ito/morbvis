/**
 * Paper Benchmark: systematic CPU vs GPU performance evaluation
 *
 * Usage: npm run dev → open http://localhost:5173/paper_benchmark.html
 *
 * Measures:
 *   (1) MO evaluation (HOMO) at grid 60/100/140/160/200
 *   (2) Electron density at grid 60/100/140/160/200
 *   5 trials each, median adopted
 */
import { useState, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { parseMolden } from './core/moldenParser';
import { autoGrid, evaluateMOOnGrid } from './core/moEvaluator';
import { initGPU, evaluateMOOnGridGPU, type GPUContext } from './core/gpuEvaluator';
import type { MoldenData, Grid3D } from './types';

// ── Config ──────────────────────────────────────────
const GRID_SIZES = [60, 100, 140, 160, 200];
const NUM_TRIALS = 5;

interface MoleculeEntry {
  label: string;
  filename: string;
  data: MoldenData | null;
  nAtoms: number;
  nBasis: number;
  nMOs: number;
  homoIndex: number;
  nOccupied: number;
}

interface SingleResult {
  grid: number;
  totalPoints: number;
  cpuMs: number | null;   // median
  gpuMs: number | null;   // median
  speedup: string;
}

interface MoleculeResult {
  label: string;
  moResults: SingleResult[];
  densityResults: SingleResult[];
}

const MOLECULES: { label: string; filename: string }[] = [
  { label: 'Benzene / STO-3G', filename: 'benzene_sto3g.molden' },
  { label: 'Benzene / 6-31G*', filename: 'benzene_631gs.molden' },
  { label: 'Benzene / cc-pVTZ', filename: 'benzene_ccpvtz.molden' },
  { label: 'Naphthalene / 6-31G*', filename: 'naphthalene_631gs.molden' },
  { label: 'Anthracene / 6-31G*', filename: 'anthracene_631gs.molden' },
];

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function fmt(ms: number | null): string {
  if (ms == null) return '\u2014';
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

// ── Density on CPU (synchronous, no worker) ──
function evaluateDensityCPU(
  data: MoldenData,
  occupiedMOs: { coefficients: number[]; occupation: number }[],
  grid: Grid3D,
): Float64Array {
  const total = grid.size.x * grid.size.y * grid.size.z;
  const density = new Float64Array(total);
  for (const mo of occupiedMOs) {
    const field = evaluateMOOnGrid(data.shells, mo.coefficients, grid, data.useSphericalD, data.useSphericalF);
    const occ = mo.occupation;
    for (let i = 0; i < total; i++) {
      density[i] += occ * field[i] * field[i];
    }
  }
  return density;
}

// ── Density on GPU ──
async function evaluateDensityGPU(
  gpuCtx: GPUContext,
  data: MoldenData,
  occupiedMOs: { coefficients: number[]; occupation: number }[],
  grid: Grid3D,
): Promise<Float64Array> {
  const total = grid.size.x * grid.size.y * grid.size.z;
  const density = new Float64Array(total);
  for (const mo of occupiedMOs) {
    const field = await evaluateMOOnGridGPU(gpuCtx, data.shells, mo.coefficients, grid, data.useSphericalD, data.useSphericalF);
    const occ = mo.occupation;
    for (let i = 0; i < total; i++) {
      density[i] += occ * field[i] * field[i];
    }
  }
  return density;
}

// ── App ─────────────────────────────────────────────
function App() {
  const [molecules, setMolecules] = useState<MoleculeEntry[]>([]);
  const [gpuCtx, setGpuCtx] = useState<GPUContext | null>(null);
  const [gpuName, setGpuName] = useState('');
  const [results, setResults] = useState<MoleculeResult[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [skipCPULarge, setSkipCPULarge] = useState(true);
  const cancelRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Init GPU
  const ensureGPU = useCallback(async () => {
    if (gpuCtx) return gpuCtx;
    const ctx = await initGPU();
    setGpuCtx(ctx);
    if (ctx) {
      const adapter = await navigator.gpu?.requestAdapter();
      const info = (adapter as any)?.info;
      const name = info?.device || info?.description || 'Unknown GPU';
      const vendor = info?.vendor || '';
      setGpuName(`${vendor} ${name}`.trim());
    }
    return ctx;
  }, [gpuCtx]);

  // Load molden files
  const handleFiles = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const entries: MoleculeEntry[] = [];
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const data = parseMolden(text);
        // Find HOMO
        let homoIndex = -1;
        for (let i = data.molecularOrbitals.length - 1; i >= 0; i--) {
          if (data.molecularOrbitals[i].occupation > 0) { homoIndex = i; break; }
        }
        const nOccupied = data.molecularOrbitals.filter(mo => mo.occupation > 0).length;
        // Try to match with predefined label
        const predefined = MOLECULES.find(m => file.name === m.filename);
        const nBasis = data.molecularOrbitals.length > 0 ? data.molecularOrbitals[0].coefficients.length : 0;
        entries.push({
          label: predefined?.label || file.name.replace('.molden', ''),
          filename: file.name,
          data,
          nAtoms: data.atoms.length,
          nBasis,
          nMOs: data.molecularOrbitals.length,
          homoIndex,
          nOccupied,
        });
      } catch (err) {
        console.error(`Failed to parse ${file.name}:`, err);
      }
    }
    setMolecules(entries);
    await ensureGPU();
  }, [ensureGPU]);

  // ── Run benchmark ──
  const runBenchmark = useCallback(async () => {
    if (molecules.length === 0) return;
    setRunning(true);
    cancelRef.current = false;
    setResults([]);

    const gpu = await ensureGPU();
    const allResults: MoleculeResult[] = [];

    // GPU warm-up
    if (gpu && molecules[0].data) {
      const d = molecules[0].data;
      const g = autoGrid(d.shells, 60);
      const mo = d.molecularOrbitals[molecules[0].homoIndex];
      if (mo) {
        setStatus('GPU warm-up...');
        await evaluateMOOnGridGPU(gpu, d.shells, mo.coefficients, g, d.useSphericalD, d.useSphericalF);
      }
    }

    for (let mi = 0; mi < molecules.length; mi++) {
      if (cancelRef.current) break;
      const mol = molecules[mi];
      if (!mol.data) continue;
      const data = mol.data;
      const homo = data.molecularOrbitals[mol.homoIndex];
      if (!homo) continue;

      const occupiedMOs = data.molecularOrbitals
        .filter(mo => mo.occupation > 0)
        .map(mo => ({ coefficients: mo.coefficients, occupation: mo.occupation }));

      const moResults: SingleResult[] = [];
      const densityResults: SingleResult[] = [];

      // ── (1) MO benchmark ──
      for (const gp of GRID_SIZES) {
        if (cancelRef.current) break;
        const grid = autoGrid(data.shells, gp);
        const totalPoints = grid.size.x * grid.size.y * grid.size.z;
        setStatus(`[${mi + 1}/${molecules.length}] ${mol.label} — MO — Grid ${gp} (${totalPoints.toLocaleString()} pts)`);

        // CPU
        let cpuMs: number | null = null;
        if (!(skipCPULarge && gp > 160)) {
          const times: number[] = [];
          for (let t = 0; t < NUM_TRIALS; t++) {
            if (cancelRef.current) break;
            setStatus(`[${mi + 1}/${molecules.length}] ${mol.label} — MO — Grid ${gp} — CPU trial ${t + 1}/${NUM_TRIALS}`);
            const t0 = performance.now();
            evaluateMOOnGrid(data.shells, homo.coefficients, grid, data.useSphericalD, data.useSphericalF);
            times.push(performance.now() - t0);
          }
          cpuMs = times.length > 0 ? median(times) : null;
        }

        // GPU
        let gpuMs: number | null = null;
        if (gpu) {
          const times: number[] = [];
          for (let t = 0; t < NUM_TRIALS; t++) {
            if (cancelRef.current) break;
            setStatus(`[${mi + 1}/${molecules.length}] ${mol.label} — MO — Grid ${gp} — GPU trial ${t + 1}/${NUM_TRIALS}`);
            const t0 = performance.now();
            await evaluateMOOnGridGPU(gpu, data.shells, homo.coefficients, grid, data.useSphericalD, data.useSphericalF);
            times.push(performance.now() - t0);
          }
          gpuMs = times.length > 0 ? median(times) : null;
        }

        const speedup = (cpuMs != null && gpuMs != null && gpuMs > 0)
          ? `${(cpuMs / gpuMs).toFixed(1)}x`
          : '\u2014';
        moResults.push({ grid: gp, totalPoints, cpuMs, gpuMs, speedup });
      }

      // ── (2) Density benchmark ──
      for (const gp of GRID_SIZES) {
        if (cancelRef.current) break;
        const grid = autoGrid(data.shells, gp);
        const totalPoints = grid.size.x * grid.size.y * grid.size.z;
        setStatus(`[${mi + 1}/${molecules.length}] ${mol.label} — Density — Grid ${gp} (${totalPoints.toLocaleString()} pts)`);

        // CPU
        let cpuMs: number | null = null;
        if (!(skipCPULarge && gp > 160)) {
          const times: number[] = [];
          for (let t = 0; t < NUM_TRIALS; t++) {
            if (cancelRef.current) break;
            setStatus(`[${mi + 1}/${molecules.length}] ${mol.label} — Density — Grid ${gp} — CPU trial ${t + 1}/${NUM_TRIALS}`);
            const t0 = performance.now();
            evaluateDensityCPU(data, occupiedMOs, grid);
            times.push(performance.now() - t0);
          }
          cpuMs = times.length > 0 ? median(times) : null;
        }

        // GPU
        let gpuMs: number | null = null;
        if (gpu) {
          const times: number[] = [];
          for (let t = 0; t < NUM_TRIALS; t++) {
            if (cancelRef.current) break;
            setStatus(`[${mi + 1}/${molecules.length}] ${mol.label} — Density — Grid ${gp} — GPU trial ${t + 1}/${NUM_TRIALS}`);
            const t0 = performance.now();
            await evaluateDensityGPU(gpu, data, occupiedMOs, grid);
            times.push(performance.now() - t0);
          }
          gpuMs = times.length > 0 ? median(times) : null;
        }

        const speedup = (cpuMs != null && gpuMs != null && gpuMs > 0)
          ? `${(cpuMs / gpuMs).toFixed(1)}x`
          : '\u2014';
        densityResults.push({ grid: gp, totalPoints, cpuMs, gpuMs, speedup });
      }

      const molResult: MoleculeResult = { label: mol.label, moResults, densityResults };
      allResults.push(molResult);
      setResults([...allResults]);
    }

    setStatus(cancelRef.current ? 'Cancelled' : 'Done');
    setRunning(false);
  }, [molecules, ensureGPU, skipCPULarge]);

  // ── Export CSV ──
  const exportCSV = useCallback(() => {
    const lines: string[] = [];
    lines.push('Molecule,Type,Grid,Points,CPU (ms),GPU (ms),Speedup');
    for (const mr of results) {
      for (const r of mr.moResults) {
        lines.push(`${mr.label},MO,${r.grid},${r.totalPoints},${r.cpuMs?.toFixed(1) ?? ''},${r.gpuMs?.toFixed(1) ?? ''},${r.speedup}`);
      }
      for (const r of mr.densityResults) {
        lines.push(`${mr.label},Density,${r.grid},${r.totalPoints},${r.cpuMs?.toFixed(1) ?? ''},${r.gpuMs?.toFixed(1) ?? ''},${r.speedup}`);
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `paper_benchmark_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [results]);

  // ── Render ────────────────────────────────────────
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Paper Benchmark: CPU vs GPU</h1>
      <p style={{ fontSize: 13, color: '#666', margin: '0 0 16px' }}>
        {NUM_TRIALS} trials per measurement, median adopted. Grid sizes: {GRID_SIZES.join(', ')}
      </p>

      {/* File input */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <input ref={fileInputRef} type="file" accept=".molden,.input" multiple onChange={handleFiles} />
      </div>

      {/* Loaded molecules */}
      {molecules.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, marginBottom: 16 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #333', background: '#f9f9f9' }}>
              <th style={thStyle}>Molecule</th>
              <th style={thStyle}>File</th>
              <th style={thStyle}>Atoms</th>
              <th style={thStyle}>Basis</th>
              <th style={thStyle}>MOs</th>
              <th style={thStyle}>Occupied</th>
              <th style={thStyle}>HOMO</th>
            </tr>
          </thead>
          <tbody>
            {molecules.map((mol, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 600 }}>{mol.label}</td>
                <td style={{ ...tdStyle, textAlign: 'left', fontSize: 11, color: '#888' }}>{mol.filename}</td>
                <td style={tdStyle}>{mol.nAtoms}</td>
                <td style={tdStyle}>{mol.nBasis}</td>
                <td style={tdStyle}>{mol.nMOs}</td>
                <td style={tdStyle}>{mol.nOccupied}</td>
                <td style={tdStyle}>#{mol.homoIndex}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* GPU info */}
      <p style={{ fontSize: 13, marginBottom: 12 }}>
        <b>GPU:</b> {gpuCtx ? gpuName : 'Not initialized'}
      </p>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={runBenchmark} disabled={molecules.length === 0 || running} style={btnStyle}>
          {running ? 'Running...' : 'Run All Benchmarks'}
        </button>
        {running && (
          <button onClick={() => { cancelRef.current = true; }} style={{ ...btnStyle, background: '#e53e3e', color: '#fff' }}>
            Cancel
          </button>
        )}
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={skipCPULarge} onChange={e => setSkipCPULarge(e.target.checked)} />
          Skip CPU for grid &gt; 160
        </label>
        {results.length > 0 && !running && (
          <button onClick={exportCSV} style={btnStyle}>Export CSV</button>
        )}
      </div>

      {status && <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>{status}</p>}

      {/* Results */}
      {results.map((mr, ri) => (
        <div key={ri} style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, margin: '0 0 8px', borderBottom: '2px solid #2563eb', paddingBottom: 4 }}>
            {mr.label}
          </h2>

          {/* MO results */}
          <h3 style={{ fontSize: 14, margin: '8px 0 4px', color: '#333' }}>(1) MO Evaluation (HOMO)</h3>
          <ResultTable rows={mr.moResults} />

          {/* Density results */}
          <h3 style={{ fontSize: 14, margin: '12px 0 4px', color: '#333' }}>(2) Electron Density</h3>
          <ResultTable rows={mr.densityResults} />
        </div>
      ))}
    </div>
  );
}

function ResultTable({ rows }: { rows: SingleResult[] }) {
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, marginBottom: 8 }}>
      <thead>
        <tr style={{ borderBottom: '2px solid #333', background: '#f9f9f9' }}>
          <th style={thStyle}>Grid</th>
          <th style={thStyle}>Points</th>
          <th style={thStyle}>CPU (median)</th>
          <th style={thStyle}>GPU (median)</th>
          <th style={thStyle}>Speedup</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.grid} style={{ borderBottom: '1px solid #ddd' }}>
            <td style={tdStyle}>{r.grid}</td>
            <td style={tdStyle}>{r.totalPoints.toLocaleString()}</td>
            <td style={tdStyle}>{fmt(r.cpuMs)}</td>
            <td style={tdStyle}>{fmt(r.gpuMs)}</td>
            <td style={{ ...tdStyle, fontWeight: 600, color: r.speedup !== '\u2014' ? '#2563eb' : '#999' }}>{r.speedup}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '6px 16px', fontSize: 13, fontWeight: 600, borderRadius: 6,
  border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer',
};
const thStyle: React.CSSProperties = { padding: '6px 10px', textAlign: 'right' };
const tdStyle: React.CSSProperties = { padding: '5px 10px', textAlign: 'right' };

createRoot(document.getElementById('root')!).render(<App />);
