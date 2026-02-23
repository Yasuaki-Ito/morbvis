import { useRef, useState } from 'react';
import type { Theme } from '../theme';
import type { TFunction } from '../i18n';
import { CPK_COLORS } from './MoleculeViewer';

interface Props {
  atomColors: Record<number, string>;
  onChange: (atomColors: Record<number, string>) => void;
  theme: Theme;
  t: TFunction;
  /** Atomic numbers present in current molecule (highlighted) */
  presentElements?: Set<number>;
}

// Element data: [atomicNumber, symbol, row, col]
const ELEMENTS: [number, string, number, number][] = [
  // Row 1
  [1,'H',0,0],[2,'He',0,17],
  // Row 2
  [3,'Li',1,0],[4,'Be',1,1],[5,'B',1,12],[6,'C',1,13],[7,'N',1,14],[8,'O',1,15],[9,'F',1,16],[10,'Ne',1,17],
  // Row 3
  [11,'Na',2,0],[12,'Mg',2,1],[13,'Al',2,12],[14,'Si',2,13],[15,'P',2,14],[16,'S',2,15],[17,'Cl',2,16],[18,'Ar',2,17],
  // Row 4
  [19,'K',3,0],[20,'Ca',3,1],[21,'Sc',3,2],[22,'Ti',3,3],[23,'V',3,4],[24,'Cr',3,5],[25,'Mn',3,6],
  [26,'Fe',3,7],[27,'Co',3,8],[28,'Ni',3,9],[29,'Cu',3,10],[30,'Zn',3,11],
  [31,'Ga',3,12],[32,'Ge',3,13],[33,'As',3,14],[34,'Se',3,15],[35,'Br',3,16],[36,'Kr',3,17],
  // Row 5
  [37,'Rb',4,0],[38,'Sr',4,1],[39,'Y',4,2],[40,'Zr',4,3],[41,'Nb',4,4],[42,'Mo',4,5],[43,'Tc',4,6],
  [44,'Ru',4,7],[45,'Rh',4,8],[46,'Pd',4,9],[47,'Ag',4,10],[48,'Cd',4,11],
  [49,'In',4,12],[50,'Sn',4,13],[51,'Sb',4,14],[52,'Te',4,15],[53,'I',4,16],[54,'Xe',4,17],
  // Row 6 (partial)
  [55,'Cs',5,0],[56,'Ba',5,1],
  [72,'Hf',5,3],[73,'Ta',5,4],[74,'W',5,5],[75,'Re',5,6],[76,'Os',5,7],[77,'Ir',5,8],
  [78,'Pt',5,9],[79,'Au',5,10],[80,'Hg',5,11],[81,'Tl',5,12],[82,'Pb',5,13],[83,'Bi',5,14],
];

const ROWS = 6;
const COLS = 18;
const CELL = 26;
const GAP = 2;

function getColor(z: number, overrides: Record<number, string>): string {
  return overrides[z] || CPK_COLORS[z] || '#CC80CC';
}

function isLight(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114) > 140;
}

export function PeriodicTable({ atomColors, onChange, theme, t, presentElements }: Props) {
  const [editingZ, setEditingZ] = useState<number | null>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const handleColorChange = (z: number, color: string) => {
    const defaultColor = CPK_COLORS[z];
    const next = { ...atomColors };
    if (color === defaultColor) {
      delete next[z];
    } else {
      next[z] = color;
    }
    onChange(next);
  };

  const handleReset = () => {
    onChange({});
  };

  const gridWidth = COLS * (CELL + GAP) - GAP;
  const gridHeight = ROWS * (CELL + GAP) - GAP;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: theme.textMuted }}>{t('periodic.clickToChange')}</span>
        {Object.keys(atomColors).length > 0 && (
          <button
            onClick={handleReset}
            style={{
              fontSize: 10, padding: '2px 6px', border: `1px solid ${theme.border}`,
              borderRadius: 3, background: 'transparent', color: theme.textMuted, cursor: 'pointer',
            }}
          >
            {t('periodic.resetAll')}
          </button>
        )}
      </div>
      <div style={{
        position: 'relative',
        width: gridWidth,
        height: gridHeight,
        margin: '0 auto',
      }}>
        {ELEMENTS.map(([z, sym, row, col]) => {
          const color = getColor(z, atomColors);
          const present = presentElements?.has(z);
          const isEditing = editingZ === z;
          return (
            <div
              key={z}
              onClick={() => {
                setEditingZ(z);
                // Open color picker after render
                setTimeout(() => colorInputRef.current?.click(), 0);
              }}
              title={`${z} ${sym}${atomColors[z] ? ' (custom)' : ''}`}
              style={{
                position: 'absolute',
                left: col * (CELL + GAP),
                top: row * (CELL + GAP),
                width: CELL,
                height: CELL,
                background: color,
                borderRadius: 3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontSize: 9,
                fontWeight: present ? 700 : 400,
                color: isLight(color) ? '#222' : '#fff',
                border: isEditing
                  ? `2px solid ${theme.accent}`
                  : present
                    ? `2px solid ${theme.text}`
                    : '2px solid transparent',
                opacity: present || !presentElements ? 1 : 0.4,
                lineHeight: 1,
                boxSizing: 'border-box',
              }}
            >
              {sym}
            </div>
          );
        })}
      </div>
      {/* Hidden color input */}
      {editingZ !== null && (
        <input
          ref={colorInputRef}
          type="color"
          value={getColor(editingZ, atomColors)}
          onChange={(e) => handleColorChange(editingZ, e.target.value)}
          onBlur={() => setEditingZ(null)}
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
        />
      )}
    </div>
  );
}
