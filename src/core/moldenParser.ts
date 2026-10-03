import type {
  Atom,
  ContractedShell,
  KMolecularOrbital,
  KPoint,
  LatticeVectors,
  MoldenData,
  MolecularOrbital,
  PBCInfo,
  Primitive,
  ShellType,
  Vec3,
} from '../types';

const BOHR_TO_ANG = 0.529177249;

/**
 * Parse a Molden format file.
 * Supports the GANSU-PBC extension sections (MOLDEN_PBC_SPEC.md v1):
 * [PBC], [Cell], [KMesh], [KPoint], [KMO]. Section keywords are case-insensitive.
 */
export function parseMolden(text: string): MoldenData {
  const lines = text.split(/\r?\n/);
  const atoms: Atom[] = [];
  const shells: ContractedShell[] = [];
  const molecularOrbitals: MolecularOrbital[] = [];
  const kOrbitals: KMolecularOrbital[] = [];
  const kpoints: KPoint[] = [];
  let useSphericalD = false;
  let useSphericalF = false;
  let useSphericalG = false;

  // PBC extension state
  let pbcSeen = false;
  let pbcVersion = 1;
  let periodic: [boolean, boolean, boolean] = [true, true, true];
  let cell: LatticeVectors | null = null;
  let kmesh: { n: [number, number, number]; centering: string } | undefined;

  let i = 0;

  // Helper to get current line
  function currentLine(): string {
    return i < lines.length ? lines[i].trim() : '';
  }

  function isSection(line: string): boolean {
    return line.startsWith('[') && line.includes(']');
  }

  // Check file header
  while (i < lines.length) {
    const line = currentLine();
    const upper = line.toUpperCase();

    if (line === '[Molden Format]') {
      i++;
      continue;
    }

    // Skip comment and title lines
    if (line === '' || (!isSection(line) && atoms.length === 0 && shells.length === 0)) {
      i++;
      continue;
    }

    // Parse by section
    if (line.startsWith('[Atoms]')) {
      i = parseAtoms(lines, i, atoms);
    } else if (line === '[GTO]') {
      i = parseGTO(lines, i, atoms, shells);
    } else if (line === '[MO]') {
      i = parseMO(lines, i, molecularOrbitals);
    } else if (upper === '[5D]' || upper === '[5D7F]') {
      // Molden spec: [5D] alone switches BOTH d and f to spherical harmonics
      // ([5D7F] is the explicit spelling of the same thing).
      useSphericalD = true;
      useSphericalF = true;
      i++;
    } else if (upper === '[5D10F]') {
      // Spherical d, Cartesian f (overrides an earlier [5D]'s implicit 7F)
      useSphericalD = true;
      useSphericalF = false;
      i++;
    } else if (upper === '[7F]') {
      useSphericalF = true;
      i++;
    } else if (upper === '[9G]') {
      useSphericalG = true;
      i++;
    } else if (upper.startsWith('[PBC]')) {
      pbcSeen = true;
      const r = parsePBC(lines, i);
      i = r.next;
      pbcVersion = r.version;
      periodic = r.periodic;
    } else if (upper.startsWith('[CELL]')) {
      const r = parseCell(lines, i);
      i = r.next;
      cell = r.cell;
    } else if (upper.startsWith('[KMESH]')) {
      const r = parseKMesh(lines, i);
      i = r.next;
      kmesh = r.kmesh;
    } else if (upper.startsWith('[KPOINT]')) {
      i = parseKPoints(lines, i, kpoints);
    } else if (upper.startsWith('[KMO]')) {
      i = parseKMO(lines, i, kOrbitals);
    } else {
      i++;
    }
  }

  // Detection rule (MOLDEN_PBC_SPEC.md): [PBC] switches molecule/periodic;
  // [Cell] is then required. A lone [Cell] is accepted leniently as periodic.
  let pbc: PBCInfo | null = null;
  if (pbcSeen && !cell) {
    throw new Error('[PBC] section present but [Cell] section is missing');
  }
  if (cell) {
    pbc = { version: pbcVersion, periodic, cell, kmesh, kpoints };
  }
  if (kOrbitals.length > 0 && kpoints.length === 0) {
    console.warn('[KMO] present without [KPoint] — k-orbitals will be unavailable');
    kOrbitals.length = 0;
  }

  return {
    atoms, shells, molecularOrbitals, useSphericalD, useSphericalF, useSphericalG,
    pbc, kOrbitals,
  };
}

// =============================================
// GANSU-PBC extension sections
// =============================================

