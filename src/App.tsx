import { useState, useCallback, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import type { MoldenData, IsosurfaceMesh, Grid3D, RenderSettings, MOWorkerResponse, DensityWorkerResponse } from './types';
import { parseMolden } from './core/moldenParser';
import { parseCubeFile, exportCubeFile } from './core/cubeFile';
import { autoGrid, evaluateMOOnGrid } from './core/moEvaluator';
import { marchingCubes } from './core/marchingCubes';
import { MoleculeViewer, COLOR_SCHEMES, type MoleculeViewerHandle, type CrossSectionState } from './components/MoleculeViewer';
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
  });

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [showAtomColors, setShowAtomColors] = useState(false);

  // Batch export state
  const viewerRef = useRef<MoleculeViewerHandle>(null);
  const batchExportingRef = useRef(false);
  const [batchExporting, setBatchExporting] = useState(false);
  const [batchProgress, setBatchProgress] = useState('');
  const [showBatchPopup, setShowBatchPopup] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<number>>(new Set());
  const [batchDpi, setBatchDpi] = useState(2);
  const [batchTransparent, setBatchTransparent] = useState(false);

  // Cross-section state
  const [hqMode, setHqMode] = useState(false);
  const [crossSection, setCrossSection] = useState<CrossSectionState>({
    enabled: false,
    plane: 'XY',
    position: 0,
    showContours: true,
    showAtoms: false,
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

  // Load file (Molden or Cube)
  const handleFileLoaded = useCallback((text: string, name: string) => {
    try {
      if (name.toLowerCase().endsWith('.cube')) {
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
        });
        setFilename(name);
        setSelectedMO(0);
        setCompareMO(null);
        setComputing(false);
        setProgress(0);
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

    const worker = densityWorkerRef.current;
    if (worker) {
      worker.onmessage = (e: MessageEvent<DensityWorkerResponse>) => {
        if (e.data.type === 'progress') {
          setDensityProgress(`MO ${e.data.currentMO}/${e.data.totalMOs} (${e.data.percent}%)`);
          return;
        }
        densityCacheRef.current.set(cacheKey, { field: e.data.scalarField, grid });
        setDensityField(e.data.scalarField);
        setDensityGridInfo(grid);
        setDensityComputing(false);
        setDensityProgress('');
      };
      worker.postMessage({
        type: 'density',
        shells: moldenData.shells,
        occupiedMOs,
        grid,
        useSphericalD: moldenData.useSphericalD,
        useSphericalF: moldenData.useSphericalF,
      });
    }
  }, [moldenData, gridPoints]);

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

  // Active field depending on view mode
  const activeField = viewMode === 'density' ? densityField : scalarField;
  const activeGrid = viewMode === 'density' ? densityGridInfo : gridInfo;

  // Regenerate isosurfaces on active field or isovalue change
  useEffect(() => {
    if (!activeField || !activeGrid) return;

    const { size, origin, spacing } = activeGrid;
    const nx = size.x, ny = size.y, nz = size.z;
    const orig: [number, number, number] = [origin.x, origin.y, origin.z];

    const isDensity = viewMode === 'density';

    try {
      const posMesh = marchingCubes(activeField, nx, ny, nz, isovalue, orig, spacing);
      setPositiveMesh(posMesh.vertices.length > 0 ? posMesh : null);

      if (!isDensity) {
        const negField = new Float64Array(activeField.length);
        for (let i = 0; i < activeField.length; i++) negField[i] = -activeField[i];
        const nm = marchingCubes(negField, nx, ny, nz, isovalue, orig, spacing);
        setNegativeMesh(nm.vertices.length > 0 ? nm : null);
      } else {
        setNegativeMesh(null);
      }
    } catch (e) {
      console.error('Marching cubes error:', e);
      setPositiveMesh(null);
      setNegativeMesh(null);
    }
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
      });
    } else {
      setTimeout(() => {
        const field = evaluateMOOnGrid(
          moldenData.shells,
          moldenData.molecularOrbitals[compareMO].coefficients,
          grid,
          moldenData.useSphericalD,
          moldenData.useSphericalF,
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
    const baseName = filename.replace(/\.(molden|input|cube)$/i, '');
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: `${baseName}.cube`,
        types: [{ description: 'Cube file', accept: { 'chemical/x-cube': ['.cube'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(cubeText);
      await writable.close();
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      // Fallback
      const blob = new Blob([cubeText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.cube`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [activeField, activeGrid, moldenData, selectedMO, filename, viewMode]);

  // Export STL
  const handleExportSTL = useCallback(async () => {
    const meshes = [positiveMesh, negativeMesh]
      .filter((m): m is IsosurfaceMesh => m !== null && m.vertices.length > 0);
    if (meshes.length === 0) return;
    const blob = exportSTL(meshes);
    const baseName = filename.replace(/\.(molden|input|cube)$/i, '');
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: `${baseName}.stl`,
        types: [{ description: 'STL file', accept: { 'model/stl': ['.stl'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.stl`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [positiveMesh, negativeMesh, filename]);

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
    const baseName = filename.replace(/\.(molden|input|cube)$/i, '') || 'morbvis';

    // Helper: compute MO as Promise
    const computeMOAsync = (moIndex: number): Promise<{ field: Float64Array; grid: Grid3D }> => {
      const cacheKey = `${moIndex}:${gridPoints}`;
      const cached = fieldCacheRef.current.get(cacheKey);
      if (cached) return Promise.resolve(cached);

      return new Promise((resolve) => {
        const grid = autoGrid(moldenData.shells, gridPoints);
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

      // Save As dialog with fallback
      const zipName = `${baseName}_batch.zip`;
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: zipName,
          types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(zipBlob);
        await writable.close();
      } catch (err: any) {
        if (err?.name === 'AbortError') { /* user cancelled */ }
        else {
          const url = URL.createObjectURL(zipBlob);
          const a = document.createElement('a');
          a.href = url;
          a.download = zipName;
          a.click();
          URL.revokeObjectURL(url);
        }
      }
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
                />
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
              crossSection={crossSection}
              onCrossSectionChange={setCrossSection}
              hqMode={hqMode}
              onHqModeChange={setHqMode}
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
              positiveMesh={computing ? null : positiveMesh}
              negativeMesh={computing ? null : negativeMesh}
              comparePositiveMesh={computing || viewMode === 'density' ? null : comparePositiveMesh}
              compareNegativeMesh={computing || viewMode === 'density' ? null : compareNegativeMesh}
              canvasBg={theme.canvasBg}
              renderSettings={renderSettings}
              hqMode={hqMode}
              t={t}
              viewMode={viewMode}
              crossSection={crossSection}
              gridInfo={activeGrid}
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
                : <>{t('app.computing')} {computing ? `${progress}%` : `${compareProgress}%`}</>
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
    </div>
  );
}
