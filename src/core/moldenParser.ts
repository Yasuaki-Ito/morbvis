import type {
  Atom,
  ContractedShell,
  MoldenData,
  MolecularOrbital,
  Primitive,
  ShellType,
  Vec3,
} from '../types';

/**
 * Parse a Molden format file
 */
export function parseMolden(text: string): MoldenData {
  const lines = text.split(/\r?\n/);
  const atoms: Atom[] = [];
  const shells: ContractedShell[] = [];
  const molecularOrbitals: MolecularOrbital[] = [];
  let useSphericalD = false;
  let useSphericalF = false;

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
    } else if (line === '[5d]' || line === '[5D]') {
      useSphericalD = true;
      i++;
    } else if (line === '[7f]' || line === '[7F]') {
      useSphericalF = true;
      i++;
    } else if (line === '[9g]' || line === '[9G]') {
      // Spherical g functions (not supported)
      i++;
    } else {
      i++;
    }
  }

  return { atoms, shells, molecularOrbitals, useSphericalD, useSphericalF };
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
        const shellMatch = shellLine.match(/^([spdfSPDF])\s+(\d+)\s+([\d.]+)/);
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
