/**
 * Benchmark: systematic CPU vs GPU performance evaluation
 *
 * Usage: npm run dev → open http://localhost:5173/benchmark.html
 *
 * Measures:
 *   (1) MO evaluation (HOMO) at grid 60/100/140/160/200
 *   (2) Electron density at grid 60/100/140/160/200
 *   N trials each, median adopted
 *
 * CPU runs in a Web Worker to avoid freezing the browser.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { parseMolden } from './core/moldenParser';
import { autoGrid } from './core/moEvaluator';
import { initGPU, evaluateMOOnGridGPU, type GPUContext } from './core/gpuEvaluator';
import type { MoldenData, Grid3D } from './types';
import type { BenchmarkRequest, BenchmarkResponse, TrialResult } from './workers/benchmarkWorker';

// ── Config ──────────────────────────────────────────
const GRID_SIZES = [60, 100, 140, 160, 200];
const TRIAL_OPTIONS = [1, 3, 5, 7, 10];

const BENCHMARK_FILES: { label: string; filename: string }[] = [
  { label: 'Benzene / STO-3G', filename: 'benzene_sto3g.molden' },
  { label: 'Benzene / 6-31G*', filename: 'benzene_631gs.molden' },
  { label: 'Benzene / cc-pVTZ', filename: 'benzene_ccpvtz.molden' },
  { label: 'Naphthalene / 6-31G*', filename: 'naphthalene_631gs.molden' },
  { label: 'Anthracene / 6-31G*', filename: 'anthracene_631gs.molden' },
];

interface MoleculeEntry {
  label: string;
  filename: string;
  data: MoldenData;
  nAtoms: number;
  nBasis: number;
  nMOs: number;
  homoIndex: number;
  nOccupied: number;
}

interface SingleResult {
  grid: number;
  totalPoints: number;
  cpuMs: number | null;
  gpuMs: number | null;
  cpuTrials: TrialResult[];
  gpuTrials: TrialResult[];
  speedup: string;
}

interface MoleculeResult {
  label: string;
  moResults: SingleResult[];
  densityResults: SingleResult[];
}

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

/** Run CPU benchmark in a Web Worker */
function runCPUInWorker(req: BenchmarkRequest): Promise<TrialResult[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./workers/benchmarkWorker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (e: MessageEvent<BenchmarkResponse>) => {
      resolve(e.data.trials);
      worker.terminate();
    };
    worker.onerror = (err) => {
      reject(err);
      worker.terminate();
    };
    worker.postMessage(req);
  });
}

/** GPU density with per-MO step timing */
async function evaluateDensityGPUTimed(
  gpuCtx: GPUContext,
  data: MoldenData,
  occupiedMOs: { coefficients: number[]; occupation: number }[],
  grid: Grid3D,
): Promise<TrialResult> {
  const total = grid.size.x * grid.size.y * grid.size.z;
  const density = new Float64Array(total);
  const steps: number[] = [];
  const tStart = performance.now();
  for (const mo of occupiedMOs) {
    const s0 = performance.now();
    const field = await evaluateMOOnGridGPU(gpuCtx, data.shells, mo.coefficients, grid, data.useSphericalD, data.useSphericalF, data.useSphericalG);
    const occ = mo.occupation;
    for (let i = 0; i < total; i++) {
      density[i] += occ * field[i] * field[i];
    }
    steps.push(performance.now() - s0);
  }
  return { totalMs: performance.now() - tStart, steps };
}

function parseMoldenEntry(text: string, label: string, filename: string): MoleculeEntry {
  const data = parseMolden(text);
  let homoIndex = -1;
  for (let i = data.molecularOrbitals.length - 1; i >= 0; i--) {
    if (data.molecularOrbitals[i].occupation > 0) { homoIndex = i; break; }
  }
  const nOccupied = data.molecularOrbitals.filter(mo => mo.occupation > 0).length;
  const nBasis = data.molecularOrbitals.length > 0 ? data.molecularOrbitals[0].coefficients.length : 0;
  return {
    label, filename, data,
    nAtoms: data.atoms.length,
    nBasis,
    nMOs: data.molecularOrbitals.length,
    homoIndex,
    nOccupied,
  };
}

