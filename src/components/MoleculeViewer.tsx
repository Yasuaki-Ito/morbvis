import { useMemo, useEffect, useState, useRef, forwardRef, useImperativeHandle, Component, type ReactNode } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Html, Line, Environment } from '@react-three/drei';
import { EffectComposer, SSAO, Bloom } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { Atom, IsosurfaceMesh, RenderSettings, RenderPreset, ColorScheme, LightDirection, Grid3D } from '../types';
import type { TFunction } from '../i18n';

// Color scheme definitions: [positive, negative]
export const COLOR_SCHEMES: Partial<Record<ColorScheme, [string, string]>> = {
  'classic':      ['#4488ff', '#ff4444'],
  'teal-orange':  ['#00bcd4', '#ff9800'],
  'green-purple': ['#4caf50', '#9c27b0'],
  'mono':         ['#ffffff', '#888888'],
};

// CPK colors (atomic number -> color)
export const CPK_COLORS: Record<number, string> = {
  1: '#FFFFFF',  // H
  2: '#D9FFFF',  // He
  3: '#CC80FF',  // Li
  4: '#C2FF00',  // Be
  5: '#FFB5B5',  // B
  6: '#909090',  // C
  7: '#3050F8',  // N
  8: '#FF0D0D',  // O
  9: '#90E050',  // F
  10: '#B3E3F5', // Ne
  11: '#AB5CF2', // Na
  12: '#8AFF00', // Mg
  13: '#BFA6A6', // Al
  14: '#F0C8A0', // Si
  15: '#FF8000', // P
  16: '#FFFF30', // S
  17: '#1FF01F', // Cl
  18: '#80D1E3', // Ar
  19: '#8F40D4', // K
  20: '#3DFF00', // Ca
  21: '#E6E6E6', // Sc
  22: '#BFC2C7', // Ti
  23: '#A6A6AB', // V
  24: '#8A99C7', // Cr
  25: '#9C7AC7', // Mn
  26: '#E06633', // Fe
  27: '#F090A0', // Co
  28: '#50D050', // Ni
  29: '#C88033', // Cu
  30: '#7D80B0', // Zn
  31: '#C28F8F', // Ga
  32: '#668F8F', // Ge
  33: '#BD80E3', // As
  34: '#FFA100', // Se
  35: '#A62929', // Br
  36: '#5CB8D1', // Kr
  44: '#248F8F', // Ru
  45: '#0A7D8C', // Rh
  46: '#006985', // Pd
  47: '#C0C0C0', // Ag
  48: '#FFD98F', // Cd
  49: '#A67573', // In
  50: '#668080', // Sn
  51: '#9E63B5', // Sb
  52: '#D47A00', // Te
  53: '#940094', // I
  54: '#429EB0', // Xe
  74: '#2194D6', // W
  78: '#D0D0E0', // Pt
  79: '#FFD123', // Au
  80: '#B8B8D0', // Hg
  82: '#575961', // Pb
};

// Covalent radii (Angstrom)
const COVALENT_RADII: Record<number, number> = {
  1: 0.31, 3: 1.28, 4: 0.96, 5: 0.84, 6: 0.76, 7: 0.71, 8: 0.66, 9: 0.57,
  11: 1.66, 12: 1.41, 13: 1.21, 14: 1.11, 15: 1.07, 16: 1.05, 17: 1.02,
  19: 2.03, 20: 1.76, 26: 1.32, 29: 1.32, 30: 1.22,
  35: 1.20, 53: 1.39,
};

// Display radii (scaled down)
const DISPLAY_RADII: Record<number, number> = {
  1: 0.25, 3: 0.55, 4: 0.45, 5: 0.42, 6: 0.4, 7: 0.38, 8: 0.36, 9: 0.35,
  11: 0.6, 12: 0.55, 13: 0.5, 14: 0.47, 15: 0.45, 16: 0.45, 17: 0.42,
  19: 0.7, 20: 0.6, 26: 0.5, 29: 0.5, 30: 0.48,
  35: 0.47, 53: 0.5,
};

export interface CrossSectionState {
  enabled: boolean;
  plane: 'XY' | 'XZ' | 'YZ';
  position: number;
  showContours: boolean;
  showAtoms: boolean;
}

interface Props {
  atoms: Atom[];
  positiveMesh: IsosurfaceMesh | null;
  negativeMesh: IsosurfaceMesh | null;
  comparePositiveMesh?: IsosurfaceMesh | null;
  compareNegativeMesh?: IsosurfaceMesh | null;
  canvasBg?: string;
  renderSettings: RenderSettings;
  hqMode?: boolean;
  ssaoIntensity?: number;
  t: TFunction;
  viewMode?: 'mo' | 'density';
  crossSection?: CrossSectionState;
  gridInfo?: Grid3D | null;
}

export interface MoleculeViewerHandle {
  captureImage: (dpiScale: number, transparent: boolean) => Promise<Blob | null>;
}

/** Per-preset background color override */
function getPresetBg(preset: RenderPreset, canvasBg: string): string {
  switch (preset) {
    case 'minimal-white': return '#ffffff';
    default:              return canvasBg;
  }
}

// Error boundary
class CanvasErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: string }
> {
  state = { hasError: false, error: '' };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          height: '100%', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#f44', flexDirection: 'column', gap: 8,
        }}>
          <div>3D Viewer Error</div>
          <div style={{ fontSize: 12, color: '#888' }}>{this.state.error}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Preset-specific lighting — all directions are camera-relative except 'default' */
