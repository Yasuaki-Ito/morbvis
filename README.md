# MOrbVis

A lightweight tool for visualizing molecular orbitals in 3D.
Load a Molden or Gaussian Cube file and interactively explore isosurfaces. Runs in your browser and is also available as a standalone Windows desktop application.

## Demo
![MOrbVis screenshot](doc/screenshot.png)

https://github.com/user-attachments/assets/5ba40271-e280-49d9-b4d3-8e1191fb9de9

## Features

### Visualization
- 3D visualization of molecular orbitals with positive/negative isosurfaces
- Ball-and-stick molecular structure display
- Electron density visualization computed from occupied MOs
- Cross-section view (XY/XZ/YZ) with contour lines in a picture-in-picture window
- Energy level diagram with HOMO-LUMO gap display
- MO comparison (solid + wireframe overlay, Shift+click on energy diagram)

### Rendering
- Multiple render presets (standard, matte, glossy, glass, toon, minimal)
- HQ mode with SSAO and Bloom post-processing effects
- Adjustable isovalue, grid resolution, opacity, and surface mode
- Customizable background color, lighting direction and brightness
- Light/dark mode toggle

### Export
- PNG save with DPI scale (1x–4x) and transparent background options
- Batch export: select multiple MOs and download all as a ZIP archive
- Video recording of auto-rotation as WebM
- Gaussian Cube file export
- STL export for 3D printing

### Interaction
- Auto-rotation with adjustable direction and speed
- Fullscreen mode
- Atom distance and angle measurement (2-point distance / 3-point angle)
- Atom label display
- Atom color customization via periodic table UI
- Keyboard shortcuts (`?` help, `←/→` MO navigation, `Space` jump to HOMO)

### File Format Support
- Molden format (.molden)
- Gaussian Cube format (.cube)

### Other
- English / Japanese bilingual UI
- 48 built-in sample molecules
- Computation progress indicator with Web Worker

## Try Online

You can try MOrbVis directly in your browser at https://yasuaki-ito.github.io/morbvis/

## Installation (Windows)

Download the latest installer from the [Releases](https://github.com/Yasuaki-Ito/morbvis/releases) page.

48 sample Molden files are included in the app.

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

4. Open http://localhost:5173 in your browser and load a Molden or Cube file.

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
- **Post-processing**: @react-three/postprocessing (SSAO, Bloom)
- **Computation**: Web Workers for MO/density evaluation, marching cubes for isosurface extraction
- **Export**: JSZip for batch export

## Adding Sample Files

Place `.molden` files in `public/molden_files/` and list them in `public/molden_files/index.json`.

All sample files were generated using [GANSU](https://github.com/Yasuaki-Ito/GANSU).

## License

[BSD-3-Clause](LICENSE)


## Additional Resources
An article introducing MOrbVis in Japanese is available on Zenn:
- [軽量分子軌道ビューア MOrbVis をリリースしました](https://zenn.dev/comp_lab/articles/fcea581da8833c)
