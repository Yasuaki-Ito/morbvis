import { useMemo, useEffect, useState, useRef, Component, type ReactNode } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { Atom, IsosurfaceMesh, RenderSettings, RenderPreset, ColorScheme, LightDirection } from '../types';

// Color scheme definitions: [positive, negative]
const COLOR_SCHEMES: Record<ColorScheme, [string, string]> = {
  'classic':      ['#4488ff', '#ff4444'],
  'teal-orange':  ['#00bcd4', '#ff9800'],
  'green-purple': ['#4caf50', '#9c27b0'],
  'mono':         ['#ffffff', '#888888'],
};

// CPK colors (atomic number -> color)
const CPK_COLORS: Record<number, string> = {
  1: '#FFFFFF',  // H
  6: '#909090',  // C
  7: '#3050F8',  // N
  8: '#FF0D0D',  // O
  9: '#90E050',  // F
  15: '#FF8000', // P
  16: '#FFFF30', // S
  17: '#1FF01F', // Cl
  35: '#A62929', // Br
  53: '#940094', // I
};

// Covalent radii (Angstrom)
const COVALENT_RADII: Record<number, number> = {
  1: 0.31, 6: 0.76, 7: 0.71, 8: 0.66, 9: 0.57,
  15: 1.07, 16: 1.05, 17: 1.02, 35: 1.20, 53: 1.39,
};

// Display radii (scaled down)
const DISPLAY_RADII: Record<number, number> = {
  1: 0.25, 6: 0.4, 7: 0.38, 8: 0.36, 9: 0.35,
  15: 0.45, 16: 0.45, 17: 0.42, 35: 0.47, 53: 0.5,
};

interface Props {
  atoms: Atom[];
  positiveMesh: IsosurfaceMesh | null;
  negativeMesh: IsosurfaceMesh | null;
  canvasBg?: string;
  renderSettings: RenderSettings;
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
function SceneLighting({ preset, direction }: { preset: RenderPreset; direction: LightDirection }) {
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

  const ambient = ambientIntensities[preset] ?? 0.4;
  const main = mainIntensities[preset] ?? 0.8;
  const fill = fillIntensities[preset] ?? 0.3;

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
          depthWrite={false}
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

function AtomSphere({ atom, scale }: { atom: Atom; scale: number }) {
  const color = CPK_COLORS[atom.atomicNumber] || '#FF69B4';
  const radius = (DISPLAY_RADII[atom.atomicNumber] || 0.35) * scale;

  return (
    <mesh position={[atom.position.x, atom.position.y, atom.position.z]}>
      <sphereGeometry args={[radius, 24, 24]} />
      <meshStandardMaterial color={color} />
    </mesh>
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

  return (
    <group>
      <mesh geometry={geometry}>
        <SurfaceMaterial
          color={color}
          opacity={isWireOnly ? 1 : settings.opacity}
          preset={settings.preset}
          wireframe={isWireOnly}
        />
      </mesh>
      {isSolidWire && (
        <mesh geometry={geometry}>
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
    } else {
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
    }

    camera.lookAt(target.x, target.y, target.z);
    if (controlsRef.current) {
      controlsRef.current.update();
    }
    onViewApplied();
  }, [viewRequest, atoms, camera, controlsRef, onViewApplied]);

  return null;
}

const VIEW_BUTTONS: { value: ViewAngle; label: string; title: string }[] = [
  { value: 'reset', label: '\u2302', title: 'Reset view' },
  { value: 'top', label: 'T', title: 'Top view' },
  { value: 'ccw', label: '\u21BA', title: 'Rotate CCW 90\u00B0' },
  { value: 'cw', label: '\u21BB', title: 'Rotate CW 90\u00B0' },
];

export function MoleculeViewer({ atoms, positiveMesh, negativeMesh, canvasBg = '#e8eaf0', renderSettings }: Props) {
  const [posColor, negColor] = COLOR_SCHEMES[renderSettings.colorScheme];
  const bg = getPresetBg(renderSettings.preset, canvasBg);
  const [viewRequest, setViewRequest] = useState<ViewAngle | null>(null);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);

  const saveImage = () => {
    const canvas = canvasContainerRef.current?.querySelector('canvas');
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `morbvis_${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  return (
    <CanvasErrorBoundary>
      <div ref={canvasContainerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
        <Canvas
          style={{ width: '100%', height: '100%', background: bg }}
          gl={{ preserveDrawingBuffer: true }}
          camera={{ fov: 50, near: 0.1, far: 100 }}
        >
          <SceneLighting preset={renderSettings.preset} direction={renderSettings.lightDirection} />
          <CameraController
            atoms={atoms}
            viewRequest={viewRequest}
            onViewApplied={() => setViewRequest(null)}
            controlsRef={controlsRef}
          />

          {atoms.map((atom) => (
            <AtomSphere key={atom.index} atom={atom} scale={renderSettings.atomScale} />
          ))}
          <Bonds atoms={atoms} scale={renderSettings.bondScale} />

          {positiveMesh && positiveMesh.vertices.length > 0 && (
            <IsosurfaceObject
              mesh={positiveMesh}
              color={posColor}
              settings={renderSettings}

            />
          )}
          {negativeMesh && negativeMesh.vertices.length > 0 && (
            <IsosurfaceObject
              mesh={negativeMesh}
              color={negColor}
              settings={renderSettings}

            />
          )}

          <OrbitControls ref={controlsRef} enableDamping dampingFactor={0.1} />
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
          <button
            onClick={saveImage}
            title="Save as PNG"
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
            {'\u2B07'}
          </button>
        </div>
      </div>
    </CanvasErrorBoundary>
  );
}
