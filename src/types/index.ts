/** 3D coordinates */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Atom information */
export interface Atom {
  symbol: string;
  index: number;
  atomicNumber: number;
  position: Vec3; // Angstrom

  // --- Annotated-XYZ extras. Absent for ordinary files; see core/xyzParser.ts ---
  /** Raw per-atom scalar (before normalization), kept for tooltips/labels. */
  scalarValue?: number;
  /** Explicit color (from a colormap or a literal hex column); overrides CPK. */
  colorOverride?: string;
  /** Rendering emphasis when a focus set is active. */
  emphasis?: 'dim' | 'hidden';
}

/** Display directives carried by an annotated XYZ comment line. */
export interface XYZAnnotation {
  /** True when at least one atom carries a scalar value. */
  hasValues: boolean;
  cmap: string;
  vmin: number;
  vmax: number;
  /** Draw a colorbar over the canvas (and into exported PNGs). */
  colorbar: boolean;
  colorbarLabel?: string;
  /** Fit the camera to the focused atoms only. */
  focusZoom: boolean;
}

/** Angular momentum type */
export type ShellType = 's' | 'p' | 'd' | 'f' | 'g';

/** Primitive Gaussian function */
export interface Primitive {
  exponent: number;  // alpha
  coefficient: number; // contraction coefficient
}

/** Contracted shell (primitives sharing center and angular momentum) */
export interface ContractedShell {
  atomIndex: number;   // parent atom index (1-based, Molden convention)
  center: Vec3;        // atom position
  shellType: ShellType;
  primitives: Primitive[];
}

/** Molecular orbital */
export interface MolecularOrbital {
  symmetry: string;
  energy: number;      // Hartree
  spin: string;
  occupation: number;
  coefficients: number[]; // same length as total basis count
}

// =============================================
// Periodic systems (GANSU-PBC Molden Format v1 / ASE extended XYZ)
// =============================================

/** Direct lattice vectors a1, a2, a3 (Angstrom, row vectors) */
export interface LatticeVectors {
  a1: Vec3;
  a2: Vec3;
  a3: Vec3;
}

/** One k-point from [KPoint]: fractional coords in the reciprocal basis + BZ weight */
export interface KPoint {
  index: number; // 1-based, referenced by KMolecularOrbital.kIndex
  k: [number, number, number]; // fractional (k = k1 b1 + k2 b2 + k3 b3)
  weight: number;
}

/** Crystal orbital at a general k-point from [KMO] (complex coefficients) */
export interface KMolecularOrbital {
  kIndex: number; // 1-based index into PBCInfo.kpoints
  symmetry: string;
  energy: number; // Hartree
  spin: string;
  occupation: number;
  coeffRe: number[]; // same AO order/normalization as standard [MO]
  coeffIm: number[];
}

/** Periodic-system information ([PBC]/[Cell]/[KMesh]/[KPoint] sections, or extxyz Lattice=) */
export interface PBCInfo {
  version: number;
  periodic: [boolean, boolean, boolean]; // a/b/c periodicity flags
  cell: LatticeVectors; // Angstrom
  kmesh?: { n: [number, number, number]; centering: string }; // informational
  kpoints: KPoint[];
}

/** Parsed Molden file data */
export interface MoldenData {
  atoms: Atom[];
  shells: ContractedShell[];
  molecularOrbitals: MolecularOrbital[];
  /** Whether to use spherical harmonics (default: Cartesian) */
  useSphericalD: boolean; // [5d] tag present
  useSphericalF: boolean; // [7f] tag present
  useSphericalG: boolean; // [9g] tag present
  /** Periodic-system info; null/undefined = ordinary molecule */
  pbc?: PBCInfo | null;
  /** Crystal orbitals at general k-points ([KMO]); Γ-point orbitals stay in molecularOrbitals */
  kOrbitals?: KMolecularOrbital[];
}

/** 3D grid definition */
export interface Grid3D {
  origin: Vec3;      // grid origin point
  size: Vec3;        // grid points per axis
  spacing: number;   // grid spacing (Angstrom)
}

/** Isosurface mesh data */
export interface IsosurfaceMesh {
  vertices: Float32Array;  // [x0,y0,z0, x1,y1,z1, ...]
  normals: Float32Array;   // [nx0,ny0,nz0, ...]
  indices: Uint32Array;    // triangle indices
  /** Optional per-vertex RGB colors (phase coloring for complex crystal orbitals) */
  colors?: Float32Array;   // [r0,g0,b0, r1,g1,b1, ...] in 0..1
}

/** Web Worker message types */
export interface MOWorkerRequest {
  type: 'evaluate';
  shells: ContractedShell[];
  moCoefficients: number[];
  grid: Grid3D;
  useSphericalD: boolean;
  useSphericalF: boolean;
  useSphericalG: boolean;
}

export interface MOWorkerResult {
  type: 'result';
  scalarField: Float64Array;
  gridSize: [number, number, number];
}

export interface MOWorkerProgress {
  type: 'progress';
  percent: number;
}

export type MOWorkerResponse = MOWorkerResult | MOWorkerProgress;

/** Density Worker message types */
export interface DensityWorkerRequest {
  type: 'density';
  shells: ContractedShell[];
  occupiedMOs: { coefficients: number[]; occupation: number }[];
  grid: Grid3D;
  useSphericalD: boolean;
  useSphericalF: boolean;
  useSphericalG: boolean;
}

export interface DensityWorkerResult {
  type: 'result';
  scalarField: Float64Array;
  gridSize: [number, number, number];
}

export interface DensityWorkerProgress {
  type: 'progress';
  percent: number;
  currentMO: number;
  totalMOs: number;
}

export type DensityWorkerResponse = DensityWorkerResult | DensityWorkerProgress;

/** Render settings */
export type SurfaceMode = 'solid' | 'wireframe' | 'solid+wire';
export type ColorScheme = 'classic' | 'teal-orange' | 'green-purple' | 'mono' | 'custom';
export type RenderPreset =
  | 'standard'
  | 'matte'
  | 'glossy'
  | 'glass'
  | 'toon'
  | 'minimal-white';

export type LightDirection = 'default' | 'front' | 'top' | 'side' | 'back';

export interface RenderSettings {
  surfaceMode: SurfaceMode;
  opacity: number;
  colorScheme: ColorScheme;
  preset: RenderPreset;
  atomScale: number;
  bondScale: number;
  lightDirection: LightDirection;
  lightIntensity: number; // multiplier for light brightness (0.0–2.0)
  customColors: [string, string]; // [positive, negative] for custom scheme
  densityColor: string; // single color for density isosurface
  showAtomLabels: boolean;
  canvasColor: string; // custom background color
  atomColors: Record<number, string>; // atomic number -> hex color override
  useGPU: boolean; // use WebGPU compute for MO evaluation
  showIsosurface: boolean; // show MO / density isosurface (uncheck to hide)
}