// ── App ─────────────────────────────────────────────
function App() {
  const [molecules, setMolecules] = useState<MoleculeEntry[]>([]);
  const [gpuCtx, setGpuCtx] = useState<GPUContext | null>(null);
  const [gpuName, setGpuName] = useState('');
  const [results, setResults] = useState<MoleculeResult[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [loadError, setLoadError] = useState('');
  const [numTrials, setNumTrials] = useState(5);
  const cancelRef = useRef(false);

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

  useEffect(() => {
    (async () => {
      setStatus('Loading benchmark molden files...');
      const entries: MoleculeEntry[] = [];
      const errors: string[] = [];
      for (const bf of BENCHMARK_FILES) {
        try {
          const resp = await fetch(`benchmark_molden/${bf.filename}`);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const text = await resp.text();
          entries.push(parseMoldenEntry(text, bf.label, bf.filename));
        } catch (err) {
          errors.push(`${bf.filename}: ${(err as Error).message}`);
        }
      }
      setMolecules(entries);
      if (errors.length > 0) setLoadError(`Failed to load: ${errors.join(', ')}`);
      setStatus(entries.length > 0 ? `Loaded ${entries.length} molecules` : '');
    })();
  }, []);

  const handleFiles = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const entries: MoleculeEntry[] = [...molecules];
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const predefined = BENCHMARK_FILES.find(m => file.name === m.filename);
        entries.push(parseMoldenEntry(text, predefined?.label || file.name.replace('.molden', ''), file.name));
      } catch (err) {
        console.error(`Failed to parse ${file.name}:`, err);
      }
    }
    setMolecules(entries);
  }, [molecules]);

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
        await evaluateMOOnGridGPU(gpu, d.shells, mo.coefficients, g, d.useSphericalD, d.useSphericalF, d.useSphericalG);
      }
    }

    for (let mi = 0; mi < molecules.length; mi++) {
      if (cancelRef.current) break;
      const mol = molecules[mi];
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

        // CPU (in Worker)
        setStatus(`[${mi + 1}/${molecules.length}] ${mol.label} — MO — Grid ${gp} — CPU (${numTrials} trials)...`);
        const cpuTrials = await runCPUInWorker({
          type: 'mo', shells: data.shells, grid,
          useSphericalD: data.useSphericalD, useSphericalF: data.useSphericalF, useSphericalG: data.useSphericalG,
          coefficients: homo.coefficients, numTrials,
        });
        const cpuMs = cpuTrials.length > 0 ? median(cpuTrials.map(t => t.totalMs)) : null;

        // GPU
        const gpuTrials: TrialResult[] = [];
        let gpuMs: number | null = null;
        if (gpu) {
          for (let t = 0; t < numTrials; t++) {
            if (cancelRef.current) break;
            setStatus(`[${mi + 1}/${molecules.length}] ${mol.label} — MO — Grid ${gp} — GPU ${t + 1}/${numTrials}`);
            const t0 = performance.now();
            await evaluateMOOnGridGPU(gpu, data.shells, homo.coefficients, grid, data.useSphericalD, data.useSphericalF, data.useSphericalG);
            gpuTrials.push({ totalMs: performance.now() - t0 });
          }
          gpuMs = gpuTrials.length > 0 ? median(gpuTrials.map(t => t.totalMs)) : null;
        }

        const speedup = (cpuMs != null && gpuMs != null && gpuMs > 0)
          ? `${(cpuMs / gpuMs).toFixed(1)}x` : '\u2014';
        moResults.push({ grid: gp, totalPoints, cpuMs, gpuMs, cpuTrials, gpuTrials, speedup });
      }

      // ── (2) Density benchmark ──
      for (const gp of GRID_SIZES) {
        if (cancelRef.current) break;
        const grid = autoGrid(data.shells, gp);
        const totalPoints = grid.size.x * grid.size.y * grid.size.z;

        // CPU (in Worker)
        setStatus(`[${mi + 1}/${molecules.length}] ${mol.label} — Density — Grid ${gp} — CPU (${numTrials} trials)...`);
        const cpuTrials = await runCPUInWorker({
          type: 'density', shells: data.shells, grid,
          useSphericalD: data.useSphericalD, useSphericalF: data.useSphericalF, useSphericalG: data.useSphericalG,
          occupiedMOs, numTrials,
        });
        const cpuMs = cpuTrials.length > 0 ? median(cpuTrials.map(t => t.totalMs)) : null;

        // GPU
        const gpuTrials: TrialResult[] = [];
        let gpuMs: number | null = null;
        if (gpu) {
          for (let t = 0; t < numTrials; t++) {
            if (cancelRef.current) break;
            setStatus(`[${mi + 1}/${molecules.length}] ${mol.label} — Density — Grid ${gp} — GPU ${t + 1}/${numTrials}`);
            gpuTrials.push(await evaluateDensityGPUTimed(gpu, data, occupiedMOs, grid));
          }
          gpuMs = gpuTrials.length > 0 ? median(gpuTrials.map(t => t.totalMs)) : null;
        }

        const speedup = (cpuMs != null && gpuMs != null && gpuMs > 0)
          ? `${(cpuMs / gpuMs).toFixed(1)}x` : '\u2014';
        densityResults.push({ grid: gp, totalPoints, cpuMs, gpuMs, cpuTrials, gpuTrials, speedup });
      }

      allResults.push({ label: mol.label, moResults, densityResults });
      setResults([...allResults]);
    }

    if (!cancelRef.current) {
      downloadCSV(allResults);
    }
    setStatus(cancelRef.current ? 'Cancelled' : 'Done — CSV saved');
    setRunning(false);
  }, [molecules, ensureGPU, numTrials]);

  // ── Export CSV ──
  const downloadCSV = useCallback((data: MoleculeResult[]) => {
    const lines: string[] = [];
    lines.push('Molecule,Type,Grid,Points,CPU median (ms),GPU median (ms),Speedup,CPU trials (ms),GPU trials (ms)');
    for (const mr of data) {
      for (const r of mr.moResults) {
        const cpuAll = r.cpuTrials.map(t => t.totalMs.toFixed(1)).join(';');
        const gpuAll = r.gpuTrials.map(t => t.totalMs.toFixed(1)).join(';');
        lines.push(`${mr.label},MO,${r.grid},${r.totalPoints},${r.cpuMs?.toFixed(1) ?? ''},${r.gpuMs?.toFixed(1) ?? ''},${r.speedup},"${cpuAll}","${gpuAll}"`);
      }
      for (const r of mr.densityResults) {
        const cpuAll = r.cpuTrials.map(t => t.totalMs.toFixed(1)).join(';');
        const gpuAll = r.gpuTrials.map(t => t.totalMs.toFixed(1)).join(';');
        lines.push(`${mr.label},Density,${r.grid},${r.totalPoints},${r.cpuMs?.toFixed(1) ?? ''},${r.gpuMs?.toFixed(1) ?? ''},${r.speedup},"${cpuAll}","${gpuAll}"`);
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `benchmark_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Benchmark: CPU vs GPU</h1>
      <p style={{ fontSize: 13, color: '#666', margin: '0 0 16px' }}>
        {numTrials} trials per measurement, median adopted. Grid sizes: {GRID_SIZES.join(', ')}
      </p>

      {loadError && <p style={{ fontSize: 13, color: '#e53e3e', marginBottom: 8 }}>{loadError}</p>}

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

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, fontSize: 13 }}>
        <span style={{ color: '#666' }}>Add files:</span>
        <input type="file" accept=".molden,.input" multiple onChange={handleFiles} style={{ fontSize: 12 }} />
      </div>

      <p style={{ fontSize: 13, marginBottom: 12 }}>
        <b>GPU:</b> {gpuCtx ? gpuName : 'Not initialized (will init on run)'}
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
          Trials:
          <select value={numTrials} onChange={e => setNumTrials(Number(e.target.value))} disabled={running} style={{ fontSize: 13 }}>
            {TRIAL_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button onClick={runBenchmark} disabled={molecules.length === 0 || running} style={btnStyle}>
          {running ? 'Running...' : 'Run All Benchmarks'}
        </button>
        {running && (
          <button onClick={() => { cancelRef.current = true; }} style={{ ...btnStyle, background: '#e53e3e', color: '#fff' }}>
            Cancel
          </button>
        )}
        {results.length > 0 && !running && (
          <button onClick={() => downloadCSV(results)} style={btnStyle}>Export CSV</button>
        )}
      </div>

      {status && <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>{status}</p>}

      {results.map((mr, ri) => (
        <div key={ri} style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, margin: '0 0 8px', borderBottom: '2px solid #2563eb', paddingBottom: 4 }}>
            {mr.label}
          </h2>

          <h3 style={{ fontSize: 14, margin: '8px 0 4px', color: '#333' }}>(1) MO Evaluation (HOMO)</h3>
          <ResultTable rows={mr.moResults} />

          <h3 style={{ fontSize: 14, margin: '12px 0 4px', color: '#333' }}>(2) Electron Density</h3>
          <ResultTable rows={mr.densityResults} />
        </div>
      ))}
    </div>
  );
}

// ── Result Table with expandable details ──
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
          <ResultRow key={r.grid} r={r} />
        ))}
      </tbody>
    </table>
  );
}

function ResultRow({ r }: { r: SingleResult }) {
  const [open, setOpen] = useState(false);
  const hasDetails = r.cpuTrials.length > 0 || r.gpuTrials.length > 0;

  return (
    <>
      <tr
        style={{ borderBottom: '1px solid #ddd', cursor: hasDetails ? 'pointer' : 'default' }}
        onClick={() => hasDetails && setOpen(o => !o)}
      >
        <td style={tdStyle}>
          {hasDetails && <span style={{ fontSize: 10, marginRight: 4, color: '#999' }}>{open ? '\u25BC' : '\u25B6'}</span>}
          {r.grid}
        </td>
        <td style={tdStyle}>{r.totalPoints.toLocaleString()}</td>
        <td style={tdStyle}>{fmt(r.cpuMs)}</td>
        <td style={tdStyle}>{fmt(r.gpuMs)}</td>
        <td style={{ ...tdStyle, fontWeight: 600, color: r.speedup !== '\u2014' ? '#2563eb' : '#999' }}>{r.speedup}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} style={{ padding: '4px 12px 8px', background: '#fafafa', fontSize: 11 }}>
            <TrialDetails label="CPU" trials={r.cpuTrials} />
            <TrialDetails label="GPU" trials={r.gpuTrials} />
          </td>
        </tr>
      )}
    </>
  );
}

function TrialDetails({ label, trials }: { label: string; trials: TrialResult[] }) {
  if (trials.length === 0) return null;
  const hasSteps = trials.some(t => t.steps && t.steps.length > 0);

  return (
    <div style={{ marginBottom: 4 }}>
      <b>{label}</b>
      <span style={{ marginLeft: 8, color: '#555' }}>
        {trials.map((t, i) => (
          <span key={i}>
            {i > 0 && ' | '}
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(t.totalMs)}</span>
          </span>
        ))}
      </span>
      {hasSteps && (
        <div style={{ marginTop: 2, marginLeft: 12, color: '#888' }}>
          {trials.map((t, ti) => (
            t.steps && t.steps.length > 0 && (
              <div key={ti}>
                Trial {ti + 1}: {t.steps.map((s, si) => (
                  <span key={si}>
                    {si > 0 && ', '}
                    MO{si + 1}={fmt(s)}
                  </span>
                ))}
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '6px 16px', fontSize: 13, fontWeight: 600, borderRadius: 6,
  border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer',
};
const thStyle: React.CSSProperties = { padding: '6px 10px', textAlign: 'right' };
const tdStyle: React.CSSProperties = { padding: '5px 10px', textAlign: 'right' };

createRoot(document.getElementById('root')!).render(<App />);