function parsePBC(
  lines: string[],
  start: number,
): { next: number; version: number; periodic: [boolean, boolean, boolean] } {
  let i = start + 1;
  let version = 1;
  const periodic: [boolean, boolean, boolean] = [true, true, true];
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith('[')) break;
    if (line !== '') {
      const parts = line.split(/\s+/);
      const key = parts[0].toLowerCase();
      if (key === 'version' && parts.length >= 2) {
        version = parseInt(parts[1], 10) || 1;
      } else if (key === 'periodic' && parts.length >= 4) {
        for (let d = 0; d < 3; d++) {
          periodic[d] = parts[1 + d].toUpperCase().startsWith('T');
        }
      }
    }
    i++;
  }
  return { next: i, version, periodic };
}

function parseCell(
  lines: string[],
  start: number,
): { next: number; cell: LatticeVectors } {
  const header = lines[start].trim().toUpperCase();
  const isAU = header.includes('AU'); // same unit convention as [Atoms]
  const scale = isAU ? BOHR_TO_ANG : 1;
  let i = start + 1;
  const rows: Vec3[] = [];
  while (i < lines.length && rows.length < 3) {
    const line = lines[i].trim();
    if (line.startsWith('[')) break;
    if (line !== '') {
      const parts = line.split(/\s+/).map(parseFloat);
      if (parts.length >= 3 && parts.every(Number.isFinite)) {
        rows.push({ x: parts[0] * scale, y: parts[1] * scale, z: parts[2] * scale });
      }
    }
    i++;
  }
  if (rows.length < 3) {
    throw new Error('[Cell] section must contain 3 lattice-vector rows');
  }
  // Skip trailing blank lines within the section
  while (i < lines.length && lines[i].trim() === '') i++;
  return { next: i, cell: { a1: rows[0], a2: rows[1], a3: rows[2] } };
}

function parseKMesh(
  lines: string[],
  start: number,
): { next: number; kmesh?: { n: [number, number, number]; centering: string } } {
  let i = start + 1;
  let kmesh: { n: [number, number, number]; centering: string } | undefined;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith('[')) break;
    if (line !== '' && !kmesh) {
      const parts = line.split(/\s+/);
      if (parts.length >= 3) {
        const n1 = parseInt(parts[0], 10);
        const n2 = parseInt(parts[1], 10);
        const n3 = parseInt(parts[2], 10);
        if (Number.isFinite(n1) && Number.isFinite(n2) && Number.isFinite(n3)) {
          kmesh = { n: [n1, n2, n3], centering: (parts[3] ?? 'gamma').toLowerCase() };
        }
      }
    }
    i++;
  }
  return { next: i, kmesh };
}

function parseKPoints(lines: string[], start: number, kpoints: KPoint[]): number {
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith('[')) break;
    if (line !== '') {
      const parts = line.split(/\s+/).map(parseFloat);
      if (parts.length >= 5 && parts.every(Number.isFinite)) {
        kpoints.push({
          index: Math.round(parts[0]),
          k: [parts[1], parts[2], parts[3]],
          weight: parts[4],
        });
      }
    }
    i++;
  }
  return i;
}

function parseKMO(lines: string[], start: number, kOrbitals: KMolecularOrbital[]): number {
  let i = start + 1;
  let current: KMolecularOrbital | null = null;

  const flush = () => {
    if (current && current.coeffRe.length > 0) kOrbitals.push(current);
    current = null;
  };

  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith('[')) break;
    if (line === '') { i++; continue; }

    const lower = line.toLowerCase();
    if (lower.startsWith('k=')) {
      flush();
      current = {
        kIndex: parseInt(line.slice(line.indexOf('=') + 1), 10) || 1,
        symmetry: '',
        energy: 0,
        spin: 'Alpha',
        occupation: 0,
        coeffRe: [],
        coeffIm: [],
      };
    } else if (current && lower.startsWith('sym=')) {
      current.symmetry = line.slice(line.indexOf('=') + 1).trim();
    } else if (current && lower.startsWith('ene=')) {
      current.energy = parseFloat(line.slice(line.indexOf('=') + 1));
    } else if (current && lower.startsWith('spin=')) {
      current.spin = line.slice(line.indexOf('=') + 1).trim() || 'Alpha';
    } else if (current && lower.startsWith('occup=')) {
      current.occupation = parseFloat(line.slice(line.indexOf('=') + 1));
    } else if (current) {
      // Coefficient row: "aoIndex re im"
      const parts = line.split(/\s+/);
      if (parts.length >= 3) {
        const re = parseFloat(parts[1]);
        const im = parseFloat(parts[2]);
        if (Number.isFinite(re) && Number.isFinite(im)) {
          current.coeffRe.push(re);
          current.coeffIm.push(im);
        }
      }
    }
    i++;
  }
  flush();
  return i;
}

