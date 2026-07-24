/**
 * Colormaps for per-atom scalar coloring (annotated XYZ files).
 * Each map is a list of equally spaced sRGB anchors, linearly interpolated.
 */

const MAPS: Record<string, string[]> = {
  viridis: ['#440154', '#482878', '#3E4A89', '#31688E', '#26828E', '#1F9E89', '#35B779', '#6DCD59', '#B4DE2C', '#FDE725'],
  plasma: ['#0D0887', '#47039F', '#7301A8', '#9C179E', '#BD3786', '#D8576B', '#ED7953', '#FA9E3B', '#FDC926', '#F0F921'],
  inferno: ['#000004', '#1B0C41', '#4A0C6B', '#781C6D', '#A52C60', '#CF4446', '#ED6925', '#FB9B06', '#F7D13D', '#FCFFA4'],
  magma: ['#000004', '#180F3D', '#440F76', '#721F81', '#9E2F7F', '#CD4071', '#F1605D', '#FD9668', '#FECA8D', '#FCFDBF'],
  cividis: ['#00224E', '#123570', '#3B496C', '#575D6D', '#707173', '#8A8678', '#A59C74', '#C3B369', '#E1CC55', '#FEE838'],
  turbo: ['#30123B', '#4458CB', '#3E9BFE', '#18D6CB', '#46F884', '#A2FC3C', '#E2DC37', '#FEA331', '#EF5A11', '#C42503', '#7A0403'],
  coolwarm: ['#3B4CC0', '#5977E3', '#7B9FF9', '#9EBEFF', '#C0D4F5', '#DDDDDD', '#F2CBB7', '#F7AC8E', '#EE8468', '#D65244', '#B40426'],
  bwr: ['#0000FF', '#FFFFFF', '#FF0000'],
  seismic: ['#00004D', '#0000FF', '#FFFFFF', '#FF0000', '#800000'],
  rdbu: ['#67001F', '#B2182B', '#D6604D', '#F4A582', '#FDDBC7', '#F7F7F7', '#D1E5F0', '#92C5DE', '#4393C3', '#2166AC', '#053061'],
  blues: ['#F7FBFF', '#DEEBF7', '#C6DBEF', '#9ECAE1', '#6BAED6', '#4292C6', '#2171B5', '#08519C', '#08306B'],
  reds: ['#FFF5F0', '#FEE0D2', '#FCBBA1', '#FC9272', '#FB6A4A', '#EF3B2C', '#CB181D', '#A50F15', '#67000D'],
  greens: ['#F7FCF5', '#E5F5E0', '#C7E9C0', '#A1D99B', '#74C476', '#41AB5D', '#238B45', '#006D2C', '#00441B'],
  gray: ['#000000', '#FFFFFF'],
  hot: ['#000000', '#B40000', '#FF5000', '#FFC300', '#FFFFFF'],
  jet: ['#000080', '#0000FF', '#00FFFF', '#7FFF7F', '#FFFF00', '#FF0000', '#800000'],
};

// Aliases for names people habitually type
const ALIASES: Record<string, string> = {
  grey: 'gray', grays: 'gray', greys: 'gray', gist_gray: 'gray',
  rdbu_r: 'rdbu_r', bluered: 'bwr', warmcool: 'coolwarm',
};

export const COLORMAP_NAMES = Object.keys(MAPS);

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

const toHex = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');

/** Resolve a colormap name; a trailing `_r` reverses it. Returns null if unknown. */
function resolve(name: string): { anchors: string[]; reversed: boolean } | null {
  let key = (ALIASES[name.toLowerCase()] ?? name).toLowerCase().trim();
  let reversed = false;
  if (key.endsWith('_r')) { reversed = true; key = key.slice(0, -2); }
  const anchors = MAPS[ALIASES[key] ?? key];
  return anchors ? { anchors, reversed } : null;
}

export function isColormap(name: string): boolean {
  return resolve(name) !== null;
}

/** Sample a colormap at t in [0,1] (clamped). Unknown names fall back to viridis. */
export function sampleColormap(name: string, t: number): string {
  const map = resolve(name) ?? { anchors: MAPS.viridis, reversed: false };
  let u = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  if (map.reversed) u = 1 - u;

  const n = map.anchors.length;
  const pos = u * (n - 1);
  const i = Math.min(n - 2, Math.floor(pos));
  const f = pos - i;
  const [r0, g0, b0] = hexToRgb(map.anchors[i]);
  const [r1, g1, b1] = hexToRgb(map.anchors[i + 1]);
  return `#${toHex(r0 + (r1 - r0) * f)}${toHex(g0 + (g1 - g0) * f)}${toHex(b0 + (b1 - b0) * f)}`;
}

export interface ColorBarSpec {
  cmap: string;
  vmin: number;
  vmax: number;
  label?: string;
  /** Text/tick color; defaults to a dark gray that reads on light backgrounds. */
  textColor?: string;
}

/**
 * Draw a vertical colorbar into a 2D canvas context, anchored to the bottom-right.
 * `scale` lets the same layout be drawn at export DPI. Used both for the on-screen
 * overlay and for the composited PNG export, so the two always match.
 */
export function drawColorBar(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  spec: ColorBarSpec,
  scale = 1,
) {
  const barW = 14 * scale;
  const barH = Math.min(180 * scale, canvasH * 0.45);
  const marginR = 58 * scale;
  const marginB = 24 * scale;
  const x = canvasW - marginR;
  const y = canvasH - marginB - barH;
  const text = spec.textColor ?? '#333333';

  // Gradient body (drawn as strips so it matches sampleColormap exactly)
  const steps = 128;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    ctx.fillStyle = sampleColormap(spec.cmap, t);
    // t = 0 at the bottom
    const yy = y + barH - (i + 1) * (barH / steps);
    ctx.fillRect(x, yy, barW, barH / steps + 1);
  }

  ctx.strokeStyle = text;
  ctx.lineWidth = Math.max(1, scale);
  ctx.strokeRect(x, y, barW, barH);

  // Tick labels at min / mid / max
  const fontPx = 11 * scale;
  ctx.font = `${fontPx}px sans-serif`;
  ctx.fillStyle = text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const fmt = (v: number) => (Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 0.01)
    ? v.toExponential(1)
    : v.toFixed(2));
  const ticks: [number, number][] = [
    [spec.vmax, y],
    [(spec.vmin + spec.vmax) / 2, y + barH / 2],
    [spec.vmin, y + barH],
  ];
  for (const [v, ty] of ticks) {
    ctx.beginPath();
    ctx.moveTo(x + barW, ty);
    ctx.lineTo(x + barW + 4 * scale, ty);
    ctx.stroke();
    ctx.fillText(fmt(v), x + barW + 6 * scale, ty);
  }

  if (spec.label) {
    ctx.save();
    ctx.translate(x - 6 * scale, y + barH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = `${12 * scale}px sans-serif`;
    ctx.fillText(spec.label, 0, 0);
    ctx.restore();
  }
}
