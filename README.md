# MOrbVis

A lightweight tool for visualizing molecular orbitals in 3D.
Load a Molden file and interactively explore isosurfaces. Runs in your browser and is also available as a standalone Windows desktop application.

![MOrbVis screenshot](doc/screenshot.png)

## Features

- Parse Molden format files (.molden)
- 3D visualization of molecular orbitals with positive/negative isosurfaces
- Ball-and-stick molecular structure display
- Adjustable isovalue and grid resolution
- Multiple render presets (standard, matte, glossy, glass, toon, minimal)
- Color schemes and surface modes (solid, wireframe, solid+wire)
- Light/dark mode toggle
- Computation progress indicator
- Export as PNG
- Built-in sample molecules

## Try Online

You can try MOrbVis directly in your browser at https://yasuaki-ito.github.io/morbvis/

## Installation (Windows)

Download the latest installer from the [Releases](https://github.com/Yasuaki-Ito/morbvis/releases) page.

Additional sample Molden files are also available for download on the Releases page.

## Getting Started (from source)

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)

### Setup

1. Clone the repository:

```bash
git clone https://github.com/Yasuaki-Ito/morbvis.git
cd morbvis
```

2. Install dependencies:

```bash
npm install
```

3. Start the development server:

```bash
npm run dev
```

4. Open http://localhost:5173 in your browser and load a Molden file.

## Creating Molden Files

The [Molden format](https://www.theochem.ru.nl/molden/) is a widely used text-based file format for storing molecular geometry, basis set, and molecular orbital data from quantum chemistry calculations.

The following programs can generate Molden format files:

- [GANSU](https://github.com/Yasuaki-Ito/GANSU)
- [Gaussian](https://gaussian.com/)
- [GAMESS](https://www.msg.chem.iastate.edu/gamess/)
- [ORCA](https://www.faccts.de/orca/)
- [PSI4](https://psicode.org/)
- [MOLPRO](https://www.molpro.net/)
- [NWChem](https://nwchemgit.github.io/)
- [PySCF](https://pyscf.org/)
- [Q-Chem](https://www.q-chem.com/)
- [Turbomole](https://www.turbomole.org/)

## Tech Stack

- **Frontend**: React, TypeScript, Three.js (via React Three Fiber)
- **Computation**: Web Worker for MO evaluation, marching cubes for isosurface extraction

## Adding Sample Files

Place `.molden` files in `public/molden_files/` and list them in `public/molden_files/index.json`.

All sample files (both built-in and additional downloads) were generated using [GANSU](https://github.com/Yasuaki-Ito/GANSU). Additional sample files can be downloaded from the [Releases](https://github.com/Yasuaki-Ito/morbvis/releases) page.

## License

[BSD-3-Clause](LICENSE)


## Additional Resources
An article introducing MOrbVis in Japanese is available on Zenn:
- [軽量分子軌道ビューア MOrbVis をリリースしました](https://zenn.dev/comp_lab/articles/fcea581da8833c)
