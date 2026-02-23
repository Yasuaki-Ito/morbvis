import { useRef, useEffect, useCallback } from 'react';
import type { Grid3D, Atom } from '../types';
import type { Theme } from '../theme';
import { CPK_COLORS } from './MoleculeViewer';

interface Props {
  scalarField: Float64Array;
  gridInfo: Grid3D;
  plane: 'XY' | 'XZ' | 'YZ';
  position: number;
  showContours: boolean;
  colorMode: 'mo' | 'density';
  densityColor: string;
  atoms: Atom[];
  showAtoms: boolean;
  theme: Theme;
}

// Margins for axes and colorbar
const MARGIN = { top: 16, right: 60, bottom: 40, left: 52 };

export function CrossSectionCanvas({
  scalarField, gridInfo, plane, position, showContours,
  colorMode, densityColor, atoms, showAtoms, theme,
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
    } else {
      width = ny; height = nz;
      const i = Math.max(0, Math.min(nx - 1, Math.round(((position + 1) / 2) * (nx - 1))));
      sliceData = new Float64Array(width * height);
      for (let iz = 0; iz < nz; iz++)
        for (let iy = 0; iy < ny; iy++)
          sliceData[iz * width + iy] = scalarField[(iz * ny + iy) * nx + i];
      axisH = 'Y'; axisV = 'Z';
      originH = oy; originV = oz;
      spanH = (ny - 1) * sp; spanV = (nz - 1) * sp;
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

    // Parse density color
    const dcR = parseInt(densityColor.slice(1, 3), 16);
    const dcG = parseInt(densityColor.slice(3, 5), 16);
    const dcB = parseInt(densityColor.slice(5, 7), 16);

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
        if (t >= 0) {
          return [255, Math.round(255 * (1 - at)), Math.round(255 * (1 - at))];
        } else {
          return [Math.round(255 * (1 - at)), Math.round(255 * (1 - at)), 255];
        }
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
        if (t >= 0) {
          r = 255; g = Math.round(255 * (1 - at)); b = Math.round(255 * (1 - at));
        } else {
          r = Math.round(255 * (1 - at)); g = Math.round(255 * (1 - at)); b = 255;
        }
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
        } else {
          const xPlane = gridInfo.origin.x + ((position + 1) / 2) * (nx - 1) * sp;
          dist = Math.abs(atom.position.x - xPlane);
          px = plotX + ((atom.position.y - originH) / spanH) * plotW;
          py = plotY + plotH - ((atom.position.z - originV) / spanV) * plotH;
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
    let planeVal: number;
    if (plane === 'XY') planeVal = oz + ((position + 1) / 2) * (nz - 1) * sp;
    else if (plane === 'XZ') planeVal = oy + ((position + 1) / 2) * (ny - 1) * sp;
    else planeVal = ox + ((position + 1) / 2) * (nx - 1) * sp;
    const fixedAxis = plane === 'XY' ? 'Z' : plane === 'XZ' ? 'Y' : 'X';
    ctx.fillText(`${plane} plane | ${fixedAxis} = ${planeVal.toFixed(2)} \u00C5`, plotX, 4);
  }, [scalarField, gridInfo, plane, position, showContours, colorMode, densityColor, atoms, showAtoms, theme]);

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