function parseAtoms(lines: string[], start: number, atoms: Atom[]): number {
  let i = start + 1; // Start after [Atoms] line
  const headerLine = lines[start].trim();
  const isAU = headerLine.includes('AU') || headerLine.includes('(AU)');

  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('[')) break;

    const parts = line.split(/\s+/);
    if (parts.length < 6) { i++; continue; }

    const symbol = parts[0];
    const index = parseInt(parts[1]);
    const atomicNumber = parseInt(parts[2]);
    let x = parseFloat(parts[3]);
    let y = parseFloat(parts[4]);
    let z = parseFloat(parts[5]);

    // AU -> Angstrom conversion
    if (isAU) {
      const bohrToAng = 0.529177249;
      x *= bohrToAng;
      y *= bohrToAng;
      z *= bohrToAng;
    }

    atoms.push({ symbol, index, atomicNumber, position: { x, y, z } });
    i++;
  }
  return i;
}

function parseGTO(
  lines: string[],
  start: number,
  atoms: Atom[],
  shells: ContractedShell[],
): number {
  let i = start + 1; // Start after [GTO] line

  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith('[')) break;

    // Atom header line: "atomIndex 0"
    const atomHeader = line.match(/^(\d+)\s+\d+$/);
    if (atomHeader) {
      const atomIndex = parseInt(atomHeader[1]);
      const atom = atoms.find((a) => a.index === atomIndex);
      if (!atom) { i++; continue; }
      i++;

      // Parse shells for this atom
      while (i < lines.length) {
        const shellLine = lines[i].trim();
        if (shellLine === '' || shellLine.startsWith('[')) break;

        // Shell header: "s 3 1.00" or "p 3 1.00"
        const shellMatch = shellLine.match(/^([spdfgSPDFG])\s+(\d+)\s+([\d.]+)/);
        if (!shellMatch) break;

        const shellType = shellMatch[1].toLowerCase() as ShellType;
        const numPrimitives = parseInt(shellMatch[2]);
        i++;

        const primitives: Primitive[] = [];
        for (let p = 0; p < numPrimitives; p++) {
          if (i >= lines.length) break;
          const primLine = lines[i].trim();
          const primParts = primLine.split(/\s+/);
          primitives.push({
            exponent: parseFloat(primParts[0]),
            coefficient: parseFloat(primParts[1]),
          });
          i++;
        }

        shells.push({
          atomIndex,
          center: { ...atom.position },
          shellType,
          primitives,
        });
      }

      // Skip empty lines
      while (i < lines.length && lines[i].trim() === '') i++;
    } else {
      i++;
    }
  }
  return i;
}

function parseMO(
  lines: string[],
  start: number,
  molecularOrbitals: MolecularOrbital[],
): number {
  let i = start + 1;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith('[')) break;
    if (line === '') { i++; continue; }

    // MO header: Sym=, Ene=, Spin=, Occup=
    if (line.startsWith('Sym=')) {
      const symmetry = line.split('=')[1]?.trim() || '';
      i++;

      let energy = 0;
      let spin = 'Alpha';
      let occupation = 0;
      const coefficients: number[] = [];

      // Ene=
      if (i < lines.length && lines[i].trim().startsWith('Ene=')) {
        energy = parseFloat(lines[i].trim().split('=')[1]);
        i++;
      }

      // Spin=
      if (i < lines.length && lines[i].trim().startsWith('Spin=')) {
        spin = lines[i].trim().split('=')[1]?.trim() || 'Alpha';
        i++;
      }

      // Occup=
      if (i < lines.length && lines[i].trim().startsWith('Occup=')) {
        occupation = parseFloat(lines[i].trim().split('=')[1]);
        i++;
      }

      // MO coefficients
      while (i < lines.length) {
        const coefLine = lines[i].trim();
        if (coefLine === '' || coefLine.startsWith('Sym=') || coefLine.startsWith('[')) break;
        const coefParts = coefLine.split(/\s+/);
        if (coefParts.length >= 2) {
          coefficients.push(parseFloat(coefParts[1]));
        }
        i++;
      }

      molecularOrbitals.push({ symmetry, energy, spin, occupation, coefficients });
    } else {
      i++;
    }
  }
  return i;
}
