import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { flushSync } from 'react-dom';
import type { MoldenData, IsosurfaceMesh, Grid3D, RenderSettings, MOWorkerResponse, DensityWorkerResponse } from './types';
import { parseMolden } from './core/moldenParser';
import { parseCubeFile, exportCubeFile } from './core/cubeFile';
import { parseXYZ } from './core/xyzParser';
import { planeFromAtoms, planeFromBond } from './core/atomPlane';
import { CITATION, formattedCitation, bibtexEntry } from './core/citation';
import { generateAOLabels } from './core/aoLabels';
import { AODecomposition } from './components/AODecomposition';
import { autoGrid, evaluateMOOnGrid } from './core/moEvaluator';
import { initGPU, evaluateMOOnGridGPU, type GPUContext } from './core/gpuEvaluator';
import { marchingCubes } from './core/marchingCubes';
import { MoleculeViewer, COLOR_SCHEMES, type MoleculeViewerHandle, type CrossSectionState, type MeasurementMode } from './components/MoleculeViewer';
import { CrossSectionCanvas } from './components/CrossSectionCanvas';
import { FileUpload } from './components/FileUpload';
import { MOSelector } from './components/MOSelector';
import { ControlPanel, CollapsibleSection } from './components/ControlPanel';
import { EnergyDiagram } from './components/EnergyDiagram';
import { getTheme, type ThemeMode } from './theme';
import { exportSTL } from './utils/exportSTL';
import { PeriodicTable } from './components/PeriodicTable';
import { createT, type Locale } from './i18n';

