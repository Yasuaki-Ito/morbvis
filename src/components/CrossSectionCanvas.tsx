import { useRef, useEffect, useCallback } from 'react';
import type { Grid3D, Atom } from '../types';
import type { Theme } from '../theme';
import type { OrientedPlane } from '../core/atomPlane';
import { CPK_COLORS } from './MoleculeViewer';

interface Props {
  scalarField: Float64Array;
  gridInfo: Grid3D;
  plane: 'XY' | 'XZ' | 'YZ' | 'atoms';
  position: number;
  showContours: boolean;
  colorMode: 'mo' | 'density';
  densityColor: string;
  posColor: string;
  negColor: string;
  atoms: Atom[];
  showAtoms: boolean;
  theme: Theme;
  /** Oriented plane (only used when plane === 'atoms') */
  atomPlane?: OrientedPlane | null;
}

// Margins for axes and colorbar
const MARGIN = { top: 16, right: 60, bottom: 40, left: 52 };

export function CrossSectionCanvas({
  scalarField, gridInfo, plane, position, showContours,
  colorMode, densityColor, posColor, negColor, atoms, showAtoms, theme, atomPlane,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, cw, ch);

    const nx = gridInfo.size.x, ny = gridInfo.size.y, nz = gridInfo.size.z;
    const sp = gridInfo.spacing;
    const ox = gridInfo.origin.x, oy = gridInfo.origin.y, oz = gridInfo.origin.z;

    // Extract 2D slice
    let width: number, height: number;
    let sliceData: Float64Array;
    let axisH: string, axisV: string;
    let originH: number, originV: number;
    let spanH: number, spanV: number;

    // For 'atoms' plane: u-axis horizontal, v-axis vertical, world position along normal
    // is parameterized by `position` (which shifts plane origin along normal by an offset).
    let uMin = 0, vMin = 0;        // (u,v) coords of the slice's bottom-left corner
    let uMax = 0, vMax = 0;
    let planeOriginShift: { x: number; y: number; z: number } | null = null;

    if (plane === 'XY') {
      width = nx; height = ny;
      const k = Math.max(0, Math.min(nz - 1, Math.round(((position + 1) / 2) * (nz - 1))));
      sliceData = new Float64Array(width * height);
      for (let iy = 0; iy < ny; iy++)
        for (let ix = 0; ix < nx; ix++)
          sliceData[iy * width + ix] = scalarField[(k * ny + iy) * nx + ix];
      axisH = 'X'; axisV = 'Y';
      originH = ox; originV = oy;
      spanH = (nx - 1) * sp; spanV = (ny - 1) * sp;
    } else if (plane === 'XZ') {
      width = nx; height = nz;
      const j = Math.max(0, Math.min(ny - 1, Math.round(((position + 1) / 2) * (ny - 1))));
      sliceData = new Float64Array(width * height);
      for (let iz = 0; iz < nz; iz++)
        for (let ix = 0; ix < nx; ix++)
          sliceData[iz * width + ix] = scalarField[(iz * ny + j) * nx + ix];
      axisH = 'X'; axisV = 'Z';
      originH = ox; originV = oz;
      spanH = (nx - 1) * sp; spanV = (nz - 1) * sp;
    } else if (plane === 'YZ') {
      width = ny; height = nz;
      const i = Math.max(0, Math.min(nx - 1, Math.round(((position + 1) / 2) * (nx - 1))));
      sliceData = new Float64Array(width * height);
      for (let iz = 0; iz < nz; iz++)
        for (let iy = 0; iy < ny; iy++)
          sliceData[iz * width + iy] = scalarField[(iz * ny + iy) * nx + i];
      axisH = 'Y'; axisV = 'Z';
      originH = oy; originV = oz;
      spanH = (ny - 1) * sp; spanV = (nz - 1) * sp;
    } else {
      // 'atoms' mode: oblique plane defined by 3 picked atoms.
      // Need the plane info; if missing, fall back to empty.
      if (!atomPlane) {
        ctx.fillStyle = theme.textSecondary;
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Pick 3 atoms to define the plane', cw / 2, ch / 2);
        return;
      }
      // Compute (u,v) bounding box that covers the grid bbox
      const corners: { x: number; y: number; z: number }[] = [];
      for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        corners.push({
          x: ox + dx * (nx - 1) * sp,
          y: oy + dy * (ny - 1) * sp,
          z: oz + dz * (nz - 1) * sp,
        });
      }
      const o = atomPlane.origin, u = atomPlane.u, v = atomPlane.v, n = atomPlane.normal;
      let uLo = Infinity, uHi = -Infinity, vLo = Infinity, vHi = -Infinity;
      let nLo = Infinity, nHi = -Infinity;
      for (const c of corners) {
        const dxc = c.x - o.x, dyc = c.y - o.y, dzc = c.z - o.z;
        const pu = dxc * u.x + dyc * u.y + dzc * u.z;
        const pv = dxc * v.x + dyc * v.y + dzc * v.z;
        const pn = dxc * n.x + dyc * n.y + dzc * n.z;
        if (pu < uLo) uLo = pu; if (pu > uHi) uHi = pu;
        if (pv < vLo) vLo = pv; if (pv > vHi) vHi = pv;
        if (pn < nLo) nLo = pn; if (pn > nHi) nHi = pn;
      }
      uMin = uLo; uMax = uHi; vMin = vLo; vMax = vHi;
      // Symmetric normal offset: position = 0 → plane through atom centroid (natural plane),
      // position = ±1 → reach the farther grid extreme in the corresponding direction.
      const nRange = Math.max(Math.abs(nLo), Math.abs(nHi));
      const tn = position * nRange;
      planeOriginShift = { x: o.x + tn * n.x, y: o.y + tn * n.y, z: o.z + tn * n.z };

      // Sample resolution: tied to grid spacing
      const resU = Math.max(20, Math.round((uMax - uMin) / sp));
      const resV = Math.max(20, Math.round((vMax - vMin) / sp));
      width = resU; height = resV;
      sliceData = new Float64Array(width * height);
      const du = (uMax - uMin) / Math.max(1, resU - 1);
      const dv = (vMax - vMin) / Math.max(1, resV - 1);
      for (let iv = 0; iv < resV; iv++) {
        const vv = vMin + iv * dv;
        for (let iu = 0; iu < resU; iu++) {
          const uu = uMin + iu * du;
          // World point on the plane
          const wx = planeOriginShift.x + uu * u.x + vv * v.x;
          const wy = planeOriginShift.y + uu * u.y + vv * v.y;
          const wz = planeOriginShift.z + uu * u.z + vv * v.z;
          // Convert to grid index (continuous)
          const gxf = (wx - ox) / sp, gyf = (wy - oy) / sp, gzf = (wz - oz) / sp;
          if (gxf < 0 || gxf > nx - 1 || gyf < 0 || gyf > ny - 1 || gzf < 0 || gzf > nz - 1) {
            sliceData[iv * width + iu] = 0;
            continue;
          }
          // Trilinear interpolation
          const x0 = Math.floor(gxf), x1 = Math.min(x0 + 1, nx - 1);
          const y0 = Math.floor(gyf), y1 = Math.min(y0 + 1, ny - 1);
          const z0 = Math.floor(gzf), z1 = Math.min(z0 + 1, nz - 1);
          const fx = gxf - x0, fy = gyf - y0, fz = gzf - z0;
          const idx = (zi: number, yi: number, xi: number) => (zi * ny + yi) * nx + xi;
          const c000 = scalarField[idx(z0, y0, x0)];
          const c100 = scalarField[idx(z0, y0, x1)];
          const c010 = scalarField[idx(z0, y1, x0)];
          const c110 = scalarField[idx(z0, y1, x1)];
          const c001 = scalarField[idx(z1, y0, x0)];
          const c101 = scalarField[idx(z1, y0, x1)];
          const c011 = scalarField[idx(z1, y1, x0)];
          const c111 = scalarField[idx(z1, y1, x1)];
          const c00 = c000 * (1 - fx) + c100 * fx;
          const c10 = c010 * (1 - fx) + c110 * fx;
          const c01 = c001 * (1 - fx) + c101 * fx;
          const c11 = c011 * (1 - fx) + c111 * fx;
          const c0 = c00 * (1 - fy) + c10 * fy;
          const c1 = c01 * (1 - fy) + c11 * fy;
          sliceData[iv * width + iu] = c0 * (1 - fz) + c1 * fz;
        }
      }
      axisH = 'u'; axisV = 'v';
      originH = uMin; originV = vMin;
      spanH = uMax - uMin; spanV = vMax - vMin;
    }

    // Compute plot area with correct aspect ratio
    const plotMaxW = cw - MARGIN.left - MARGIN.right;
    const plotMaxH = ch - MARGIN.top - MARGIN.bottom;
    const aspect = spanH / spanV;
    let plotW: number, plotH: number;
    if (plotMaxW / plotMaxH > aspect) {
      plotH = plotMaxH;
      plotW = plotH * aspect;
    } else {
      plotW = plotMaxW;
      plotH = plotW / aspect;
    }
    const plotX = MARGIN.left + (plotMaxW - plotW) / 2;
    const plotY = MARGIN.top + (plotMaxH - plotH) / 2;

    // Use global abs max from the entire scalar field (not per-slice)
    // so that slices far from the molecule appear near-white/zero
    let absMax = 0, maxV = 0;
    for (let i = 0; i < scalarField.length; i++) {
      const av = Math.abs(scalarField[i]);
      if (av > absMax) absMax = av;
      if (scalarField[i] > maxV) maxV = scalarField[i];
    }

    // Parse hex colors
    const parse = (hex: string) => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
    const [dcR, dcG, dcB] = parse(densityColor);
    const [posR, posG, posB] = parse(posColor);
    const [negR, negG, negB] = parse(negColor);

    // Bilinear interpolation helper: sample sliceData at fractional coords
    function sampleBilinear(fx: number, fy: number): number {
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
      const dx = fx - x0, dy = fy - y0;
      const v00 = sliceData[y0 * width + x0];
      const v10 = sliceData[y0 * width + x1];
      const v01 = sliceData[y1 * width + x0];
      const v11 = sliceData[y1 * width + x1];
      return v00 * (1 - dx) * (1 - dy) + v10 * dx * (1 - dy)
           + v01 * (1 - dx) * dy + v11 * dx * dy;
    }

    // Color mapping helper (density uses sqrt scale for better contrast)
    const sqrtMaxV = Math.sqrt(maxV);
    function valueToRGB(v: number): [number, number, number] {
      if (colorMode === 'density') {
        const t = sqrtMaxV > 0 ? Math.max(0, Math.min(Math.sqrt(Math.max(0, v)) / sqrtMaxV, 1)) : 0;
        return [
          Math.round(255 + (dcR - 255) * t),
          Math.round(255 + (dcG - 255) * t),
          Math.round(255 + (dcB - 255) * t),
        ];
      } else {
        if (absMax === 0) return [255, 255, 255];
        const t = v / absMax;
        const at = Math.abs(t);
        const [cR, cG, cB] = t >= 0 ? [posR, posG, posB] : [negR, negG, negB];
        return [
          Math.round(255 + (cR - 255) * at),
          Math.round(255 + (cG - 255) * at),
          Math.round(255 + (cB - 255) * at),
        ];
      }
    }

    // Draw color map at display resolution with bilinear interpolation
    const renderW = Math.round(plotW * dpr);
    const renderH = Math.round(plotH * dpr);
    const imgCanvas = document.createElement('canvas');
    imgCanvas.width = renderW;
    imgCanvas.height = renderH;
    const imgCtx = imgCanvas.getContext('2d')!;
    const imgData = imgCtx.createImageData(renderW, renderH);
    const pixels = imgData.data;

    // Build interpolated value grid (reused for both color map and contours)
    const valGrid = showContours ? new Float64Array(renderW * renderH) : null;

    for (let py = 0; py < renderH; py++) {
      const gy = (1 - py / (renderH - 1)) * (height - 1);
      for (let px = 0; px < renderW; px++) {
        const gx = (px / (renderW - 1)) * (width - 1);
        const v = sampleBilinear(gx, gy);
        if (valGrid) valGrid[py * renderW + px] = v;
        const [r, g, b] = valueToRGB(v);
        const ci = (py * renderW + px) * 4;
        pixels[ci] = r;
        pixels[ci + 1] = g;
        pixels[ci + 2] = b;
        pixels[ci + 3] = 255;
      }
    }

    // Contour lines (at display resolution using interpolated values)
    if (showContours && valGrid && absMax > 0) {
      const nLevels = 10;
      const levels: number[] = [];
      if (colorMode === 'density') {
        // Use sqrt-spaced levels for better density contour distribution
        for (let l = 1; l <= nLevels; l++) {
          const t = l / (nLevels + 1);
          levels.push(maxV * t * t); // quadratic spacing (inverse of sqrt display)
        }
      } else {
        for (let l = -nLevels; l <= nLevels; l++) {
          if (l === 0) continue;
          levels.push((absMax * l) / (nLevels + 1));
        }
      }
      for (let py = 0; py < renderH; py++) {
        for (let px = 0; px < renderW; px++) {
          const idx = py * renderW + px;
          const v = valGrid[idx];
          let isContour = false;
          for (const lv of levels) {
            if (px < renderW - 1 && (v - lv) * (valGrid[idx + 1] - lv) < 0) { isContour = true; break; }
            if (py < renderH - 1 && (v - lv) * (valGrid[idx + renderW] - lv) < 0) { isContour = true; break; }
          }
          if (isContour) {
            const ci = (py * renderW + px) * 4;
            pixels[ci] = 40;
            pixels[ci + 1] = 40;
            pixels[ci + 2] = 40;
            pixels[ci + 3] = 255;
          }
        }
      }
    }

    imgCtx.putImageData(imgData, 0, 0);

    // Draw onto main canvas (1:1 pixel mapping since renderW/H already accounts for dpr)
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset to device pixels
    ctx.drawImage(imgCanvas, plotX * dpr, plotY * dpr, renderW, renderH);
    ctx.restore();

    // Draw border
    ctx.strokeStyle = theme.textSecondary;
    ctx.lineWidth = 1;
    ctx.strokeRect(plotX, plotY, plotW, plotH);

    // Axes
    ctx.fillStyle = theme.text;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // H axis (bottom)
    const nTicksH = 5;
    for (let i = 0; i <= nTicksH; i++) {
      const frac = i / nTicksH;
      const px = plotX + frac * plotW;
      const val = originH + frac * spanH;
      ctx.fillText(val.toFixed(1), px, plotY + plotH + 4);
      ctx.beginPath();
      ctx.moveTo(px, plotY + plotH);
      ctx.lineTo(px, plotY + plotH + 3);
      ctx.stroke();
    }
    ctx.fillText(`${axisH} (\u00C5)`, plotX + plotW / 2, plotY + plotH + 20);

    // V axis (left)
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const nTicksV = 5;
    for (let i = 0; i <= nTicksV; i++) {
      const frac = i / nTicksV;
      const py = plotY + plotH - frac * plotH;
      const val = originV + frac * spanV;
      ctx.fillText(val.toFixed(1), plotX - 4, py);
      ctx.beginPath();
      ctx.moveTo(plotX, py);
      ctx.lineTo(plotX - 3, py);
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(plotX - 36, plotY + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${axisV} (\u00C5)`, 0, 0);
    ctx.restore();

    // Colorbar
    const cbX = plotX + plotW + 12;
    const cbW = 14;
    const cbH = plotH;
    const cbY = plotY;

    const cbCanvas = document.createElement('canvas');
    cbCanvas.width = 1;
    cbCanvas.height = 100;
    const cbCtx = cbCanvas.getContext('2d')!;
    const cbImg = cbCtx.createImageData(1, 100);
    for (let j = 0; j < 100; j++) {
      const frac = j / 99; // 0=top=max, 1=bottom=min
      let r: number, g: number, b: number;
      if (colorMode === 'density') {
        // sqrt scale to match the cross-section colormap
        const t = Math.sqrt(1 - frac);
        r = Math.round(255 + (dcR - 255) * t);
        g = Math.round(255 + (dcG - 255) * t);
        b = Math.round(255 + (dcB - 255) * t);
      } else {
        const t = 1 - 2 * frac; // +1 to -1
        const at = Math.abs(t);
        const [cR, cG, cB] = t >= 0 ? [posR, posG, posB] : [negR, negG, negB];
        r = Math.round(255 + (cR - 255) * at);
        g = Math.round(255 + (cG - 255) * at);
        b = Math.round(255 + (cB - 255) * at);
      }
      cbImg.data[j * 4] = r;
      cbImg.data[j * 4 + 1] = g;
      cbImg.data[j * 4 + 2] = b;
      cbImg.data[j * 4 + 3] = 255;
    }
    cbCtx.putImageData(cbImg, 0, 0);
    ctx.drawImage(cbCanvas, cbX, cbY, cbW, cbH);
    ctx.strokeRect(cbX, cbY, cbW, cbH);

    // Colorbar labels
    ctx.fillStyle = theme.text;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    if (colorMode === 'density') {
      ctx.fillText(maxV.toExponential(1), cbX + cbW + 3, cbY);
      ctx.fillText('0', cbX + cbW + 3, cbY + cbH);
    } else {
      ctx.fillText(absMax > 0 ? `+${absMax.toExponential(1)}` : '0', cbX + cbW + 3, cbY);
      ctx.fillText('0', cbX + cbW + 3, cbY + cbH / 2);
      ctx.fillText(absMax > 0 ? `-${absMax.toExponential(1)}` : '0', cbX + cbW + 3, cbY + cbH);
    }

    // Atoms on plane
    if (showAtoms && atoms.length > 0) {
      const threshold = sp * 2;
      for (const atom of atoms) {
        // Check distance to the cut plane
        let dist: number, px: number, py: number;
        if (plane === 'XY') {
          const zPlane = gridInfo.origin.z + ((position + 1) / 2) * (nz - 1) * sp;
          dist = Math.abs(atom.position.z - zPlane);
          px = plotX + ((atom.position.x - originH) / spanH) * plotW;
          py = plotY + plotH - ((atom.position.y - originV) / spanV) * plotH;
        } else if (plane === 'XZ') {
          const yPlane = gridInfo.origin.y + ((position + 1) / 2) * (ny - 1) * sp;
          dist = Math.abs(atom.position.y - yPlane);
          px = plotX + ((atom.position.x - originH) / spanH) * plotW;
          py = plotY + plotH - ((atom.position.z - originV) / spanV) * plotH;
        } else if (plane === 'YZ') {
          const xPlane = gridInfo.origin.x + ((position + 1) / 2) * (nx - 1) * sp;
          dist = Math.abs(atom.position.x - xPlane);
          px = plotX + ((atom.position.y - originH) / spanH) * plotW;
          py = plotY + plotH - ((atom.position.z - originV) / spanV) * plotH;
        } else {
          // 'atoms' mode: project atom onto plane (u, v) coordinates
          if (!atomPlane || !planeOriginShift) continue;
          const o2 = planeOriginShift, u = atomPlane.u, v = atomPlane.v, n = atomPlane.normal;
          const dxc = atom.position.x - o2.x, dyc = atom.position.y - o2.y, dzc = atom.position.z - o2.z;
          dist = Math.abs(dxc * n.x + dyc * n.y + dzc * n.z);
          const pu = dxc * u.x + dyc * u.y + dzc * u.z;
          const pv = dxc * v.x + dyc * v.y + dzc * v.z;
          px = plotX + ((pu - originH) / spanH) * plotW;
          py = plotY + plotH - ((pv - originV) / spanV) * plotH;
        }

        if (dist > threshold) continue;
        if (px < plotX || px > plotX + plotW || py < plotY || py > plotY + plotH) continue;

        const opacity = 1 - dist / threshold;
        const radius = Math.max(4, 8 * (1 - dist / threshold));
        const color = CPK_COLORS[atom.atomicNumber] || '#FF69B4';

        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = opacity;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Label
        ctx.fillStyle = theme.text;
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(atom.symbol, px, py - radius - 1);
        ctx.globalAlpha = 1;
      }
    }

    // Plane info label (top-left)
    ctx.fillStyle = theme.textSecondary;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    if (plane === 'atoms' && atomPlane && planeOriginShift) {
      ctx.fillText(`Atom plane | offset = ${position.toFixed(2)}`, plotX, 4);
    } else if (plane !== 'atoms') {
      let planeVal: number;
      if (plane === 'XY') planeVal = oz + ((position + 1) / 2) * (nz - 1) * sp;
      else if (plane === 'XZ') planeVal = oy + ((position + 1) / 2) * (ny - 1) * sp;
      else planeVal = ox + ((position + 1) / 2) * (nx - 1) * sp;
      const fixedAxis = plane === 'XY' ? 'Z' : plane === 'XZ' ? 'Y' : 'X';
      ctx.fillText(`${plane} plane | ${fixedAxis} = ${planeVal.toFixed(2)} \u00C5`, plotX, 4);
    }
  }, [scalarField, gridInfo, plane, position, showContours, colorMode, densityColor, posColor, negColor, atoms, showAtoms, theme, atomPlane]);

  useEffect(() => { draw(); }, [draw]);

  // ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}