function SceneLighting({ preset, direction, intensity }: { preset: RenderPreset; direction: LightDirection; intensity: number }) {
  const mainRef = useRef<THREE.DirectionalLight>(null);
  const fillRef = useRef<THREE.DirectionalLight>(null);

  const ambientIntensities: Record<RenderPreset, number> = {
    'glossy': 0.2, 'minimal-white': 0.65,
    'standard': 0.4, 'matte': 0.4, 'glass': 0.4, 'toon': 0.4,
  };
  const mainIntensities: Record<RenderPreset, number> = {
    'glossy': 3.0, 'minimal-white': 0.4,
    'standard': 0.8, 'matte': 0.8, 'glass': 0.8, 'toon': 0.8,
  };
  const fillIntensities: Record<RenderPreset, number> = {
    'glossy': 2.0, 'minimal-white': 0.25,
    'standard': 0.3, 'matte': 0.3, 'glass': 0.3, 'toon': 0.3,
  };

  const ambient = (ambientIntensities[preset] ?? 0.4) * intensity;
  const main = (mainIntensities[preset] ?? 0.8) * intensity;
  const fill = (fillIntensities[preset] ?? 0.3) * intensity;

  useFrame(({ camera }) => {
    // 'default' uses fixed world positions — skip per-frame update
    if (direction === 'default') return;

    const fwd = camera.getWorldDirection(new THREE.Vector3());
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(fwd, worldUp).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();

    // Light source direction (from scene center toward light) relative to camera
    let mainDir: THREE.Vector3;
    let fillDir: THREE.Vector3;
    switch (direction) {
      case 'front':
        mainDir = fwd.clone().negate();                                      // from camera side
        fillDir = right.clone().add(up.clone().multiplyScalar(0.6)).normalize();
        break;
      case 'back':
        mainDir = fwd.clone();                                               // from behind
        fillDir = right.clone().negate().add(up.clone().multiplyScalar(0.6)).normalize();
        break;
      case 'top':
        mainDir = up.clone();                                                // from above
        fillDir = fwd.clone().negate().add(right.clone().multiplyScalar(0.5)).normalize();
        break;
      case 'side':
        mainDir = right.clone();                                             // from the right
        fillDir = up.clone().add(fwd.clone().negate().multiplyScalar(0.5)).normalize();
        break;
      default:
        return;
    }

    if (mainRef.current) mainRef.current.position.copy(mainDir.multiplyScalar(10));
    if (fillRef.current) fillRef.current.position.copy(fillDir.multiplyScalar(10));
  });

  // Initial positions — overridden by useFrame for non-default modes
  const defaultMain: [number, number, number] = direction === 'default' ? [5, 5, 5] : [0, 0, 10];
  const defaultFill: [number, number, number] = direction === 'default' ? [-3, -3, 2] : [5, 3, 0];

  return (
    <>
      <ambientLight intensity={ambient} />
      <directionalLight ref={mainRef} position={defaultMain} intensity={main} />
      <directionalLight ref={fillRef} position={defaultFill} intensity={fill} />
    </>
  );
}

/** Preset-specific material */
function SurfaceMaterial({ color, opacity, preset, wireframe }: {
  color: string;
  opacity: number;
  preset: RenderPreset;
  wireframe: boolean;
}) {
  const isTransparent = opacity < 1;
  const side = THREE.DoubleSide;

  switch (preset) {
    case 'matte':
      return (
        <meshPhongMaterial
          color={color}
          transparent={isTransparent}
          opacity={opacity}
          specular="#333333"
          shininess={10}
          side={side}
          depthWrite
          wireframe={wireframe}
        />
      );
    case 'glossy':
      return (
        <meshPhongMaterial
          color={color}
          transparent={isTransparent}
          opacity={opacity}
          specular="#ffffff"
          shininess={200}
          side={side}
          depthWrite
          wireframe={wireframe}
        />
      );
    case 'glass':
      return (
        <meshPhysicalMaterial
          color={color}
          transparent
          opacity={1}
          transmission={1 - opacity}
          roughness={0.05}
          ior={1.45}
          thickness={0.5}
          side={side}
          depthWrite
          wireframe={wireframe}
        />
      );
    case 'toon':
      return (
        <meshToonMaterial
          color={color}
          transparent={isTransparent}
          opacity={opacity}
          side={side}
          depthWrite
          wireframe={wireframe}
        />
      );
    case 'minimal-white':
      return (
        <meshPhysicalMaterial
          color={color}
          transparent={isTransparent}
          opacity={opacity}
          roughness={0.7}
          clearcoat={0.3}
          clearcoatRoughness={0.4}
          side={side}
          depthWrite
          wireframe={wireframe}
        />
      );
    case 'standard':
    default:
      return (
        <meshStandardMaterial
          color={color}
          transparent={isTransparent}
          opacity={opacity}
          side={side}
          depthWrite
          wireframe={wireframe}
        />
      );
  }
}