export default function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');
  const theme = getTheme(themeMode);
  const [locale, setLocale] = useState<Locale>(() => (localStorage.getItem('morbvis-locale') as Locale) || 'en');
  const t = createT(locale);

  useEffect(() => { localStorage.setItem('morbvis-locale', locale); }, [locale]);

  const [moldenData, setMoldenData] = useState<MoldenData | null>(null);
  const [filename, setFilename] = useState<string>('');
  const [selectedMO, setSelectedMO] = useState(0);
  const [isovalue, setIsovalue] = useState(0.04);
  const moIsovalueRef = useRef(0.04);
  const densityIsovalueRef = useRef(0.005);
  const [gridPoints, setGridPoints] = useState(60);
  const [computing, setComputing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [positiveMesh, setPositiveMesh] = useState<IsosurfaceMesh | null>(null);
  const [negativeMesh, setNegativeMesh] = useState<IsosurfaceMesh | null>(null);
  const [scalarField, setScalarField] = useState<Float64Array | null>(null);
  const [gridInfo, setGridInfo] = useState<Grid3D | null>(null);

  // Compare MO state
  const [compareMO, setCompareMO] = useState<number | null>(null);
  const [compareComputing, setCompareComputing] = useState(false);
  const [compareProgress, setCompareProgress] = useState(0);
  const [comparePositiveMesh, setComparePositiveMesh] = useState<IsosurfaceMesh | null>(null);
  const [compareNegativeMesh, setCompareNegativeMesh] = useState<IsosurfaceMesh | null>(null);
  const [compareScalarField, setCompareScalarField] = useState<Float64Array | null>(null);

  // Density mode state
  const [viewMode, setViewMode] = useState<'mo' | 'density'>('mo');
  const [densityField, setDensityField] = useState<Float64Array | null>(null);
  const [densityGridInfo, setDensityGridInfo] = useState<Grid3D | null>(null);
  const [densityComputing, setDensityComputing] = useState(false);
  const [densityProgress, setDensityProgress] = useState('');

  const [renderSettings, setRenderSettings] = useState<RenderSettings>({
    surfaceMode: 'solid',
    opacity: 0.8,
    colorScheme: 'classic',
    preset: 'standard',
    atomScale: 1.0,
    bondScale: 1.0,
    lightDirection: 'front',
    lightIntensity: 1.0,
    customColors: ['#4488ff', '#ff4444'],
    densityColor: '#4488ff',
    showAtomLabels: false,
    canvasColor: '',
    atomColors: {},
    useGPU: true,
    showIsosurface: true,
  });

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [showAtomColors, setShowAtomColors] = useState(false);
  const [showCitation, setShowCitation] = useState(false);
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>('off');
  const [measureCount, setMeasureCount] = useState(0);
  const [measureClearTick, setMeasureClearTick] = useState(0);

  // AO decomposition state
  const [overlayAOIndex, setOverlayAOIndex] = useState<number | null>(null);
  const [aoOverlayPositiveMesh, setAOOverlayPositiveMesh] = useState<IsosurfaceMesh | null>(null);
  const [aoOverlayNegativeMesh, setAOOverlayNegativeMesh] = useState<IsosurfaceMesh | null>(null);
  const [cumulativeK, setCumulativeK] = useState<number | null>(null);
  const [cumulativeField, setCumulativeField] = useState<Float64Array | null>(null);
  const [aoShowThreshold, setAOShowThreshold] = useState(0.05);

  // AO labels (memoized)
  const aoLabels = useMemo(() => {
    if (!moldenData || moldenData.shells.length === 0) return [];
    return generateAOLabels(
      moldenData.shells,
      moldenData.atoms,
      moldenData.useSphericalD,
      moldenData.useSphericalF,
      moldenData.useSphericalG,
    );
  }, [moldenData]);

  // Async grid evaluation helper (GPU when available, CPU fallback)
  const evaluateOnGridAsync = useCallback(async (coeffs: number[], grid: Grid3D): Promise<Float64Array> => {
    if (!moldenData) throw new Error('No molden data');
    if (renderSettings.useGPU && gpuCtxRef.current) {
      try {
        return await evaluateMOOnGridGPU(
          gpuCtxRef.current,
          moldenData.shells,
          coeffs,
          grid,
          moldenData.useSphericalD,
          moldenData.useSphericalF,
          moldenData.useSphericalG,
        );
      } catch (err) {
        console.error('GPU AO eval failed, falling back to CPU:', err);
      }
    }
    return evaluateMOOnGrid(
      moldenData.shells,
      coeffs,
      grid,
      moldenData.useSphericalD,
      moldenData.useSphericalF,
      moldenData.useSphericalG,
    );
  }, [moldenData, renderSettings.useGPU]);

  // Batch export state
  const viewerRef = useRef<MoleculeViewerHandle>(null);
  const batchExportingRef = useRef(false);
  const [batchExporting, setBatchExporting] = useState(false);
  const [batchProgress, setBatchProgress] = useState('');
  const [showBatchPopup, setShowBatchPopup] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<number>>(new Set());
  const [batchDpi, setBatchDpi] = useState(2);
  const [batchTransparent, setBatchTransparent] = useState(false);

  // Toast notification
  const [toast, setToast] = useState<{ message: string; key: number } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, key: Date.now() });
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  }, []);

  // Cross-section state
  const [hqMode, setHqMode] = useState(false);
  const [ssaoIntensity, setSsaoIntensity] = useState(3);
  const [crossSection, setCrossSection] = useState<CrossSectionState>({
    enabled: false,
    plane: 'XY',
    position: 0,
    showContours: true,
    showAtoms: false,
    planeAtoms: [],
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
  const compareWorkerRef = useRef<Worker | null>(null);
  const densityWorkerRef = useRef<Worker | null>(null);
  const gpuCtxRef = useRef<GPUContext | null>(null);
  const [gpuAvailable, setGpuAvailable] = useState(false);
  const computeGenRef = useRef(0); // generation counter to discard stale results
  // Cache: key = "moIndex:gridPoints" → { field, grid }
  const fieldCacheRef = useRef<Map<string, { field: Float64Array; grid: Grid3D }>>(new Map());
  // Density cache: key = "density:gridPoints"
  const densityCacheRef = useRef<Map<string, { field: Float64Array; grid: Grid3D }>>(new Map());

  // Initialize Workers
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

    const compareWorker = new Worker(
      new URL('./workers/moWorker.ts', import.meta.url),
      { type: 'module' },
    );
    compareWorkerRef.current = compareWorker;

    compareWorker.onerror = (e) => {
      console.error('Compare worker error:', e);
      setCompareComputing(false);
    };

    const densityWorker = new Worker(
      new URL('./workers/densityWorker.ts', import.meta.url),
      { type: 'module' },
    );
    densityWorkerRef.current = densityWorker;

    densityWorker.onerror = (e) => {
      console.error('Density worker error:', e);
      setDensityComputing(false);
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
      compareWorker.terminate();
      compareWorkerRef.current = null;
      densityWorker.terminate();
      densityWorkerRef.current = null;
    };
  }, []);

  // Initialize WebGPU
  useEffect(() => {
    let cancelled = false;
    initGPU().then(ctx => {
      if (cancelled) return;
      gpuCtxRef.current = ctx;
      setGpuAvailable(ctx !== null);
      if (ctx) console.log('WebGPU compute ready');
    }).catch(() => {
      if (!cancelled) setGpuAvailable(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Load file (Molden, Cube, or XYZ)
  const handleFileLoaded = useCallback((text: string, name: string) => {
    try {
      const lowerName = name.toLowerCase();
      if (lowerName.endsWith('.xyz')) {
        // XYZ file: atoms only, no orbitals
        const xyzData = parseXYZ(text);
        console.log('Parsed XYZ:', xyzData.atoms.length, 'atoms');
        fieldCacheRef.current.clear();
        setMoldenData({
          atoms: xyzData.atoms,
          shells: [],
          molecularOrbitals: [],
          useSphericalD: false,
          useSphericalF: false,
          useSphericalG: false,
        });
        setFilename(name);
        setSelectedMO(0);
        setCompareMO(null);
        setComputing(false);
        setProgress(0);
        setCompareComputing(false);
        setCompareProgress(0);
        setDensityComputing(false);
        setDensityProgress('');
        computeGenRef.current++;
        setGridInfo(null);
        setScalarField(null);
        setPositiveMesh(null);
        setNegativeMesh(null);
        setComparePositiveMesh(null);
        setCompareNegativeMesh(null);
        setCompareScalarField(null);
        setViewMode('mo');
        setDensityField(null);
        setDensityGridInfo(null);
        densityCacheRef.current.clear();
        return;
      }
      if (lowerName.endsWith('.cube')) {
        // Cube file: pre-computed volumetric data
        const cubeData = parseCubeFile(text);
        console.log('Parsed Cube:', cubeData.atoms.length, 'atoms, grid', cubeData.grid.size.x, 'x', cubeData.grid.size.y, 'x', cubeData.grid.size.z);
        fieldCacheRef.current.clear();
        setMoldenData({
          atoms: cubeData.atoms,
          shells: [],
          molecularOrbitals: [],
          useSphericalD: false,
          useSphericalF: false,
          useSphericalG: false,
        });
        setFilename(name);
        setSelectedMO(0);
        setCompareMO(null);
        setComputing(false);
        setProgress(0);
        setCompareComputing(false);
        setCompareProgress(0);
        setDensityComputing(false);
        setDensityProgress('');
        computeGenRef.current++;
        setGridInfo(cubeData.grid);
        setScalarField(cubeData.scalarField);
        setPositiveMesh(null);
        setNegativeMesh(null);
        setComparePositiveMesh(null);
        setCompareNegativeMesh(null);
        setCompareScalarField(null);
        setViewMode('mo');
        setDensityField(null);
        setDensityGridInfo(null);
        densityCacheRef.current.clear();
        return;
      }

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
      setCompareMO(null);
      setComputing(true);
      setProgress(0);
      setCompareComputing(false);
      setCompareProgress(0);
      setDensityComputing(false);
      setDensityProgress('');
      computeGenRef.current++;
      setScalarField(null);
      setPositiveMesh(null);
      setNegativeMesh(null);
      setComparePositiveMesh(null);
      setCompareNegativeMesh(null);
      setCompareScalarField(null);
      setViewMode('mo');
      setDensityField(null);
      setDensityGridInfo(null);
      densityCacheRef.current.clear();
    } catch (e) {
      console.error('Parse error:', e);
      alert(t('app.parseFailed'));
    }
  }, []);

  // GANSU-web integration: auto-load Molden data from sessionStorage
  useEffect(() => {
    const moldenText = sessionStorage.getItem('gansu-molden');
    if (moldenText) {
      sessionStorage.removeItem('gansu-molden');
      handleFileLoaded(moldenText, 'gansu-web.molden');
    }
  }, [handleFileLoaded]);

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
        alert(`${t('app.sampleFailed')}: ${name}`);
      });
  }, [handleFileLoaded]);

  // Compute MO (instant display on cache hit)
  const computeMO = useCallback((data: MoldenData, moIndex: number, gp: number) => {
    const cacheKey = `${moIndex}:${gp}`;
    const cached = fieldCacheRef.current.get(cacheKey);

    if (cached) {
      console.log(`Cache hit: MO ${moIndex}, grid ${gp}`);
      setGridInfo(cached.grid);
      setScalarField(cached.field);
      return;
    }

    const grid = autoGrid(data.shells, gp);
    const gen = ++computeGenRef.current;
    setComputing(true);
    setProgress(0);

    const onResult = (field: Float64Array) => {
      if (gen !== computeGenRef.current) return; // stale result, discard
      fieldCacheRef.current.set(cacheKey, { field, grid });
      setGridInfo(grid);
      setScalarField(field);
      // computing = false is set by the marching cubes useEffect after mesh generation
    };

    // Defer dispatch to next frame so the computing overlay is painted first
    requestAnimationFrame(() => {
      if (gen !== computeGenRef.current) return; // already superseded

      // GPU path
      if (renderSettings.useGPU && gpuCtxRef.current) {
        const t0 = performance.now();
        evaluateMOOnGridGPU(
          gpuCtxRef.current,
          data.shells,
          data.molecularOrbitals[moIndex].coefficients,
          grid,
          data.useSphericalD,
          data.useSphericalF,
          data.useSphericalG,
        ).then(field => {
          console.log(`GPU compute: ${(performance.now() - t0).toFixed(1)} ms`);
          onResult(field);
        }).catch(err => {
          console.error('GPU compute failed, falling back to CPU:', err);
          computeMOCPU(data, moIndex, grid, onResult);
        });
        return;
      }

      // CPU path (Web Worker)
      computeMOCPU(data, moIndex, grid, onResult);
    });
  }, [renderSettings.useGPU]);

  // CPU compute helper (Web Worker or main thread fallback)
  const computeMOCPU = useCallback((data: MoldenData, moIndex: number, grid: Grid3D, onResult: (field: Float64Array) => void) => {
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
        useSphericalG: data.useSphericalG,
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
          data.useSphericalG,
        );
        onResult(field);
      }, 0);
    }
  }, []);

  // Recompute on MO selection or grid size change
  useEffect(() => {
    if (batchExportingRef.current) return; // batch export manages meshes directly
    if (viewMode === 'mo' && moldenData && moldenData.molecularOrbitals.length > selectedMO) {
      computeMO(moldenData, selectedMO, gridPoints);
    }
  }, [moldenData, selectedMO, gridPoints, computeMO, viewMode]);

  // Recompute density when grid resolution changes in density mode
  useEffect(() => {
    if (viewMode === 'density' && moldenData && moldenData.shells.length > 0) {
      computeDensity();
    }
  }, [gridPoints]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute electron density
  const computeDensity = useCallback(() => {
    if (!moldenData || moldenData.molecularOrbitals.length === 0 || moldenData.shells.length === 0) return;

    const cacheKey = `density:${gridPoints}`;
    const cached = densityCacheRef.current.get(cacheKey);
    if (cached) {
      setDensityField(cached.field);
      setDensityGridInfo(cached.grid);
      setViewMode('density');
      return;
    }

    const grid = autoGrid(moldenData.shells, gridPoints);
    const occupiedMOs = moldenData.molecularOrbitals
      .filter((mo) => mo.occupation > 0)
      .map((mo) => ({ coefficients: mo.coefficients, occupation: mo.occupation }));

    if (occupiedMOs.length === 0) return;

    setDensityComputing(true);
    setDensityProgress('');
    setViewMode('density');

    const onDensityResult = (field: Float64Array) => {
      densityCacheRef.current.set(cacheKey, { field, grid });
      setDensityField(field);
      setDensityGridInfo(grid);
      // densityComputing = false is set by the marching cubes useEffect after mesh generation
    };

    // GPU path
    if (renderSettings.useGPU && gpuCtxRef.current) {
      const gpuCtx = gpuCtxRef.current;
      const totalPoints = grid.size.x * grid.size.y * grid.size.z;
      const density = new Float64Array(totalPoints);
      const t0 = performance.now();

      (async () => {
        for (let m = 0; m < occupiedMOs.length; m++) {
          const mo = occupiedMOs[m];
          setDensityProgress(`⚡ MO ${m + 1}/${occupiedMOs.length}`);
          const moField = await evaluateMOOnGridGPU(
            gpuCtx,
            moldenData.shells,
            mo.coefficients,
            grid,
            moldenData.useSphericalD,
            moldenData.useSphericalF,
            moldenData.useSphericalG,
          );
          const occ = mo.occupation;
          for (let i = 0; i < totalPoints; i++) {
            density[i] += occ * moField[i] * moField[i];
          }
        }
        console.log(`GPU density compute: ${(performance.now() - t0).toFixed(1)} ms (${occupiedMOs.length} MOs)`);
        onDensityResult(density);
      })().catch(err => {
        console.error('GPU density failed, falling back to CPU:', err);
        computeDensityCPU(moldenData, occupiedMOs, grid, onDensityResult);
      });
      return;
    }

    // CPU path
    computeDensityCPU(moldenData, occupiedMOs, grid, onDensityResult);
  }, [moldenData, gridPoints, renderSettings.useGPU]);

  // CPU density compute helper (Web Worker)
  const computeDensityCPU = useCallback((
    data: MoldenData,
    occupiedMOs: { coefficients: number[]; occupation: number }[],
    grid: Grid3D,
    onResult: (field: Float64Array) => void,
  ) => {
    const worker = densityWorkerRef.current;
    if (worker) {
      worker.onmessage = (e: MessageEvent<DensityWorkerResponse>) => {
        if (e.data.type === 'progress') {
          setDensityProgress(`🖥️ MO ${e.data.currentMO}/${e.data.totalMOs} (${e.data.percent}%)`);
          return;
        }
        onResult(e.data.scalarField);
      };
      worker.postMessage({
        type: 'density',
        shells: data.shells,
        occupiedMOs,
        grid,
        useSphericalD: data.useSphericalD,
        useSphericalF: data.useSphericalF,
        useSphericalG: data.useSphericalG,
      });
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in input/select
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        setShowHelp((v) => !v);
        return;
      }
      if (e.key === 'Escape' && showHelp) {
        setShowHelp(false);
        return;
      }

      if (!moldenData || computing || compareComputing || viewMode === 'density') return;
      const moCount = moldenData.molecularOrbitals.length;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          setSelectedMO((i) => Math.max(0, i - 1));
          break;
        case 'ArrowRight':
          e.preventDefault();
          setSelectedMO((i) => Math.min(moCount - 1, i + 1));
          break;
        case ' ':
          e.preventDefault();
          // Find HOMO
          for (let i = moCount - 1; i >= 0; i--) {
            if (moldenData.molecularOrbitals[i].occupation > 0) {
              setSelectedMO(i);
              break;
            }
          }
          break;
        case 'Escape':
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [moldenData, computing, compareComputing, showHelp, viewMode]);

  // Active field depending on view mode (cumulative AO partial sum overrides MO field when active)
  const activeField = viewMode === 'density'
    ? densityField
    : (cumulativeK !== null && cumulativeField ? cumulativeField : scalarField);
  const activeGrid = viewMode === 'density' ? densityGridInfo : gridInfo;

  // Compute cumulative partial-sum field (top-K AOs by |coefficient|)
  useEffect(() => {
    if (cumulativeK === null || !moldenData || !gridInfo || viewMode !== 'mo') {
      setCumulativeField(null);
      return;
    }
    const mo = moldenData.molecularOrbitals[selectedMO];
    if (!mo) { setCumulativeField(null); return; }

    const indexed = mo.coefficients.map((c, i) => ({ c, i }));
    indexed.sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
    const topK = new Set(indexed.slice(0, cumulativeK).map((x) => x.i));
    const coeffs = mo.coefficients.map((c, i) => (topK.has(i) ? c : 0));

    let cancelled = false;
    evaluateOnGridAsync(coeffs, gridInfo).then((field) => {
      if (!cancelled) setCumulativeField(field);
    }).catch((err) => console.error('Cumulative AO eval error:', err));
    return () => { cancelled = true; };
  }, [cumulativeK, moldenData, selectedMO, gridInfo, viewMode, evaluateOnGridAsync]);

  // Compute single-AO overlay field + meshes
  useEffect(() => {
    if (overlayAOIndex === null || !moldenData || !gridInfo || viewMode !== 'mo') {
      setAOOverlayPositiveMesh(null);
      setAOOverlayNegativeMesh(null);
      return;
    }
    const mo = moldenData.molecularOrbitals[selectedMO];
    if (!mo) return;
    const aoCoef = mo.coefficients[overlayAOIndex];
    if (Math.abs(aoCoef) < 1e-12) {
      setAOOverlayPositiveMesh(null);
      setAOOverlayNegativeMesh(null);
      return;
    }
    const coeffs = mo.coefficients.map((_, i) => (i === overlayAOIndex ? aoCoef : 0));

    let cancelled = false;
    evaluateOnGridAsync(coeffs, gridInfo).then((field) => {
      if (cancelled) return;
      const { size, origin, spacing } = gridInfo;
      const nx = size.x, ny = size.y, nz = size.z;
      const orig: [number, number, number] = [origin.x, origin.y, origin.z];
      const posM = marchingCubes(field, nx, ny, nz, isovalue, orig, spacing);
      const negF = new Float64Array(field.length);
      for (let i = 0; i < field.length; i++) negF[i] = -field[i];
      const negM = marchingCubes(negF, nx, ny, nz, isovalue, orig, spacing);
      setAOOverlayPositiveMesh(posM.vertices.length > 0 ? posM : null);
      setAOOverlayNegativeMesh(negM.vertices.length > 0 ? negM : null);
    }).catch((err) => console.error('AO overlay eval error:', err));
    return () => { cancelled = true; };
  }, [overlayAOIndex, moldenData, selectedMO, gridInfo, isovalue, viewMode, evaluateOnGridAsync]);

  // Reset AO overlay/cumulative when leaving MO mode or loading new file
  useEffect(() => {
    if (viewMode !== 'mo') {
      setOverlayAOIndex(null);
      setCumulativeK(null);
    }
  }, [viewMode]);

  // Computed oriented plane for atom-based modes
  const atomPlane = moldenData
    ? (crossSection.plane === 'atoms'
        ? planeFromAtoms(moldenData.atoms, crossSection.planeAtoms)
        : crossSection.plane === 'bond'
          ? planeFromBond(moldenData.atoms, crossSection.planeAtoms)
          : null)
    : null;

  // Callback: route atom clicks to plane picking when in an atom-based plane mode
  const handlePlaneAtomPick = useCallback((atom: { index: number }) => {
    setCrossSection((cs) => {
      if (cs.plane !== 'atoms' && cs.plane !== 'bond') return cs;
      const max = cs.plane === 'bond' ? 2 : 3;
      // De-select if already picked
      if (cs.planeAtoms.includes(atom.index)) {
        return { ...cs, planeAtoms: cs.planeAtoms.filter((i) => i !== atom.index) };
      }
      // Already at max: drop the oldest (FIFO) so the user can revise selection by clicking
      if (cs.planeAtoms.length >= max) {
        return { ...cs, planeAtoms: [...cs.planeAtoms.slice(1), atom.index] };
      }
      return { ...cs, planeAtoms: [...cs.planeAtoms, atom.index] };
    });
  }, []);

  // Plane-picking is active whenever the user is in an atom-based plane mode,
  // so clicks always route to picking (toggle off / pick new) instead of measurement.
  const isPlanePickingActive =
    crossSection.enabled &&
    (crossSection.plane === 'atoms' || crossSection.plane === 'bond');

  // Regenerate isosurfaces on active field or isovalue change
  useEffect(() => {
    if (!activeField || !activeGrid) return;

    const field = activeField;
    const grid = activeGrid;
    const isDensity = viewMode === 'density';
    const iso = isovalue;
    let cancelled = false;
    let innerRafId = 0;

    // Defer marching cubes to next frame so computing overlay is painted first
    const rafId = requestAnimationFrame(() => {
      if (cancelled) return;
      const { size, origin, spacing } = grid;
      const nx = size.x, ny = size.y, nz = size.z;
      const orig: [number, number, number] = [origin.x, origin.y, origin.z];

      try {
        const posMesh = marchingCubes(field, nx, ny, nz, iso, orig, spacing);
        setPositiveMesh(posMesh.vertices.length > 0 ? posMesh : null);

        if (!isDensity) {
          const negField = new Float64Array(field.length);
          for (let i = 0; i < field.length; i++) negField[i] = -field[i];
          const nm = marchingCubes(negField, nx, ny, nz, iso, orig, spacing);
          setNegativeMesh(nm.vertices.length > 0 ? nm : null);
        } else {
          setNegativeMesh(null);
        }
      } catch (e) {
        console.error('Marching cubes error:', e);
        setPositiveMesh(null);
        setNegativeMesh(null);
      }
      // Wait one more frame so Three.js renders the new mesh before hiding the popup
      innerRafId = requestAnimationFrame(() => {
        if (cancelled) return;
        setComputing(false);
        setDensityComputing(false);
        setDensityProgress('');
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(innerRafId);
    };
  }, [activeField, isovalue, activeGrid, viewMode]);

  // Compute compare MO
  useEffect(() => {
    if (!moldenData || compareMO === null || compareMO >= moldenData.molecularOrbitals.length) {
      setComparePositiveMesh(null);
      setCompareNegativeMesh(null);
      setCompareScalarField(null);
      setCompareComputing(false);
      return;
    }

    const cacheKey = `${compareMO}:${gridPoints}`;
    const cached = fieldCacheRef.current.get(cacheKey);
    if (cached) {
      setCompareScalarField(cached.field);
      setCompareComputing(false);
      return;
    }

    setCompareComputing(true);
    setCompareProgress(0);

    // Compute via compare worker
    const grid = autoGrid(moldenData.shells, gridPoints);
    const worker = compareWorkerRef.current;
    if (worker) {
      worker.onmessage = (e: MessageEvent<MOWorkerResponse>) => {
        if (e.data.type === 'progress') {
          setCompareProgress(e.data.percent);
          return;
        }
        const field = e.data.scalarField;
        fieldCacheRef.current.set(cacheKey, { field, grid });
        setCompareScalarField(field);
        setCompareComputing(false);
      };
      worker.postMessage({
        type: 'evaluate',
        shells: moldenData.shells,
        moCoefficients: moldenData.molecularOrbitals[compareMO].coefficients,
        grid,
        useSphericalD: moldenData.useSphericalD,
        useSphericalF: moldenData.useSphericalF,
        useSphericalG: moldenData.useSphericalG,
      });
    } else {
      setTimeout(() => {
        const field = evaluateMOOnGrid(
          moldenData.shells,
          moldenData.molecularOrbitals[compareMO].coefficients,
          grid,
          moldenData.useSphericalD,
          moldenData.useSphericalF,
          moldenData.useSphericalG,
        );
        fieldCacheRef.current.set(cacheKey, { field, grid });
        setCompareScalarField(field);
        setCompareComputing(false);
      }, 0);
    }
  }, [moldenData, compareMO, gridPoints]);

  // Regenerate compare isosurface (skip in density mode to avoid wrong isovalue)
  useEffect(() => {
    if (viewMode === 'density') return;
    if (!compareScalarField || !gridInfo) {
      setComparePositiveMesh(null);
      setCompareNegativeMesh(null);
      return;
    }

    const { size, origin, spacing } = gridInfo;
    const nx = size.x, ny = size.y, nz = size.z;
    const orig: [number, number, number] = [origin.x, origin.y, origin.z];

    const negField = new Float64Array(compareScalarField.length);
    for (let i = 0; i < compareScalarField.length; i++) negField[i] = -compareScalarField[i];

    try {
      const posMesh = marchingCubes(compareScalarField, nx, ny, nz, isovalue, orig, spacing);
      const negMesh = marchingCubes(negField, nx, ny, nz, isovalue, orig, spacing);
      setComparePositiveMesh(posMesh.vertices.length > 0 ? posMesh : null);
      setCompareNegativeMesh(negMesh.vertices.length > 0 ? negMesh : null);
    } catch {
      setComparePositiveMesh(null);
      setCompareNegativeMesh(null);
    }
  }, [compareScalarField, isovalue, gridInfo, viewMode]);

  // Export Cube file
  const handleExportCube = useCallback(async () => {
    if (!activeField || !activeGrid) return;
    const atoms = moldenData?.atoms ?? [];
    const moLabel = viewMode === 'density'
      ? 'Electron density'
      : moldenData?.molecularOrbitals?.[selectedMO]
        ? `MO ${selectedMO}`
        : 'Imported data';
    const cubeText = exportCubeFile(
      atoms, activeGrid, activeField,
      `MOrbVis export: ${filename}`,
      `${moLabel}, grid ${activeGrid.size.x}x${activeGrid.size.y}x${activeGrid.size.z}`,
    );
    const baseName = filename.replace(/\.(molden|input|cube|xyz)$/i, '');
    const blob = new Blob([cubeText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.cube`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`${baseName}.cube`);
  }, [activeField, activeGrid, moldenData, selectedMO, filename, viewMode, showToast]);

  // Export STL
  const handleExportSTL = useCallback(async () => {
    const meshes = [positiveMesh, negativeMesh]
      .filter((m): m is IsosurfaceMesh => m !== null && m.vertices.length > 0);
    if (meshes.length === 0) return;
    const blob = exportSTL(meshes);
    const baseName = filename.replace(/\.(molden|input|cube|xyz)$/i, '');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.stl`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`${baseName}.stl`);
  }, [positiveMesh, negativeMesh, filename, showToast]);

  // Batch export: compute MO → render → capture PNG → ZIP
  const handleBatchExport = useCallback(async (selectedIndices: number[], dpiScale: number, transparent: boolean) => {
    if (!moldenData || moldenData.molecularOrbitals.length === 0 || !viewerRef.current || selectedIndices.length === 0) return;
    const viewer = viewerRef.current;
    const worker = workerRef.current;
    if (!worker) return;

    batchExportingRef.current = true;
    setBatchExporting(true);
    setShowBatchPopup(false);
    const total = selectedIndices.length;
    const originalMO = selectedMO;
    const savedCompareMO = compareMO;
    // Hide compare MO wireframe during batch export
    setCompareMO(null);
    const baseName = filename.replace(/\.(molden|input|cube|xyz)$/i, '') || 'morbvis';

    // Helper: compute MO as Promise (GPU when available, CPU worker otherwise)
    const computeMOAsync = async (moIndex: number): Promise<{ field: Float64Array; grid: Grid3D }> => {
      const cacheKey = `${moIndex}:${gridPoints}`;
      const cached = fieldCacheRef.current.get(cacheKey);
      if (cached) return cached;

      const grid = autoGrid(moldenData.shells, gridPoints);

      // GPU path
      if (renderSettings.useGPU && gpuCtxRef.current) {
        try {
          const field = await evaluateMOOnGridGPU(
            gpuCtxRef.current,
            moldenData.shells,
            moldenData.molecularOrbitals[moIndex].coefficients,
            grid,
            moldenData.useSphericalD,
            moldenData.useSphericalF,
            moldenData.useSphericalG,
          );
          const result = { field, grid };
          fieldCacheRef.current.set(cacheKey, result);
          return result;
        } catch (err) {
          console.error('GPU compute failed during batch export, falling back to CPU:', err);
        }
      }

      // CPU path (Web Worker)
      return new Promise((resolve) => {
        worker.onmessage = (e: MessageEvent<MOWorkerResponse>) => {
          if (e.data.type === 'progress') return;
          const result = { field: e.data.scalarField, grid };
          fieldCacheRef.current.set(cacheKey, result);
          resolve(result);
        };
        worker.postMessage({
          type: 'evaluate',
          shells: moldenData.shells,
          moCoefficients: moldenData.molecularOrbitals[moIndex].coefficients,
          grid,
          useSphericalD: moldenData.useSphericalD,
          useSphericalF: moldenData.useSphericalF,
          useSphericalG: moldenData.useSphericalG,
        });
      });
    };

    // Wait for React commit + R3F scene sync
    const waitForRender = () => new Promise<void>((resolve) =>
      setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())), 50)
    );

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // Find HOMO index for labeling
      let homoIndex = 0;
      for (let i = moldenData.molecularOrbitals.length - 1; i >= 0; i--) {
        if (moldenData.molecularOrbitals[i].occupation > 0) { homoIndex = i; break; }
      }
      const getLabel = (i: number) => {
        if (i === homoIndex) return 'HOMO';
        if (i === homoIndex + 1) return 'LUMO';
        if (i < homoIndex) return `HOMO-${homoIndex - i}`;
        return `LUMO+${i - homoIndex - 1}`;
      };

      for (let i = 0; i < selectedIndices.length; i++) {
        const idx = selectedIndices[i];
        const num = i + 1;
        setBatchProgress(`${t('batch.computingMO')} ${num}/${total}`);

        // Compute MO field
        const { field, grid } = await computeMOAsync(idx);

        // Generate isosurface meshes
        const { size, origin, spacing } = grid;
        const nx = size.x, ny = size.y, nz = size.z;
        const orig: [number, number, number] = [origin.x, origin.y, origin.z];
        const negField = new Float64Array(field.length);
        for (let i = 0; i < field.length; i++) negField[i] = -field[i];

        const posMesh = marchingCubes(field, nx, ny, nz, isovalue, orig, spacing);
        const negMesh = marchingCubes(negField, nx, ny, nz, isovalue, orig, spacing);

        // Force synchronous React commit so R3F scene updates immediately
        flushSync(() => {
          setPositiveMesh(posMesh.vertices.length > 0 ? posMesh : null);
          setNegativeMesh(negMesh.vertices.length > 0 ? negMesh : null);
          setSelectedMO(idx);
        });

        setBatchProgress(`${t('batch.rendering')} ${num}/${total}`);
        // Wait for R3F to process the scene graph update
        await waitForRender();

        // Capture image
        const blob = await viewer.captureImage(dpiScale, transparent);
        if (blob) {
          const label = getLabel(idx);
          const arrayBuffer = await blob.arrayBuffer();
          zip.file(`${baseName}_MO${idx}_${label}.png`, arrayBuffer);
        }
      }

      setBatchProgress('Creating ZIP...');
      const zipBlob = await zip.generateAsync({ type: 'blob' });

      const zipName = `${baseName}_batch.zip`;
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = zipName;
      a.click();
      URL.revokeObjectURL(url);
      showToast(zipName);
    } catch (e) {
      console.error('Batch export error:', e);
    } finally {
      // Restore original MO with meshes
      batchExportingRef.current = false;
      setBatchExporting(false);
      setBatchProgress('');
      setSelectedMO(originalMO);
      // Regenerate meshes for the original MO from cache
      const cacheKey = `${originalMO}:${gridPoints}`;
      const cached = fieldCacheRef.current.get(cacheKey);
      if (cached) {
        const { field: f, grid: g } = cached;
        const { size: sz, origin: og, spacing: sp } = g;
        const posM = marchingCubes(f, sz.x, sz.y, sz.z, isovalue, [og.x, og.y, og.z], sp);
        const negF = new Float64Array(f.length);
        for (let j = 0; j < f.length; j++) negF[j] = -f[j];
        const negM = marchingCubes(negF, sz.x, sz.y, sz.z, isovalue, [og.x, og.y, og.z], sp);
        setScalarField(f);
        setGridInfo(g);
        setPositiveMesh(posM.vertices.length > 0 ? posM : null);
        setNegativeMesh(negM.vertices.length > 0 ? negM : null);
      } else {
        // Not in cache — trigger full recompute
        computeMO(moldenData!, originalMO, gridPoints);
      }
      // Restore compare MO
      setCompareMO(savedCompareMO);
    }
  }, [moldenData, selectedMO, compareMO, gridPoints, isovalue, filename, t, computeMO]);

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
        width: sidebarOpen ? 280 : 0,
        minWidth: sidebarOpen ? 280 : 0,
        padding: sidebarOpen ? 16 : 0,
        background: theme.sidebarBg,
        display: 'flex',
        flexDirection: 'column',
        gap: sidebarOpen ? 16 : 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        borderRight: sidebarOpen ? `1px solid ${theme.sidebarBorder}` : 'none',
        transition: 'width 0.25s ease, min-width 0.25s ease, padding 0.25s ease',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: theme.accent, display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src="icon.png" alt="" style={{ width: 24, height: 24, background: themeMode === 'dark' ? '#e0e0e0' : 'transparent', borderRadius: '50%' }} />
            MOrbVis
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => setLocale(l => l === 'en' ? 'ja' : 'en')}
              style={{
                background: theme.accentBg,
                border: `1px solid ${theme.sidebarBorder}`,
                borderRadius: 6,
                padding: '4px 8px',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
                color: theme.textSecondary,
              }}
              title={locale === 'en' ? 'Japanese' : 'English'}
            >
              {locale === 'en' ? 'JA' : 'EN'}
            </button>
            <button
              onClick={() => {
                setThemeMode(m => m === 'light' ? 'dark' : 'light');
                setRenderSettings(s => ({ ...s, canvasColor: '' }));
              }}
              style={{
                background: theme.accentBg,
                border: `1px solid ${theme.sidebarBorder}`,
                borderRadius: 6,
                padding: '4px 10px',
                cursor: 'pointer',
                fontSize: 14,
                color: theme.textSecondary,
              }}
              title={themeMode === 'light' ? t('app.switchDark') : t('app.switchLight')}
            >
              {themeMode === 'light' ? '\u263E' : '\u2600'}
            </button>
          </div>
        </div>

        <FileUpload onFileLoaded={handleFileLoaded} theme={theme} t={t} />

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
            <option value="">{t('app.selectSample')}</option>
            {sampleFiles.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        )}

        {filename && (
          <div style={{ fontSize: 12, color: theme.text }}>
            {filename}
            {moldenData && (
              <>
                <br />
                {moldenData.atoms.length} {t('app.atoms')}
                {moldenData.molecularOrbitals.length > 0 && <>, {moldenData.molecularOrbitals.length} {t('app.mos')}</>}
              </>
            )}
          </div>
        )}

        {moldenData && (
          <>
            {moldenData.molecularOrbitals.length > 0 && (
              <>
                <MOSelector
                  orbitals={moldenData.molecularOrbitals}
                  selectedIndex={selectedMO}
                  onSelect={(i) => { setViewMode('mo'); setSelectedMO(i); }}
                  compareIndex={compareMO}
                  onCompareSelect={setCompareMO}
                  theme={theme}
                  disabled={computing || compareComputing || densityComputing}
                  t={t}
                  viewMode={viewMode}
                  onViewModeChange={(mode) => {
                    if (mode === 'density') {
                      setCompareMO(null);
                      moIsovalueRef.current = isovalue;
                      setIsovalue(densityIsovalueRef.current);
                      computeDensity();
                    } else {
                      densityIsovalueRef.current = isovalue;
                      setIsovalue(moIsovalueRef.current);
                      setViewMode('mo');
                    }
                  }}
                  densityComputing={densityComputing}
                  hasDensityCache={densityCacheRef.current.has(`density:${gridPoints}`)}
                  gpuAvailable={gpuAvailable}
                  useGPU={renderSettings.useGPU}
                  onToggleGPU={() => {
                    setRenderSettings(s => {
                      const next = { ...s, useGPU: !s.useGPU };
                      // Fall back grid resolution if GPU is turned off and grid > 160
                      if (!next.useGPU && gridPoints > 160) setGridPoints(160);
                      return next;
                    });
                  }}
                />
                {viewMode === 'mo' && aoLabels.length > 0 && moldenData.molecularOrbitals[selectedMO] && (
                  <CollapsibleSection title={t('ao.title')} theme={theme}>
                    <AODecomposition
                      labels={aoLabels}
                      coefficients={moldenData.molecularOrbitals[selectedMO].coefficients}
                      overlayAOIndex={overlayAOIndex}
                      onOverlayChange={setOverlayAOIndex}
                      cumulativeK={cumulativeK}
                      onCumulativeChange={setCumulativeK}
                      showThreshold={aoShowThreshold}
                      onShowThresholdChange={setAOShowThreshold}
                      theme={theme}
                      t={t}
                    />
                  </CollapsibleSection>
                )}
                {viewMode === 'mo' && (
                  <CollapsibleSection title={t('energy.title')} theme={theme}>
                    <EnergyDiagram
                      orbitals={moldenData.molecularOrbitals}
                      selectedIndex={selectedMO}
                      onSelect={setSelectedMO}
                      compareIndex={compareMO}
                      onCompareSelect={setCompareMO}
                      theme={theme}
                      disabled={computing || compareComputing}
                    />
                  </CollapsibleSection>
                )}
              </>
            )}
            <ControlPanel
              isovalue={isovalue}
              onIsovalueChange={setIsovalue}
              gridPoints={gridPoints}
              onGridPointsChange={setGridPoints}
              computing={computing || densityComputing}
              theme={theme}
              renderSettings={renderSettings}
              onRenderSettingsChange={setRenderSettings}
              hideComputation={moldenData.molecularOrbitals.length === 0}
              onShowAtomColors={() => setShowAtomColors(true)}
              t={t}
              viewMode={viewMode}
              crossSection={(moldenData.shells.length > 0 || scalarField) ? crossSection : undefined}
              onCrossSectionChange={(moldenData.shells.length > 0 || scalarField) ? setCrossSection : undefined}
              hqMode={hqMode}
              onHqModeChange={setHqMode}
              ssaoIntensity={ssaoIntensity}
              onSsaoIntensityChange={setSsaoIntensity}
              gpuAvailable={gpuAvailable}
              useGPU={renderSettings.useGPU}
              measurementMode={measurementMode}
              onMeasurementModeChange={(m) => {
                setMeasurementMode(m);
                setMeasureCount(0);
              }}
              onClearMeasurement={() => setMeasureClearTick((t) => t + 1)}
              measureCount={measureCount}
            />
            {(positiveMesh || negativeMesh) && (
              <div style={{ display: 'flex', gap: 6 }}>
                {activeField && activeGrid && (
                  <button
                    onClick={handleExportCube}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      fontSize: 12,
                      background: theme.accentBg,
                      color: theme.textSecondary,
                      border: `1px solid ${theme.sidebarBorder}`,
                      borderRadius: 6,
                      cursor: 'pointer',
                    }}
                  >
                    {t('app.exportCube')}
                  </button>
                )}
                <button
                  onClick={handleExportSTL}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    fontSize: 12,
                    background: theme.accentBg,
                    color: theme.textSecondary,
                    border: `1px solid ${theme.sidebarBorder}`,
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  {t('app.exportSTL')}
                </button>
              </div>
            )}
            {moldenData.molecularOrbitals.length > 0 && viewMode === 'mo' && (
              <button
                onClick={() => {
                  // Initialize with all occupied MOs selected
                  const occ = new Set<number>();
                  moldenData.molecularOrbitals.forEach((mo, i) => { if (mo.occupation > 0) occ.add(i); });
                  setBatchSelected(occ);
                  setShowBatchPopup(true);
                }}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  fontSize: 12,
                  background: theme.accentBg,
                  color: theme.textSecondary,
                  border: `1px solid ${theme.sidebarBorder}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                {t('batch.title')}
              </button>
            )}
          </>
        )}

        <div style={{ marginTop: 'auto', paddingTop: 12, fontSize: 10, color: theme.textMuted, textAlign: 'center', lineHeight: 1.8 }}>
          <div>MOrbVis v{__APP_VERSION__} &copy; 2026 Yasuaki Ito</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
            <a
              href="https://github.com/Yasuaki-Ito/morbvis"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: theme.textMuted, textDecoration: 'none' }}
              onMouseEnter={(e) => e.currentTarget.style.color = theme.accent}
              onMouseLeave={(e) => e.currentTarget.style.color = theme.textMuted}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ verticalAlign: '-2px', marginRight: 3 }}>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              GitHub
            </a>
            <button
              onClick={() => setShowCitation(true)}
              style={{
                background: 'none', border: 'none', padding: 0, font: 'inherit',
                color: theme.textMuted, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 3,
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = theme.accent}
              onMouseLeave={(e) => e.currentTarget.style.color = theme.textMuted}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ verticalAlign: '-2px' }}>
                <path d="M3 1.5A1.5 1.5 0 0 1 4.5 0h7A1.5 1.5 0 0 1 13 1.5v13.25a.25.25 0 0 1-.41.19L8 11.06l-4.59 3.88A.25.25 0 0 1 3 14.75V1.5Zm1.5-.5a.5.5 0 0 0-.5.5v12.16l3.84-3.25a.5.5 0 0 1 .64 0L12 13.66V1.5a.5.5 0 0 0-.5-.5h-7Z" />
              </svg>
              {t('cite.label')}
            </button>
          </div>
        </div>
      </div>

      {/* 3D Viewer */}
      <div style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(v => !v)}
          title={sidebarOpen ? t('app.hidePanel') : t('app.showPanel')}
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            zIndex: 10,
            width: 32,
            height: 32,
            borderRadius: 6,
            border: `1px solid ${theme.sidebarBorder}`,
            background: theme.sidebarBg,
            color: theme.textSecondary,
            fontSize: 16,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.8,
            boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.8'; }}
        >
          {sidebarOpen ? '\u00AB' : '\u00BB'}
        </button>
        {moldenData ? (
          <>
            <MoleculeViewer
              ref={viewerRef}
              atoms={moldenData.atoms}
              positiveMesh={positiveMesh}
              negativeMesh={negativeMesh}
              comparePositiveMesh={viewMode === 'density' ? null : comparePositiveMesh}
              compareNegativeMesh={viewMode === 'density' ? null : compareNegativeMesh}
              canvasBg={theme.canvasBg}
              renderSettings={renderSettings}
              hqMode={hqMode}
              ssaoIntensity={ssaoIntensity}
              t={t}
              viewMode={viewMode}
              crossSection={crossSection}
              gridInfo={activeGrid}
              onFileSaved={showToast}
              onPlaneAtomPick={isPlanePickingActive ? handlePlaneAtomPick : undefined}
              atomPlane={atomPlane}
              measurementMode={measurementMode}
              onMeasureCountChange={setMeasureCount}
              measurementClearTick={measureClearTick}
              aoPositiveMesh={aoOverlayPositiveMesh}
              aoNegativeMesh={aoOverlayNegativeMesh}
            />
            {/* 2D cross-section PiP */}
            {crossSection.enabled && activeField && activeGrid && (
              <div style={{
                position: 'absolute', bottom: 12, right: 12,
                width: 320, height: 280,
                borderRadius: 8,
                overflow: 'hidden',
                boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
                border: `1px solid ${theme.sidebarBorder}`,
                background: theme.bg,
              }}>
                <CrossSectionCanvas
                  scalarField={activeField}
                  gridInfo={activeGrid}
                  plane={crossSection.plane}
                  position={crossSection.position}
                  showContours={crossSection.showContours}
                  colorMode={viewMode}
                  densityColor={renderSettings.densityColor}
                  posColor={(renderSettings.colorScheme === 'custom' ? renderSettings.customColors : COLOR_SCHEMES[renderSettings.colorScheme] ?? ['#4488ff', '#ff4444'])[0]}
                  negColor={(renderSettings.colorScheme === 'custom' ? renderSettings.customColors : COLOR_SCHEMES[renderSettings.colorScheme] ?? ['#4488ff', '#ff4444'])[1]}
                  atoms={moldenData.atoms}
                  showAtoms={crossSection.showAtoms}
                  theme={theme}
                  atomPlane={atomPlane}
                />
              </div>
            )}
          </>
        ) : (
          <div style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: theme.textMuted,
            fontSize: 18,
          }}>
            {t('app.loadFile')}
          </div>
        )}
        {(computing || compareComputing || densityComputing) && (
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
              {densityComputing
                ? <>{t('density.computing')} {densityProgress}</>
                : computing
                  ? (renderSettings.useGPU && gpuAvailable
                    ? t('app.computingGPU')
                    : <>{t('app.computingCPU')} {progress}%</>)
                  : <>{t('app.computingCPU')} {compareProgress}%</>
              }
            </div>
          </div>
        )}
      </div>

      {/* Keyboard shortcut help overlay */}
      {showHelp && (
        <div
          onClick={() => setShowHelp(false)}
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: theme.sidebarBg,
              borderRadius: 12,
              padding: '24px 32px',
              maxWidth: 400,
              width: '90%',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
              color: theme.text,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{t('help.title')}</div>
              <button
                onClick={() => setShowHelp(false)}
                style={{
                  background: 'none', border: 'none', color: theme.textMuted,
                  fontSize: 18, cursor: 'pointer', padding: '0 4px',
                }}
              >
                {'\u2715'}
              </button>
            </div>
            {([
              ['?', t('help.showHide')],
              ['\u2190 \u2192', t('help.prevNext')],
              ['Space', t('help.jumpHomo')],
              ['Shift+click', t('help.compareMO')],
              ['Drag', t('help.drag')],
              ['Scroll', t('help.scroll')],
              ['Right-drag', t('help.rightDrag')],
            ] as [string, string][]).map(([key, desc]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <kbd style={{
                  display: 'inline-block',
                  minWidth: 48,
                  textAlign: 'center',
                  padding: '3px 8px',
                  fontSize: 12,
                  fontFamily: 'monospace',
                  background: theme.accentBg,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 4,
                  color: theme.text,
                  whiteSpace: 'nowrap',
                }}>
                  {key}
                </kbd>
                <span style={{ fontSize: 13, color: theme.textSecondary }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Batch export popup modal */}
      {showBatchPopup && !batchExporting && moldenData && moldenData.molecularOrbitals.length > 0 && (() => {
        const mos = moldenData.molecularOrbitals;
        let homoIdx = 0;
        for (let i = mos.length - 1; i >= 0; i--) {
          if (mos[i].occupation > 0) { homoIdx = i; break; }
        }
        const getLabel = (i: number) => {
          if (i === homoIdx) return 'HOMO';
          if (i === homoIdx + 1) return 'LUMO';
          if (i < homoIdx) return `HOMO-${homoIdx - i}`;
          return `LUMO+${i - homoIdx - 1}`;
        };
        const selectAll = () => setBatchSelected(new Set(mos.map((_, i) => i)));
        const selectOccupied = () => {
          const s = new Set<number>();
          mos.forEach((mo, i) => { if (mo.occupation > 0) s.add(i); });
          setBatchSelected(s);
        };
        const selectVirtual = () => {
          const s = new Set<number>();
          mos.forEach((mo, i) => { if (mo.occupation === 0) s.add(i); });
          setBatchSelected(s);
        };
        const selectNone = () => setBatchSelected(new Set());
        const toggle = (i: number) => {
          setBatchSelected(prev => {
            const next = new Set(prev);
            if (next.has(i)) next.delete(i); else next.add(i);
            return next;
          });
        };
        const quickBtns: { label: string; action: () => void }[] = [
          { label: t('batch.all'), action: selectAll },
          { label: t('batch.occupied'), action: selectOccupied },
          { label: t('batch.unoccupied'), action: selectVirtual },
          { label: t('batch.clear'), action: selectNone },
        ];
        return (
          <div
            onClick={() => setShowBatchPopup(false)}
            style={{
              position: 'fixed',
              top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: theme.sidebarBg,
                borderRadius: 12,
                padding: '20px 24px',
                maxWidth: 420,
                width: '90%',
                boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                color: theme.text,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{t('batch.title')}</div>
                <button
                  onClick={() => setShowBatchPopup(false)}
                  style={{ background: 'none', border: 'none', color: theme.textMuted, fontSize: 18, cursor: 'pointer', padding: '0 4px' }}
                >{'\u2715'}</button>
              </div>
              {/* Quick select buttons */}
              <div style={{ display: 'flex', gap: 4 }}>
                {quickBtns.map((b) => (
                  <button
                    key={b.label}
                    onClick={b.action}
                    style={{
                      flex: 1, padding: '4px 6px', fontSize: 11, fontWeight: 600,
                      background: theme.accentBg,
                      color: theme.textSecondary,
                      border: `1px solid ${theme.sidebarBorder}`,
                      borderRadius: 4, cursor: 'pointer',
                    }}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
              {/* MO list with checkboxes */}
              <div style={{
                maxHeight: 400,
                overflowY: 'auto',
                border: `1px solid ${theme.sidebarBorder}`,
                borderRadius: 6,
              }}>
                {mos.map((mo, i) => {
                  const checked = batchSelected.has(i);
                  const label = getLabel(i);
                  const isHomo = i === homoIdx;
                  const isLumo = i === homoIdx + 1;
                  return (
                    <label
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '3px 8px',
                        fontSize: 11,
                        cursor: 'pointer',
                        background: (isHomo || isLumo) ? `${theme.accent}18` : 'transparent',
                        borderBottom: i < mos.length - 1 ? `1px solid ${theme.sidebarBorder}44` : 'none',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(i)}
                        style={{ accentColor: theme.accent, margin: 0 }}
                      />
                      <span style={{ width: 24, textAlign: 'right', color: theme.textMuted, fontFamily: 'monospace' }}>{i}</span>
                      <span style={{
                        width: 64,
                        fontWeight: (isHomo || isLumo) ? 700 : 400,
                        color: (isHomo || isLumo) ? theme.accent : theme.text,
                      }}>{label}</span>
                      <span style={{ flex: 1, color: theme.textSecondary, fontFamily: 'monospace' }}>
                        {mo.energy.toFixed(4)} Ha
                      </span>
                      <span style={{ color: theme.textMuted, fontSize: 10 }}>
                        occ={mo.occupation}
                      </span>
                    </label>
                  );
                })}
              </div>
              {/* DPI + transparent + export button */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: theme.textSecondary }}>DPI</span>
                <select value={batchDpi} onChange={(e) => setBatchDpi(Number(e.target.value))}
                  style={{ fontSize: 11, padding: '2px 4px', background: theme.bg, color: theme.text, border: `1px solid ${theme.sidebarBorder}`, borderRadius: 3 }}>
                  <option value={1}>1x</option>
                  <option value={2}>2x</option>
                  <option value={3}>3x</option>
                </select>
                <label style={{ fontSize: 11, color: theme.textSecondary, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input type="checkbox" checked={batchTransparent} onChange={(e) => setBatchTransparent(e.target.checked)} style={{ accentColor: theme.accent }} />
                  {t('viewer.transparentBg')}
                </label>
              </div>
              <button
                onClick={() => handleBatchExport(Array.from(batchSelected).sort((a, b) => a - b), batchDpi, batchTransparent)}
                disabled={batchSelected.size === 0}
                style={{
                  padding: '8px 12px', fontSize: 13, fontWeight: 600,
                  background: batchSelected.size === 0 ? theme.sidebarBorder : theme.accent,
                  color: '#fff',
                  border: 'none', borderRadius: 6,
                  cursor: batchSelected.size === 0 ? 'not-allowed' : 'pointer',
                  opacity: batchSelected.size === 0 ? 0.5 : 1,
                }}
              >
                {t('batch.start')} ({batchSelected.size} {t('batch.selected')})
              </button>
            </div>
          </div>
        );
      })()}

      {/* Batch export full-page overlay */}
      {batchExporting && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.3)',
          zIndex: 900,
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
            {t('batch.exporting')} {batchProgress}
          </div>
        </div>
      )}

      {/* Atom colors periodic table modal */}
      {showAtomColors && (
        <div
          onClick={() => setShowAtomColors(false)}
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: theme.sidebarBg,
              borderRadius: 12,
              padding: '20px 24px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
              color: theme.text,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{t('atomColors.title')}</div>
              <button
                onClick={() => setShowAtomColors(false)}
                style={{
                  background: 'none', border: 'none', color: theme.textMuted,
                  fontSize: 18, cursor: 'pointer', padding: '0 4px',
                }}
              >
                {'\u2715'}
              </button>
            </div>
            <PeriodicTable
              atomColors={renderSettings.atomColors}
              onChange={(colors) => setRenderSettings((prev) => ({ ...prev, atomColors: colors }))}
              theme={theme}
              t={t}
              presentElements={moldenData ? new Set(moldenData.atoms.map((a) => a.atomicNumber)) : undefined}
            />
          </div>
        </div>
      )}

      {/* Citation modal */}
      {showCitation && (
        <div
          onClick={() => setShowCitation(false)}
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: theme.sidebarBg,
              borderRadius: 12,
              padding: '20px 24px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
              color: theme.text,
              maxWidth: 640,
              width: 'min(640px, 92vw)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{t('cite.title')}</div>
              <button
                onClick={() => setShowCitation(false)}
                style={{
                  background: 'none', border: 'none', color: theme.textMuted,
                  fontSize: 18, cursor: 'pointer', padding: '0 4px',
                }}
              >
                {'✕'}
              </button>
            </div>

            <div style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 6 }}>
              {t('cite.intro')}
            </div>

            <pre style={{
              fontSize: 12, lineHeight: 1.55,
              background: theme.accentBg,
              border: `1px solid ${theme.sidebarBorder}`,
              borderRadius: 6,
              padding: '10px 12px',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              margin: '0 0 12px 0',
              fontFamily: 'inherit',
              color: theme.text,
            }}>
              {formattedCitation()}
            </pre>

            <div style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 6 }}>BibTeX</div>
            <pre style={{
              fontSize: 11, lineHeight: 1.5,
              background: theme.accentBg,
              border: `1px solid ${theme.sidebarBorder}`,
              borderRadius: 6,
              padding: '10px 12px',
              whiteSpace: 'pre',
              overflow: 'auto',
              margin: '0 0 12px 0',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              color: theme.text,
              maxHeight: 200,
            }}>
              {bibtexEntry()}
            </pre>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => navigator.clipboard.writeText(formattedCitation()).then(() => showToast(t('cite.copied')))}
                style={{
                  padding: '6px 12px', fontSize: 12,
                  background: theme.accentBg, color: theme.text,
                  border: `1px solid ${theme.sidebarBorder}`,
                  borderRadius: 6, cursor: 'pointer',
                }}
              >
                {t('cite.copyText')}
              </button>
              <button
                onClick={() => navigator.clipboard.writeText(bibtexEntry()).then(() => showToast(t('cite.copied')))}
                style={{
                  padding: '6px 12px', fontSize: 12,
                  background: theme.accentBg, color: theme.text,
                  border: `1px solid ${theme.sidebarBorder}`,
                  borderRadius: 6, cursor: 'pointer',
                }}
              >
                {t('cite.copyBibtex')}
              </button>
              <button
                onClick={() => {
                  const blob = new Blob([bibtexEntry() + '\n'], { type: 'application/x-bibtex' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${CITATION.bibtexKey}.bib`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                style={{
                  padding: '6px 12px', fontSize: 12,
                  background: theme.accent, color: '#fff',
                  border: `1px solid ${theme.accent}`,
                  borderRadius: 6, cursor: 'pointer',
                }}
              >
                {t('cite.downloadBibtex')}
              </button>
              {CITATION.doi && (
                <a
                  href={`https://doi.org/${CITATION.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '6px 12px', fontSize: 12,
                    background: 'transparent', color: theme.text,
                    border: `1px solid ${theme.sidebarBorder}`,
                    borderRadius: 6, cursor: 'pointer',
                    textDecoration: 'none',
                    display: 'inline-flex', alignItems: 'center',
                  }}
                >
                  {t('cite.openDoi')}
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Save toast notification */}
      {toast && (
        <div
          key={toast.key}
          style={{
            position: 'fixed',
            bottom: 32,
            left: '50%',
            transform: 'translateX(-50%)',
            background: theme.sidebarBg,
            color: theme.text,
            border: `1px solid ${theme.border}`,
            borderRadius: 10,
            padding: '10px 20px',
            fontSize: 13,
            boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
            zIndex: 2000,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            animation: 'toast-in 0.3s ease-out',
            backdropFilter: 'blur(8px)',
          }}
        >
          <span style={{ fontSize: 16 }}>&#x2713;</span>
          <span>{t('app.fileSaved')}: <b>{toast.message}</b></span>
        </div>
      )}
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateX(-50%) translateY(16px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  );
}
