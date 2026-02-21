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
}

/** Angular momentum type */
export type ShellType = 's' | 'p' | 'd' | 'f';

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

/** Parsed Molden file data */
export interface MoldenData {
  atoms: Atom[];
  shells: ContractedShell[];
  molecularOrbitals: MolecularOrbital[];
  /** Whether to use spherical harmonics (default: Cartesian) */
  useSphericalD: boolean; // [5d] tag present
  useSphericalF: boolean; // [7f] tag present
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
}

/** Web Worker message types */
export interface MOWorkerRequest {
  type: 'evaluate';
  shells: ContractedShell[];
  moCoefficients: number[];
  grid: Grid3D;
  useSphericalD: boolean;
  useSphericalF: boolean;
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

/** Render settings */
export type SurfaceMode = 'solid' | 'wireframe' | 'solid+wire';
export type ColorScheme = 'classic' | 'teal-orange' | 'green-purple' | 'mono';
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
}