function AtomSphere({ atom, scale, showLabel, onClick, atomColors }: {
  atom: Atom; scale: number; showLabel?: boolean;
  onClick?: (atom: Atom) => void;
  atomColors?: Record<number, string>;
}) {
  const color = atomColors?.[atom.atomicNumber] || CPK_COLORS[atom.atomicNumber] || '#FF69B4';
  const radius = (DISPLAY_RADII[atom.atomicNumber] || 0.35) * scale;
  const pos: [number, number, number] = [atom.position.x, atom.position.y, atom.position.z];

  return (
    <group position={pos}>
      <mesh onClick={onClick ? (e) => { e.stopPropagation(); onClick(atom); } : undefined}>
        <sphereGeometry args={[radius, 24, 24]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {showLabel && (
        <Html distanceFactor={8} zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
          <span style={{
            fontSize: 11, fontWeight: 600, color: '#fff',
            background: 'rgba(0,0,0,0.55)', borderRadius: 3,
            padding: '1px 4px', whiteSpace: 'nowrap', userSelect: 'none',
          }}>
            {atom.symbol}
          </span>
        </Html>
      )}
    </group>
  );
}

function Bond({ start, end, scale }: { start: Atom; end: Atom; scale: number }) {
  const { midPoint, quaternion, length } = useMemo(() => {
    const dir = new THREE.Vector3(
      end.position.x - start.position.x,
      end.position.y - start.position.y,
      end.position.z - start.position.z,
    );
    const len = dir.length();
    const mid = new THREE.Vector3(
      (start.position.x + end.position.x) / 2,
      (start.position.y + end.position.y) / 2,
      (start.position.z + end.position.z) / 2,
    );
    const quat = new THREE.Quaternion();
    if (len > 1e-10) {
      quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    }
    return { midPoint: mid, quaternion: quat, length: len };
  }, [start, end]);

  return (
    <mesh position={midPoint} quaternion={quaternion}>
      <cylinderGeometry args={[0.08 * scale, 0.08 * scale, length, 8]} />
      <meshStandardMaterial color="#AAAAAA" />
    </mesh>
  );
}

function Bonds({ atoms, scale }: { atoms: Atom[]; scale: number }) {
  const bonds = useMemo(() => {
    const result: [Atom, Atom][] = [];
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const a = atoms[i];
        const b = atoms[j];
        const dx = a.position.x - b.position.x;
        const dy = a.position.y - b.position.y;
        const dz = a.position.z - b.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        const rA = COVALENT_RADII[a.atomicNumber] || 0.77;
        const rB = COVALENT_RADII[b.atomicNumber] || 0.77;
        if (dist < (rA + rB) * 1.3) {
          result.push([a, b]);
        }
      }
    }
    return result;
  }, [atoms]);

  return (
    <>
      {bonds.map(([a, b], i) => (
        <Bond key={i} start={a} end={b} scale={scale} />
      ))}
    </>
  );
}

