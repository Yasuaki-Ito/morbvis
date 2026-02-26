/**
 * Benchmark: CPU vs GPU MO evaluation performance
 *
 * Usage: npm run dev → open http://localhost:5173/benchmark.html
 */
import { useState, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { parseMolden } from './core/moldenParser';
import { autoGrid, evaluateMOOnGrid } from './core/moEvaluator';
import { initGPU, evaluateMOOnGridGPU, type GPUContext } from './core/gpuEvaluator';
import type { MoldenData } from './types';

interface BenchResult {
  gridPoints: number;
  totalPoints: number;
  cpuMs: number | null;
  gpuMs: number | null;
  speedup: string;
}

const GRID_SIZES = [60, 80, 100, 120, 140, 160, 200];

function App() {
  const [moldenData, setMoldenData] = useState<MoldenData | null>(null);
  const [filename, setFilename] = useState('');
  const [selectedMO, setSelectedMO] = useState(0);
  const [gpuCtx, setGpuCtx] = useState<GPUContext | null>(null);
  const [gpuName, setGpuName] = useState('');
  const [results, setResults] = useState<BenchResult[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [skipCPU160, setSkipCPU160] = useState(true);
  const cancelRef = useRef(false);

  // Init GPU on mount
  const initGPUOnce = useCallback(async () => {
    const ctx = await initGPU();
    setGpuCtx(ctx);
    if (ctx) {
      const adapter = await navigator.gpu?.requestAdapter();
      const info = (adapter as any)?.info;
      const name = info?.device || info?.description || 'Unknown GPU';
      const vendor = info?.vendor || '';
      setGpuName(`${vendor} ${name}`.trim());
    }
  }, []);

  // Load file
  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = parseMolden(text);
      setMoldenData(data);
      setFilename(file.name);
      setSelectedMO(Math.max(0, data.molecularOrbitals.findIndex(mo => mo.occupation > 0
        && (data.molecularOrbitals[data.molecularOrbitals.indexOf(mo) + 1]?.occupation ?? 0) === 0
      )));
      if (!gpuCtx) await initGPUOnce();
    } catch (err) {
      alert('Failed to parse file: ' + (err as Error).message);
    }
  }, [gpuCtx, initGPUOnce]);

  // Load sample
  const loadSample = useCallback(async () => {
    try {
      const resp = await fetch('molden_files/index.json');
      const files: string[] = await resp.json();
      if (files.length === 0) return;
      // Pick H2O if available, else first
      const target = files.find(f => f.toLowerCase().includes('h2o')) || files[0];
      const text = await (await fetch(`molden_files/${target}`)).text();
      const data = parseMolden(text);
      setMoldenData(data);
      setFilename(target);
      // Find HOMO
      let homo = 0;
      for (let i = 0; i < data.molecularOrbitals.length; i++) {
        if (data.molecularOrbitals[i].occupation > 0) homo = i;
      }
      setSelectedMO(homo);
      if (!gpuCtx) await initGPUOnce();
    } catch (err) {
      alert('Failed to load sample: ' + (err as Error).message);
    }
  }, [gpuCtx, initGPUOnce]);

  // Run benchmark
  const runBenchmark = useCallback(async () => {
    if (!moldenData) return;
    setRunning(true);
    cancelRef.current = false;
    setResults([]);

    const { shells, molecularOrbitals, useSphericalD, useSphericalF } = moldenData;
    const mo = molecularOrbitals[selectedMO];
    if (!mo) { setRunning(false); return; }
    const coeffs = mo.coefficients;

    const newResults: BenchResult[] = [];

    for (const gp of GRID_SIZES) {
      if (cancelRef.current) break;
      const grid = autoGrid(shells, gp);
      const totalPoints = grid.size.x * grid.size.y * grid.size.z;

      setStatus(`Grid ${gp} (${totalPoints.toLocaleString()} points)...`);

      // CPU benchmark
      let cpuMs: number | null = null;
      if (!(skipCPU160 && gp > 160)) {
        setStatus(`Grid ${gp} — CPU computing...`);
        const cpuStart = performance.now();
        evaluateMOOnGrid(shells, coeffs, grid, useSphericalD, useSphericalF);
        cpuMs = performance.now() - cpuStart;
      }

      if (cancelRef.current) break;

      // GPU benchmark
      let gpuMs: number | null = null;
      if (gpuCtx) {
        setStatus(`Grid ${gp} — GPU computing...`);
        // Warm up (first call may include compilation)
        if (gp === GRID_SIZES[0]) {
          await evaluateMOOnGridGPU(gpuCtx, shells, coeffs, grid, useSphericalD, useSphericalF);
        }
        const gpuStart = performance.now();
        await evaluateMOOnGridGPU(gpuCtx, shells, coeffs, grid, useSphericalD, useSphericalF);
        gpuMs = performance.now() - gpuStart;
      }

      const speedup = (cpuMs != null && gpuMs != null && gpuMs > 0)
        ? `${(cpuMs / gpuMs).toFixed(1)}x`
        : '—';

      const result: BenchResult = { gridPoints: gp, totalPoints, cpuMs, gpuMs, speedup };
      newResults.push(result);
      setResults([...newResults]);
    }

    setStatus('Done');
    setRunning(false);
  }, [moldenData, selectedMO, gpuCtx, skipCPU160]);

  const fmt = (ms: number | null) => ms == null ? '—' : ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 24 }}>MOrbVis Benchmark: CPU vs GPU</h1>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <input type="file" accept=".molden,.input" onChange={handleFile} />
      </div>

      {moldenData && (
        <div style={{ marginBottom: 16, fontSize: 14 }}>
          <p><b>File:</b> {filename} — {moldenData.atoms.length} atoms, {moldenData.molecularOrbitals.length} MOs, {moldenData.shells.length} shells</p>
          <p><b>Spherical:</b> D={moldenData.useSphericalD ? '5d' : '6d'}, F={moldenData.useSphericalF ? '7f' : '10f'}</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label>MO index:
              <select value={selectedMO} onChange={e => setSelectedMO(Number(e.target.value))} style={{ marginLeft: 4 }}>
                {moldenData.molecularOrbitals.map((mo, i) => (
                  <option key={i} value={i}>
                    {i} (E={mo.energy.toFixed(4)}, occ={mo.occupation})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p><b>GPU:</b> {gpuCtx ? `Available — ${gpuName}` : 'Not available (CPU only)'}</p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <button onClick={runBenchmark} disabled={!moldenData || running} style={btnStyle}>
          {running ? 'Running...' : 'Run Benchmark'}
        </button>
        {running && (
          <button onClick={() => { cancelRef.current = true; }} style={{ ...btnStyle, background: '#e53e3e', color: '#fff' }}>
            Cancel
          </button>
        )}
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={skipCPU160} onChange={e => setSkipCPU160(e.target.checked)} />
          Skip CPU for grid &gt; 160
        </label>
      </div>

      {status && <p style={{ fontSize: 13, color: '#666' }}>{status}</p>}

      {results.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #333' }}>
              <th style={thStyle}>Grid</th>
              <th style={thStyle}>Points</th>
              <th style={thStyle}>CPU</th>
              <th style={thStyle}>GPU</th>
              <th style={thStyle}>Speedup</th>
            </tr>
          </thead>
          <tbody>
            {results.map(r => (
              <tr key={r.gridPoints} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={tdStyle}>{r.gridPoints}</td>
                <td style={tdStyle}>{r.totalPoints.toLocaleString()}</td>
                <td style={tdStyle}>{fmt(r.cpuMs)}</td>
                <td style={tdStyle}>{fmt(r.gpuMs)}</td>
                <td style={{ ...tdStyle, fontWeight: 600, color: r.speedup !== '—' ? '#2563eb' : '#999' }}>{r.speedup}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {results.length > 0 && !running && (
        <div style={{ marginTop: 16 }}>
          <button onClick={() => {
            const lines = ['Grid,Points,CPU (ms),GPU (ms),Speedup'];
            for (const r of results) {
              lines.push(`${r.gridPoints},${r.totalPoints},${r.cpuMs?.toFixed(0) ?? ''},${r.gpuMs?.toFixed(0) ?? ''},${r.speedup}`);
            }
            const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `benchmark_${filename.replace(/\.\w+$/, '')}.csv`;
            a.click();
            URL.revokeObjectURL(a.href);
          }} style={btnStyle}>
            Export CSV
          </button>
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '6px 16px', fontSize: 13, fontWeight: 600, borderRadius: 6,
  border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer',
};
const thStyle: React.CSSProperties = { padding: '8px 12px', textAlign: 'right' };
const tdStyle: React.CSSProperties = { padding: '6px 12px', textAlign: 'right' };

createRoot(document.getElementById('root')!).render(<App />);
