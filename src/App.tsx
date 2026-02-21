import { useState, useCallback, useRef, useEffect } from 'react';
import type { MoldenData, IsosurfaceMesh, Grid3D, RenderSettings, MOWorkerResponse } from './types';
import { parseMolden } from './core/moldenParser';
import { autoGrid, evaluateMOOnGrid } from './core/moEvaluator';
import { marchingCubes } from './core/marchingCubes';
import { MoleculeViewer } from './components/MoleculeViewer';
import { FileUpload } from './components/FileUpload';
import { MOSelector } from './components/MOSelector';
import { ControlPanel } from './components/ControlPanel';
import { getTheme, type ThemeMode } from './theme';

export default function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');
  const theme = getTheme(themeMode);

  const [moldenData, setMoldenData] = useState<MoldenData | null>(null);
  const [filename, setFilename] = useState<string>('');
  const [selectedMO, setSelectedMO] = useState(0);
  const [isovalue, setIsovalue] = useState(0.04);
  const [gridPoints, setGridPoints] = useState(60);
  const [computing, setComputing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [positiveMesh, setPositiveMesh] = useState<IsosurfaceMesh | null>(null);
  const [negativeMesh, setNegativeMesh] = useState<IsosurfaceMesh | null>(null);
  const [scalarField, setScalarField] = useState<Float64Array | null>(null);
  const [gridInfo, setGridInfo] = useState<Grid3D | null>(null);

  const [renderSettings, setRenderSettings] = useState<RenderSettings>({
    surfaceMode: 'solid',
    opacity: 0.8,
    colorScheme: 'classic',
    preset: 'standard',
    atomScale: 1.0,
    bondScale: 1.0,
    lightDirection: 'front',
  });

  const [sampleFiles, setSampleFiles] = useState<string[]>([]);

  // Fetch sample file list
  useEffect(() => {
    fetch('./molden_files/index.json')
      .then((r) => r.ok ? r.json() : [])
      .then((list: string[]) => setSampleFiles(list))
      .catch(() => setSampleFiles([]));
  }, []);

  const workerRef = useRef<Worker | null>(null);
  // Cache: key = "moIndex:gridPoints" → { field, grid }
  const fieldCacheRef = useRef<Map<string, { field: Float64Array; grid: Grid3D }>>(new Map());

  // Initialize Worker
  useEffect(() => {
    const worker = new Worker(
      new URL('./workers/moWorker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;

    worker.onerror = (e) => {
      console.error('Worker error:', e);
      setComputing(false);
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // Load Molden file
  const handleFileLoaded = useCallback((text: string, name: string) => {
    try {
      const data = parseMolden(text);
      console.log('Parsed Molden:', data.atoms.length, 'atoms,', data.molecularOrbitals.length, 'MOs');
      fieldCacheRef.current.clear();
      setMoldenData(data);
      setFilename(name);
      // Select HOMO by default (last orbital with occupation > 0)
      let homo = 0;
      for (let i = 0; i < data.molecularOrbitals.length; i++) {
        if (data.molecularOrbitals[i].occupation > 0) homo = i;
      }
      setSelectedMO(homo);
      setComputing(true);
      setProgress(0);
      setScalarField(null);
      setPositiveMesh(null);
      setNegativeMesh(null);
    } catch (e) {
      console.error('Parse error:', e);
      alert('Failed to parse Molden file');
    }
  }, []);

  // Load sample file
  const loadSampleFile = useCallback((name: string) => {
    fetch(`./molden_files/${name}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch ${name}`);
        return r.text();
      })
      .then((text) => handleFileLoaded(text, name))
      .catch((e) => {
        console.error(e);
        alert(`Failed to load sample file: ${name}`);
      });
  }, [handleFileLoaded]);

  // Compute MO (instant display on cache hit)
  const computeMO = useCallback((data: MoldenData, moIndex: number, gp: number) => {
    const cacheKey = `${moIndex}:${gp}`;
    const cached = fieldCacheRef.current.get(cacheKey);

    if (cached) {
      console.log(`Cache hit: MO ${moIndex}, grid ${gp}`);
      setScalarField(null);
      setPositiveMesh(null);
      setNegativeMesh(null);
      setGridInfo(cached.grid);
      setScalarField(cached.field);
      return;
    }

    const grid = autoGrid(data.shells, gp);
    setComputing(true);
    setProgress(0);
    setScalarField(null);
    setPositiveMesh(null);
    setNegativeMesh(null);
    setGridInfo(grid);

    const onResult = (field: Float64Array) => {
      fieldCacheRef.current.set(cacheKey, { field, grid });
      setScalarField(field);
      setComputing(false);
    };

    const worker = workerRef.current;
    if (worker) {
      worker.onmessage = (e: MessageEvent<MOWorkerResponse>) => {
        if (e.data.type === 'progress') {
          setProgress(e.data.percent);
          return;
        }
        console.log('Worker result received, grid:', e.data.gridSize);
        onResult(e.data.scalarField);
      };

      worker.postMessage({
        type: 'evaluate',
        shells: data.shells,
        moCoefficients: data.molecularOrbitals[moIndex].coefficients,
        grid,
        useSphericalD: data.useSphericalD,
        useSphericalF: data.useSphericalF,
      });
    } else {
      console.warn('Worker unavailable, computing on main thread');
      setTimeout(() => {
        const field = evaluateMOOnGrid(
          data.shells,
          data.molecularOrbitals[moIndex].coefficients,
          grid,
          data.useSphericalD,
          data.useSphericalF,
        );
        onResult(field);
      }, 0);
    }
  }, []);

  // Recompute on MO selection or grid size change
  useEffect(() => {
    if (moldenData && moldenData.molecularOrbitals.length > selectedMO) {
      computeMO(moldenData, selectedMO, gridPoints);
    }
  }, [moldenData, selectedMO, gridPoints, computeMO]);

  // Regenerate isosurface on scalarField or isovalue change
  useEffect(() => {
    if (!scalarField || !gridInfo) return;

    const { size, origin, spacing } = gridInfo;
    const nx = size.x, ny = size.y, nz = size.z;
    const orig: [number, number, number] = [origin.x, origin.y, origin.z];

    try {
      // Debug: field statistics
      let fmin = Infinity, fmax = -Infinity;
      for (let i = 0; i < scalarField.length; i++) {
        if (scalarField[i] < fmin) fmin = scalarField[i];
        if (scalarField[i] > fmax) fmax = scalarField[i];
      }
      console.log(`Field: min=${fmin.toFixed(6)}, max=${fmax.toFixed(6)}, grid=${nx}x${ny}x${nz}, iso=${isovalue}`);

      // Positive isosurface: psi = +isovalue
      const posMesh = marchingCubes(scalarField, nx, ny, nz, isovalue, orig, spacing);

      // Negative isosurface: negate field to extract psi = -isovalue surface
      const negField = new Float64Array(scalarField.length);
      for (let i = 0; i < scalarField.length; i++) {
        negField[i] = -scalarField[i];
      }
      const negMesh = marchingCubes(negField, nx, ny, nz, isovalue, orig, spacing);

      console.log('Isosurfaces: +', posMesh.vertices.length / 3, 'verts, -', negMesh.vertices.length / 3, 'verts');

      setPositiveMesh(posMesh.vertices.length > 0 ? posMesh : null);
      setNegativeMesh(negMesh.vertices.length > 0 ? negMesh : null);
    } catch (e) {
      console.error('Marching cubes error:', e);
      setPositiveMesh(null);
      setNegativeMesh(null);
    }
  }, [scalarField, isovalue, gridInfo]);

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      fontFamily: "'Segoe UI', sans-serif",
      color: theme.text,
      background: theme.bg,
    }}>
      {/* Side panel */}
      <div style={{
        width: 280,
        minWidth: 280,
        padding: 16,
        background: theme.sidebarBg,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        overflowY: 'auto',
        borderRight: `1px solid ${theme.sidebarBorder}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: theme.accent, display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src="icon.png" alt="" style={{ width: 24, height: 24, background: themeMode === 'dark' ? '#e0e0e0' : 'transparent', borderRadius: '50%' }} />
            MOrbVis
          </div>
          <button
            onClick={() => setThemeMode(m => m === 'light' ? 'dark' : 'light')}
            style={{
              background: theme.accentBg,
              border: `1px solid ${theme.sidebarBorder}`,
              borderRadius: 6,
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: 14,
              color: theme.textSecondary,
            }}
            title={themeMode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {themeMode === 'light' ? '\u263E' : '\u2600'}
          </button>
        </div>

        <FileUpload onFileLoaded={handleFileLoaded} theme={theme} />

        {sampleFiles.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) loadSampleFile(e.target.value);
            }}
            style={{
              width: '100%',
              padding: '6px 8px',
              fontSize: 13,
              background: theme.accentBg,
              color: theme.text,
              border: `1px solid ${theme.sidebarBorder}`,
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            <option value="">-- Select sample file --</option>
            {sampleFiles.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        )}

        {filename && (
          <div style={{ fontSize: 12, color: theme.textMuted }}>
            {filename}
            {moldenData && (
              <>
                <br />
                {moldenData.atoms.length} atoms, {moldenData.molecularOrbitals.length} MOs
              </>
            )}
          </div>
        )}

        {moldenData && (
          <>
            <MOSelector
              orbitals={moldenData.molecularOrbitals}
              selectedIndex={selectedMO}
              onSelect={setSelectedMO}
              theme={theme}
              disabled={computing}
            />
            <ControlPanel
              isovalue={isovalue}
              onIsovalueChange={setIsovalue}
              gridPoints={gridPoints}
              onGridPointsChange={setGridPoints}
              computing={computing}
              theme={theme}
              renderSettings={renderSettings}
              onRenderSettingsChange={setRenderSettings}
            />
          </>
        )}
      </div>

      {/* 3D Viewer */}
      <div style={{ flex: 1, position: 'relative' }}>
        {moldenData ? (
          <MoleculeViewer
            atoms={moldenData.atoms}
            positiveMesh={computing ? null : positiveMesh}
            negativeMesh={computing ? null : negativeMesh}
            canvasBg={theme.canvasBg}
            renderSettings={renderSettings}
          />
        ) : (
          <div style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: theme.textMuted,
            fontSize: 18,
          }}>
            Load a Molden file to begin
          </div>
        )}
        {computing && (
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.3)',
            pointerEvents: 'none',
          }}>
            <div style={{
              background: theme.sidebarBg,
              borderRadius: 12,
              padding: '16px 32px',
              fontSize: 15,
              color: theme.accent,
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}>
              <svg width="20" height="20" viewBox="0 0 20 20" style={{ animation: 'spin 1s linear infinite' }}>
                <circle cx="10" cy="10" r="8" fill="none" stroke={theme.sidebarBorder} strokeWidth="2.5" />
                <circle cx="10" cy="10" r="8" fill="none" stroke={theme.accent} strokeWidth="2.5"
                  strokeDasharray="20 32" strokeLinecap="round" />
              </svg>
              Computing... {progress}%
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