function IsosurfaceObject({
  mesh, color, settings,
}: {
  mesh: IsosurfaceMesh;
  color: string;
  settings: RenderSettings;
}) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mesh.vertices, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geo.computeBoundingSphere();
    return geo;
  }, [mesh]);

  useEffect(() => {
    return () => { geometry.dispose(); };
  }, [geometry]);

  const isWireOnly = settings.surfaceMode === 'wireframe';
  const isSolidWire = settings.surfaceMode === 'solid+wire';
  const effectiveOpacity = isWireOnly ? 1 : settings.opacity;
  const isTransparent = effectiveOpacity < 1;

  return (
    <group>
      {/* Pass 1: depth-only pre-pass for transparent surfaces */}
      {isTransparent && (
        <mesh geometry={geometry} renderOrder={0}>
          <meshBasicMaterial
            colorWrite={false}
            depthWrite
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      {/* Pass 2: color pass */}
      <mesh geometry={geometry} renderOrder={isTransparent ? 1 : 0}>
        <SurfaceMaterial
          color={color}
          opacity={effectiveOpacity}
          preset={settings.preset}
          wireframe={isWireOnly}
        />
      </mesh>
      {isSolidWire && (
        <mesh geometry={geometry} renderOrder={isTransparent ? 2 : 0}>
          <meshBasicMaterial
            color="#ffffff"
            wireframe
            transparent
            opacity={0.15}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}

/** Exposes R3F internals (gl, scene, camera) to outside via ref */
function SceneCapture({ sceneRef, bgColor }: { sceneRef: React.RefObject<{ gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera } | null>; bgColor: string }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    sceneRef.current = { gl, scene, camera };
  }, [gl, scene, camera, sceneRef]);
  // Keep scene.background in sync with the CSS background color
  useEffect(() => {
    scene.background = new THREE.Color(bgColor);
    gl.setClearColor(new THREE.Color(bgColor), 1);
  }, [bgColor, scene, gl]);
  return null;
}

/** Cross-section indicator: translucent plane + border showing cut position in 3D */
function CrossSectionIndicator({ grid, plane, position }: {
  grid: Grid3D;
  plane: 'XY' | 'XZ' | 'YZ';
  position: number;
}) {
  const [planePos, planeRot, planeSize] = useMemo((): [[number, number, number], [number, number, number], [number, number]] => {
    const { origin: o, size: s, spacing: sp } = grid;
    const cx = o.x + (s.x - 1) * sp / 2;
    const cy = o.y + (s.y - 1) * sp / 2;
    const cz = o.z + (s.z - 1) * sp / 2;
    const w = (s.x - 1) * sp;
    const h = (s.y - 1) * sp;
    const d = (s.z - 1) * sp;

    switch (plane) {
      case 'XY': {
        const z = o.z + ((position + 1) / 2) * (s.z - 1) * sp;
        return [[cx, cy, z], [0, 0, 0], [w, h]];
      }
      case 'XZ': {
        const y = o.y + ((position + 1) / 2) * (s.y - 1) * sp;
        return [[cx, y, cz], [-Math.PI / 2, 0, 0], [w, d]];
      }
      case 'YZ': {
        const x = o.x + ((position + 1) / 2) * (s.x - 1) * sp;
        return [[x, cy, cz], [0, Math.PI / 2, 0], [h, d]];
      }
    }
  }, [grid, plane, position]);

  const borderPoints = useMemo(() => {
    const hw = planeSize[0] / 2, hh = planeSize[1] / 2;
    return [
      new THREE.Vector3(-hw, -hh, 0),
      new THREE.Vector3(hw, -hh, 0),
      new THREE.Vector3(hw, hh, 0),
      new THREE.Vector3(-hw, hh, 0),
      new THREE.Vector3(-hw, -hh, 0),
    ];
  }, [planeSize]);

  return (
    <group position={planePos} rotation={planeRot}>
      <mesh>
        <planeGeometry args={planeSize} />
        <meshBasicMaterial color="#ffcc00" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={borderPoints} color="#ffcc00" lineWidth={2} />
    </group>
  );
}

/** HQ post-processing: Environment map + SSAO + Bloom + ToneMapping */
function HQEffects({ enabled, ssaoIntensity = 3 }: { enabled: boolean; ssaoIntensity?: number }) {
  if (!enabled) return null;
  return (
    <>
      <Environment preset="studio" background={false} environmentIntensity={0.4} />
      <EffectComposer key={`ec-${ssaoIntensity}`} multisampling={0} enableNormalPass>
        <SSAO
          blendFunction={BlendFunction.MULTIPLY}
          samples={32}
          radius={0.15}
          intensity={ssaoIntensity}
          luminanceInfluence={0.6}
        />
        <Bloom intensity={0.15} luminanceThreshold={0.9} mipmapBlur />
      </EffectComposer>
    </>
  );
}

type ViewAngle = 'reset' | 'top' | 'cw' | 'ccw';

function getMoleculeCenter(atoms: Atom[]): [number, number, number] {
  if (atoms.length === 0) return [0, 0, 0];
  let cx = 0, cy = 0, cz = 0;
  for (const a of atoms) {
    cx += a.position.x;
    cy += a.position.y;
    cz += a.position.z;
  }
  return [cx / atoms.length, cy / atoms.length, cz / atoms.length];
}

function getMoleculeRadius(atoms: Atom[], center: [number, number, number]): number {
  let maxR = 0;
  for (const a of atoms) {
    const dx = a.position.x - center[0];
    const dy = a.position.y - center[1];
    const dz = a.position.z - center[2];
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (r > maxR) maxR = r;
  }
  return Math.max(maxR, 2) * 1.8;
}

function CameraController({
  atoms,
  viewRequest,
  onViewApplied,
  controlsRef,
}: {
  atoms: Atom[];
  viewRequest: ViewAngle | null;
  onViewApplied: () => void;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
}) {
  const { camera } = useThree();

  // Initial camera setup
  useEffect(() => {
    if (atoms.length === 0) return;
    const [cx, cy, cz] = getMoleculeCenter(atoms);
    camera.position.set(cx + 6, cy + 4, cz + 6);
    camera.lookAt(cx, cy, cz);
    if (controlsRef.current) {
      controlsRef.current.target.set(cx, cy, cz);
      controlsRef.current.update();
    }
  }, [atoms, camera, controlsRef]);

  // Handle view request
  useEffect(() => {
    if (!viewRequest || atoms.length === 0) return;
    const [cx, cy, cz] = getMoleculeCenter(atoms);
    const target = controlsRef.current?.target ?? new THREE.Vector3(cx, cy, cz);
    const currentDist = camera.position.distanceTo(target);

    if (viewRequest === 'cw' || viewRequest === 'ccw') {
      // Rotate 90 degrees around view axis
      const offset = new THREE.Vector3().subVectors(camera.position, target);
      const viewDir = offset.clone().normalize();
      const angle = viewRequest === 'cw' ? -Math.PI / 2 : Math.PI / 2;
      camera.up.applyAxisAngle(viewDir, angle);
      camera.lookAt(target.x, target.y, target.z);
    } else {
      // Reset target to molecule center
      if (controlsRef.current) {
        controlsRef.current.target.set(cx, cy, cz);
      }
      const directions: Record<string, [number, number, number]> = {
        reset: [0.577, 0.577, 0.577],
        top:   [0, 1, 0.001],
      };
      const dir = directions[viewRequest];
      const len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
      camera.position.set(
        cx + dir[0] / len * currentDist,
        cy + dir[1] / len * currentDist,
        cz + dir[2] / len * currentDist,
      );
      camera.up.set(0, 1, 0);
      camera.lookAt(cx, cy, cz);
    }

    if (controlsRef.current) {
      controlsRef.current.update();
    }
    onViewApplied();
  }, [viewRequest, atoms, camera, controlsRef, onViewApplied]);

  return null;
}

/** Measurement lines & labels (distance for 2 atoms, angle for 3) */
function MeasurementOverlay({ atoms }: { atoms: Atom[] }) {
  if (atoms.length < 2) return null;

  const positions = atoms.map((a) => new THREE.Vector3(a.position.x, a.position.y, a.position.z));

  const lines: [THREE.Vector3, THREE.Vector3][] = [];
  for (let i = 0; i < positions.length - 1; i++) {
    lines.push([positions[i], positions[i + 1]]);
  }

  let label = '';
  let labelPos = new THREE.Vector3();

  if (atoms.length === 2) {
    const dist = positions[0].distanceTo(positions[1]);
    label = `${dist.toFixed(3)} \u00C5`;
    labelPos = positions[0].clone().add(positions[1]).multiplyScalar(0.5);
  } else if (atoms.length >= 3) {
    const v1 = positions[0].clone().sub(positions[1]).normalize();
    const v2 = positions[2].clone().sub(positions[1]).normalize();
    const angle = Math.acos(THREE.MathUtils.clamp(v1.dot(v2), -1, 1)) * (180 / Math.PI);
    label = `${angle.toFixed(1)}\u00B0`;
    labelPos = positions[1].clone();
  }

  return (
    <>
      {lines.map(([a, b], i) => (
        <Line key={i} points={[a, b]} color="#ffff00" lineWidth={2} depthTest={false} />
      ))}
      {/* Highlight selected atoms */}
      {positions.map((p, i) => (
        <mesh key={`ring-${i}`} position={p}>
          <ringGeometry args={[0.35, 0.45, 32]} />
          <meshBasicMaterial color="#ffff00" side={THREE.DoubleSide} depthTest={false} transparent opacity={0.7} />
        </mesh>
      ))}
      <Html position={labelPos} zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
        <span style={{
          fontSize: 13, fontWeight: 700, color: '#ffff00',
          background: 'rgba(0,0,0,0.6)', borderRadius: 4,
          padding: '2px 6px', whiteSpace: 'nowrap', userSelect: 'none',
          textShadow: '0 0 3px #000',
        }}>
          {label}
        </span>
      </Html>
    </>
  );
}

const VIEW_BUTTONS: { value: ViewAngle; label: string; title: string }[] = [
  { value: 'reset', label: '\u2302', title: 'Reset view' },
  { value: 'top', label: 'T', title: 'Top view' },
  { value: 'ccw', label: '\u21BA', title: 'Rotate CCW 90\u00B0' },
  { value: 'cw', label: '\u21BB', title: 'Rotate CW 90\u00B0' },
];

export const MoleculeViewer = forwardRef<MoleculeViewerHandle, Props>(function MoleculeViewer({ atoms, positiveMesh, negativeMesh, comparePositiveMesh, compareNegativeMesh, canvasBg = '#e8eaf0', renderSettings, hqMode, ssaoIntensity, t, viewMode, crossSection, gridInfo }, ref) {
  const [schemePos, schemeNeg] = renderSettings.colorScheme === 'custom'
    ? renderSettings.customColors
    : COLOR_SCHEMES[renderSettings.colorScheme] ?? ['#4488ff', '#ff4444'];
  const posColor = viewMode === 'density' ? renderSettings.densityColor : schemePos;
  const negColor = schemeNeg;
  const bg = renderSettings.canvasColor || getPresetBg(renderSettings.preset, canvasBg);
  const [viewRequest, setViewRequest] = useState<ViewAngle | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [rotateSpeed, setRotateSpeed] = useState(2);
  const [rotateCW, setRotateCW] = useState(false);
  const [measureAtoms, setMeasureAtoms] = useState<Atom[]>([]);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<{ gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera } | null>(null);
  const csIndicatorRef = useRef<THREE.Group>(null);

  // Clear measurement when a new molecule is loaded
  useEffect(() => {
    setMeasureAtoms([]);
  }, [atoms]);

  const handleAtomClick = (atom: Atom) => {
    setMeasureAtoms((prev) => {
      const next = [...prev, atom];
      if (next.length > 3) return [atom]; // reset after angle
      return next;
    });
  };

  const [showSavePopup, setShowSavePopup] = useState(false);
  const [saveTransparent, setSaveTransparent] = useState(false);
  const [saveDpi, setSaveDpi] = useState(1);

  // Video recording state
  const [showRecordPopup, setShowRecordPopup] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordProgress, setRecordProgress] = useState(0);
  const [recordLoops, setRecordLoops] = useState(1);
  const [recordRotateCW, setRecordRotateCW] = useState(false);
  const [recordRotateSpeed, setRecordRotateSpeed] = useState(2);
  const [recordTransparent, setRecordTransparent] = useState(false);
  const [pendingVideoBlob, setPendingVideoBlob] = useState<{ blob: Blob; name: string } | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordCancelledRef = useRef(false);
  const exportingRef = useRef(false);

  // Wait N animation frames (for EffectComposer to render post-processed result)
  const waitFrames = (n: number) => new Promise<void>(resolve => {
    let count = 0;
    const tick = () => { if (++count >= n) resolve(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });

  const saveImage = async () => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    const r3f = sceneRef.current;
    if (!r3f) { exportingRef.current = false; return; }
    const { gl, scene, camera } = r3f;
    if (csIndicatorRef.current) csIndicatorRef.current.visible = false;

    // Save original state
    const prevSize = gl.getSize(new THREE.Vector2());
    const prevPixelRatio = gl.getPixelRatio();
    const prevBg = scene.background;
    const prevClearAlpha = gl.getClearAlpha();

    // Apply DPI scale
    const scale = saveDpi;
    if (scale !== 1) {
      gl.setPixelRatio(scale);
      gl.setSize(prevSize.x, prevSize.y);
    }

    let blob: Blob | null = null;

    // HQ mode needs extra frames when DPI scale changes (EffectComposer FBO resize)
    const hqFrames = scale !== 1 ? 4 : 2;

    if (saveTransparent) {
      gl.setClearColor(0x000000, 0);
      scene.background = null;
      if (hqMode) {
        await waitFrames(hqFrames);
      } else {
        gl.render(scene, camera);
      }
      blob = await new Promise<Blob | null>((resolve) => gl.domElement.toBlob(resolve, 'image/png'));
    } else {
      scene.background = new THREE.Color(bg);
      gl.setClearColor(new THREE.Color(bg), 1);
      if (hqMode) {
        await waitFrames(hqFrames);
      } else {
        gl.render(scene, camera);
      }
      const srcCanvas = gl.domElement;
      const w = srcCanvas.width;
      const h = srcCanvas.height;
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = w;
      tmpCanvas.height = h;
      const ctx = tmpCanvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(srcCanvas, 0, 0);
        blob = await new Promise<Blob | null>((resolve) => tmpCanvas.toBlob(resolve, 'image/png'));
      }
    }

    // Restore original state
    scene.background = prevBg;
    gl.setClearAlpha(prevClearAlpha);
    if (scale !== 1) {
      gl.setPixelRatio(prevPixelRatio);
      gl.setSize(prevSize.x, prevSize.y);
    }
    if (csIndicatorRef.current) csIndicatorRef.current.visible = true;
    if (hqMode) {
      await waitFrames(2);
    } else {
      gl.render(scene, camera);
    }

    if (!blob) { exportingRef.current = false; return; }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `morbvis_${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
    exportingRef.current = false;
  };

  // Check if MediaRecorder is supported
  const canRecord = typeof MediaRecorder !== 'undefined' &&
    (MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ||
     MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ||
     MediaRecorder.isTypeSupported('video/webm'));

  const startRecording = () => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    const canvas = canvasContainerRef.current?.querySelector('canvas');
    if (!canvas) { exportingRef.current = false; return; }
    const r3f = sceneRef.current;
    if (!r3f) { exportingRef.current = false; return; }
    const { gl, scene } = r3f;

    // Determine codec
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : 'video/webm';

    // Setup background for recording
    const prevBg = scene.background;
    const prevClearAlpha = gl.getClearAlpha();
    if (recordTransparent) {
      scene.background = null;
      gl.setClearColor(0x000000, 0);
    } else {
      scene.background = new THREE.Color(bg);
      gl.setClearColor(new THREE.Color(bg), 1);
    }

    // Hide cross-section indicator during recording
    if (csIndicatorRef.current) csIndicatorRef.current.visible = false;

    // Enable auto-rotate for recording
    const prevAutoRotate = autoRotate;
    const controls = controlsRef.current;
    const recSpeed = recordRotateCW ? recordRotateSpeed : -recordRotateSpeed;
    // Three.js OrbitControls: autoRotateSpeed=2 → 360° in ~30s at 60fps → period = 60/|speed| seconds
    const durationSec = recordLoops * 60 / recordRotateSpeed;
    const durationMs = durationSec * 1000;
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = recSpeed;
    }

    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
    mediaRecorderRef.current = recorder;
    recordCancelledRef.current = false;
    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = async () => {
      // Restore state
      if (csIndicatorRef.current) csIndicatorRef.current.visible = true;
      scene.background = prevBg;
      gl.setClearAlpha(prevClearAlpha);
      if (controls) {
        controls.autoRotate = prevAutoRotate;
        controls.autoRotateSpeed = rotateCW ? rotateSpeed : -rotateSpeed;
      }
      setRecording(false);
      setRecordProgress(0);
      mediaRecorderRef.current = null;
      exportingRef.current = false;

      if (recordCancelledRef.current || chunks.length === 0) return;

      const blob = new Blob(chunks, { type: mimeType });
      const videoName = `morbvis_${recordLoops}loop_${Date.now()}.webm`;
      setPendingVideoBlob({ blob, name: videoName });
    };

    recorder.start(100); // collect data every 100ms
    setRecording(true);
    setShowRecordPopup(false);

    // Track progress and stop after duration
    const startTime = Date.now();
    const progressInterval = setInterval(() => {
      if (recordCancelledRef.current) {
        clearInterval(progressInterval);
        return;
      }
      const elapsed = Date.now() - startTime;
      setRecordProgress(Math.min(100, Math.round((elapsed / durationMs) * 100)));
      if (elapsed >= durationMs) {
        clearInterval(progressInterval);
        if (recorder.state === 'recording') recorder.stop();
      }
    }, 100);
  };

  const cancelRecording = () => {
    recordCancelledRef.current = true;
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const saveVideo = async () => {
    if (!pendingVideoBlob) return;
    const { blob, name } = pendingVideoBlob;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    setPendingVideoBlob(null);
  };

  // Expose captureImage for batch export
  useImperativeHandle(ref, () => ({
    captureImage: async (dpiScale: number, transparent: boolean): Promise<Blob | null> => {
      const r3f = sceneRef.current;
      if (!r3f) return null;
      const { gl, scene, camera: cam } = r3f;
      // Hide cross-section indicator during PNG capture
      if (csIndicatorRef.current) csIndicatorRef.current.visible = false;

      const prevSize = gl.getSize(new THREE.Vector2());
      const prevPixelRatio = gl.getPixelRatio();
      const prevBg = scene.background;
      const prevClearAlpha = gl.getClearAlpha();

      if (dpiScale !== 1) {
        gl.setPixelRatio(dpiScale);
        gl.setSize(prevSize.x, prevSize.y);
      }

      // Helper: synchronous capture via toDataURL (more reliable than async toBlob)
      const captureToBlob = (srcCanvas: HTMLCanvasElement): Blob => {
        const dataUrl = srcCanvas.toDataURL('image/png');
        const bin = atob(dataUrl.split(',')[1]);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: 'image/png' });
      };

      // HQ mode needs extra frames when DPI scale changes (EffectComposer FBO resize)
      const hqFrames = dpiScale !== 1 ? 4 : 2;

      let blob: Blob | null = null;
      if (transparent) {
        gl.setClearColor(0x000000, 0);
        scene.background = null;
        if (hqMode) {
          await waitFrames(hqFrames);
        } else {
          gl.render(scene, cam);
        }
        blob = captureToBlob(gl.domElement);
      } else {
        scene.background = new THREE.Color(bg);
        gl.setClearColor(new THREE.Color(bg), 1);
        if (hqMode) {
          await waitFrames(hqFrames);
        } else {
          gl.render(scene, cam);
        }
        const srcCanvas = gl.domElement;
        const w = srcCanvas.width, h = srcCanvas.height;
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = w; tmpCanvas.height = h;
        const ctx = tmpCanvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(srcCanvas, 0, 0);
          blob = captureToBlob(tmpCanvas);
        }
      }

      scene.background = prevBg;
      gl.setClearAlpha(prevClearAlpha);
      if (dpiScale !== 1) {
        gl.setPixelRatio(prevPixelRatio);
        gl.setSize(prevSize.x, prevSize.y);
      }
      // Restore cross-section indicator
      if (csIndicatorRef.current) csIndicatorRef.current.visible = true;
      if (hqMode) {
        await waitFrames(2);
      } else {
        gl.render(scene, cam);
      }
      return blob;
    },
  }));

  return (
    <CanvasErrorBoundary>
      <div ref={canvasContainerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
        <Canvas
          style={{ width: '100%', height: '100%', background: bg }}
          gl={{ preserveDrawingBuffer: true }}
          camera={{ fov: 50, near: 0.1, far: 100 }}
        >
          <SceneCapture sceneRef={sceneRef} bgColor={bg} />
          <SceneLighting preset={renderSettings.preset} direction={renderSettings.lightDirection} intensity={renderSettings.lightIntensity} />
          <CameraController
            atoms={atoms}
            viewRequest={viewRequest}
            onViewApplied={() => setViewRequest(null)}
            controlsRef={controlsRef}
          />

          {renderSettings.atomScale > 0 && atoms.map((atom) => (
            <AtomSphere key={atom.index} atom={atom} scale={renderSettings.atomScale}
              showLabel={renderSettings.showAtomLabels} onClick={handleAtomClick}
              atomColors={renderSettings.atomColors} />
          ))}
          {renderSettings.bondScale > 0 && (
            <Bonds atoms={atoms} scale={renderSettings.bondScale} />
          )}

          {/* Isosurface meshes */}
          {positiveMesh && positiveMesh.vertices.length > 0 && (
            <IsosurfaceObject mesh={positiveMesh} color={posColor} settings={renderSettings} />
          )}
          {negativeMesh && negativeMesh.vertices.length > 0 && (
            <IsosurfaceObject mesh={negativeMesh} color={negColor} settings={renderSettings} />
          )}

          {/* Compare MO (wireframe overlay) — hidden in density mode */}
          {viewMode !== 'density' && comparePositiveMesh && comparePositiveMesh.vertices.length > 0 && (
            <IsosurfaceObject mesh={comparePositiveMesh} color={posColor}
              settings={{ ...renderSettings, surfaceMode: 'wireframe', opacity: 0.35 }} />
          )}
          {viewMode !== 'density' && compareNegativeMesh && compareNegativeMesh.vertices.length > 0 && (
            <IsosurfaceObject mesh={compareNegativeMesh} color={negColor}
              settings={{ ...renderSettings, surfaceMode: 'wireframe', opacity: 0.35 }} />
          )}

          {/* Cross-section indicator (hidden during PNG export) */}
          {crossSection?.enabled && gridInfo && (
            <group ref={csIndicatorRef}>
              <CrossSectionIndicator
                grid={gridInfo}
                plane={crossSection.plane}
                position={crossSection.position}
              />
            </group>
          )}

          <MeasurementOverlay atoms={measureAtoms} />

          <OrbitControls
            ref={controlsRef}
            enableDamping
            dampingFactor={0.1}
            autoRotate={showRecordPopup || recording || autoRotate}
            autoRotateSpeed={
              (showRecordPopup || recording)
                ? (recordRotateCW ? recordRotateSpeed : -recordRotateSpeed)
                : (rotateCW ? rotateSpeed : -rotateSpeed)
            }
          />
          <HQEffects enabled={hqMode ?? false} ssaoIntensity={ssaoIntensity} />
        </Canvas>

        {/* View controls & save button */}
        <div style={{
          position: 'absolute',
          top: 8,
          right: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            background: 'rgba(0,0,0,0.35)',
            borderRadius: 6,
            padding: 3,
          }}>
            {VIEW_BUTTONS.map((v) => (
              <button
                key={v.value}
                onClick={() => setViewRequest(v.value)}
                title={v.title}
                style={{
                  width: 28,
                  height: 28,
                  border: 'none',
                  borderRadius: 4,
                  background: 'rgba(255,255,255,0.12)',
                  color: '#fff',
                  fontSize: v.value === 'reset' ? 16 : 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowSavePopup((v) => !v)}
              title={t('viewer.save')}
              style={{
                width: 28,
                height: 28,
                border: 'none',
                borderRadius: 6,
                background: showSavePopup ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.35)',
                color: '#fff',
                fontSize: 14,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 3,
              }}
            >
              {'\u2B07'}
            </button>
            {showSavePopup && (
              <div style={{
                position: 'absolute',
                top: 0,
                right: 34,
                background: 'rgba(0,0,0,0.7)',
                borderRadius: 6,
                padding: '8px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                whiteSpace: 'nowrap',
                minWidth: 150,
              }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#fff', fontSize: 11, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={saveTransparent}
                    onChange={(e) => setSaveTransparent(e.target.checked)}
                    style={{ accentColor: '#4488ff' }}
                  />
                  {t('viewer.transparentBg')}
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#fff', fontSize: 11 }}>DPI</span>
                  <select
                    value={saveDpi}
                    onChange={(e) => setSaveDpi(Number(e.target.value))}
                    style={{
                      background: 'rgba(255,255,255,0.15)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 3,
                      padding: '2px 4px',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    <option value={1} style={{ color: '#000' }}>1x</option>
                    <option value={2} style={{ color: '#000' }}>2x</option>
                    <option value={3} style={{ color: '#000' }}>3x</option>
                    <option value={4} style={{ color: '#000' }}>4x</option>
                  </select>
                </div>
                <button
                  onClick={() => { setShowSavePopup(false); saveImage(); }}
                  style={{
                    border: 'none',
                    borderRadius: 4,
                    background: '#4488ff',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '4px 8px',
                    cursor: 'pointer',
                  }}
                >
                  {t('viewer.savePng')}
                </button>
              </div>
            )}
          </div>
          {/* Record video button */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => {
                if (recording) {
                  cancelRecording();
                } else if (canRecord) {
                  setShowRecordPopup((v) => {
                    if (!v) setAutoRotate(false); // close auto-rotate when opening record popup
                    return !v;
                  });
                } else {
                  alert(t('viewer.notSupported'));
                }
              }}
              title={recording ? t('viewer.recordCancel') : t('viewer.record')}
              style={{
                width: 28,
                height: 28,
                border: 'none',
                borderRadius: 6,
                background: recording ? 'rgba(255,50,50,0.7)' : showRecordPopup ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.35)',
                color: '#fff',
                fontSize: 14,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 3,
                animation: recording ? 'pulse 1s infinite' : undefined,
              }}
            >
              {recording ? '\u23F9' : '\u23FA'}
            </button>
            {showRecordPopup && !recording && (
              <div style={{
                position: 'absolute',
                top: 0,
                right: 34,
                background: 'rgba(0,0,0,0.7)',
                borderRadius: 6,
                padding: '8px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                whiteSpace: 'nowrap',
                minWidth: 150,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#fff', fontSize: 11 }}>{t('viewer.rotations')}</span>
                  <select
                    value={recordLoops}
                    onChange={(e) => setRecordLoops(Number(e.target.value))}
                    style={{
                      background: 'rgba(255,255,255,0.15)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 3,
                      padding: '2px 4px',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    <option value={1} style={{ color: '#000' }}>1</option>
                    <option value={2} style={{ color: '#000' }}>2</option>
                    <option value={3} style={{ color: '#000' }}>3</option>
                    <option value={5} style={{ color: '#000' }}>5</option>
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#fff', fontSize: 11 }}>{t('viewer.direction')}</span>
                  <button
                    onClick={() => setRecordRotateCW((v) => !v)}
                    title={recordRotateCW ? t('viewer.switchCCW') : t('viewer.switchCW')}
                    style={{
                      width: 24, height: 24, border: 'none', borderRadius: 4,
                      background: 'rgba(255,255,255,0.15)', color: '#fff',
                      fontSize: 13, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {recordRotateCW ? '\u21BB' : '\u21BA'}
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#fff', fontSize: 11 }}>{t('viewer.speed')}</span>
                  <input
                    type="range"
                    min={0.5} max={20} step={0.5}
                    value={recordRotateSpeed}
                    onChange={(e) => setRecordRotateSpeed(parseFloat(e.target.value))}
                    title={`${recordRotateSpeed}`}
                    style={{ width: 60, accentColor: '#fff' }}
                  />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#fff', fontSize: 11, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={recordTransparent}
                    onChange={(e) => setRecordTransparent(e.target.checked)}
                    style={{ accentColor: '#4488ff' }}
                  />
                  {t('viewer.transparentBg')}
                </label>
                <button
                  onClick={startRecording}
                  style={{
                    border: 'none',
                    borderRadius: 4,
                    background: '#ff4444',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '4px 8px',
                    cursor: 'pointer',
                  }}
                >
                  {t('viewer.startRecord')} ({Math.round(recordLoops * 60 / recordRotateSpeed)}s)
                </button>
              </div>
            )}
            {recording && (
              <div style={{
                position: 'absolute',
                top: 0,
                right: 34,
                background: 'rgba(0,0,0,0.7)',
                borderRadius: 6,
                padding: '6px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
              }}>
                <div style={{
                  width: 60,
                  height: 4,
                  background: 'rgba(255,255,255,0.2)',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${recordProgress}%`,
                    height: '100%',
                    background: '#ff4444',
                    transition: 'width 0.1s',
                  }} />
                </div>
                <span style={{ color: '#fff', fontSize: 10 }}>{recordProgress}%</span>
              </div>
            )}
            {pendingVideoBlob && !recording && (
              <div style={{
                position: 'absolute',
                top: 0,
                right: 34,
                background: 'rgba(0,0,0,0.7)',
                borderRadius: 6,
                padding: '4px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
              }}>
                <button
                  onClick={saveVideo}
                  style={{
                    border: 'none',
                    borderRadius: 4,
                    background: '#4488ff',
                    color: '#fff',
                    fontSize: 11,
                    padding: '3px 10px',
                    cursor: 'pointer',
                  }}
                >
                  {t('viewer.saveVideo')}
                </button>
                <button
                  onClick={() => setPendingVideoBlob(null)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'rgba(255,255,255,0.6)',
                    fontSize: 14,
                    cursor: 'pointer',
                    padding: 0,
                    lineHeight: 1,
                  }}
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { setAutoRotate((r) => !r); setShowRecordPopup(false); }}
              title={autoRotate ? t('viewer.stopRotate') : t('viewer.autoRotate')}
              style={{
                width: 28,
                height: 28,
                border: 'none',
                borderRadius: 6,
                background: autoRotate ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.35)',
                color: '#fff',
                fontSize: 14,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 3,
              }}
            >
              {'\u27F3'}
            </button>
            {autoRotate && !showRecordPopup && !recording && (
              <div style={{
                position: 'absolute',
                top: 0,
                right: 34,
                background: 'rgba(0,0,0,0.6)',
                borderRadius: 6,
                padding: '6px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
              }}>
                <button
                  onClick={() => setRotateCW((v) => !v)}
                  title={rotateCW ? t('viewer.switchCCW') : t('viewer.switchCW')}
                  style={{
                    width: 24, height: 24, border: 'none', borderRadius: 4,
                    background: 'rgba(255,255,255,0.15)', color: '#fff',
                    fontSize: 13, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {rotateCW ? '\u21BB' : '\u21BA'}
                </button>
                <input
                  type="range"
                  min={0.5} max={20} step={0.5}
                  value={rotateSpeed}
                  onChange={(e) => setRotateSpeed(parseFloat(e.target.value))}
                  title={`Speed: ${rotateSpeed}`}
                  style={{ width: 60, accentColor: '#fff' }}
                />
              </div>
            )}
          </div>
          <button
            onClick={() => {
              const el = canvasContainerRef.current;
              if (!el) return;
              if (document.fullscreenElement) {
                document.exitFullscreen();
              } else {
                el.requestFullscreen();
              }
            }}
            title={t('viewer.fullscreen')}
            style={{
              width: 28,
              height: 28,
              border: 'none',
              borderRadius: 6,
              background: 'rgba(0,0,0,0.35)',
              color: '#fff',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 3,
            }}
          >
            {'\u26F6'}
          </button>
          {measureAtoms.length > 0 && (
            <button
              onClick={() => setMeasureAtoms([])}
              title={t('viewer.clearMeasure')}
              style={{
                width: 28,
                height: 28,
                border: 'none',
                borderRadius: 6,
                background: 'rgba(255,200,0,0.5)',
                color: '#fff',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 3,
              }}
            >
              {'\u00D7'}
            </button>
          )}
        </div>

        {/* Measurement hint */}
        {measureAtoms.length > 0 && measureAtoms.length < 3 && (
          <div style={{
            position: 'absolute', bottom: 8, left: 8,
            fontSize: 11, color: '#fff', background: 'rgba(0,0,0,0.5)',
            borderRadius: 4, padding: '3px 8px',
          }}>
            {measureAtoms.length === 1
              ? `${measureAtoms[0].symbol}${measureAtoms[0].index} selected — click another atom for distance`
              : 'Click a 3rd atom for angle, or click clear'
            }
          </div>
        )}
      </div>
    </CanvasErrorBoundary>
  );
});
