import type { MolecularOrbital } from '../types';
import type { Theme } from '../theme';

interface Props {
  orbitals: MolecularOrbital[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  compareIndex: number | null;
  onCompareSelect: (index: number | null) => void;
  theme: Theme;
  disabled?: boolean;
}

export function EnergyDiagram({ orbitals, selectedIndex, onSelect, compareIndex, onCompareSelect, theme, disabled }: Props) {
  if (orbitals.length === 0) return null;

  // Find HOMO index
  let homoIndex = -1;
  for (let i = orbitals.length - 1; i >= 0; i--) {
    if (orbitals[i].occupation > 0) { homoIndex = i; break; }
  }

  // Show all orbitals (scrollable)
  const start = 0;
  const visible = orbitals;

  // Energy range for scaling
  const energies = visible.map((o) => o.energy);
  const eMin = Math.min(...energies);
  const eMax = Math.max(...energies);
  const eRange = eMax - eMin || 1;

  const height = 160;
  const barWidth = orbitals.length > 30 ? 12 : 18;
  const gap = orbitals.length > 30 ? 2 : 3;
  const totalWidth = visible.length * (barWidth + gap) - gap;
  const padTop = 14;
  const padBot = 14;
  const plotH = height - padTop - padBot;

  const getLabel = (i: number) => {
    if (i === homoIndex) return 'H';
    if (i === homoIndex + 1) return 'L';
    if (i < homoIndex) return `H-${homoIndex - i}`;
    return `L+${i - homoIndex - 1}`;
  };

  return (
    <div>
      <div style={{
        overflowX: 'auto',
        background: theme.accentBg,
        borderRadius: 6,
        border: `1px solid ${theme.sidebarBorder}`,
        padding: '8px 12px',
      }}>
        <svg
          width={Math.max(totalWidth, 100)}
          height={height}
          style={{ display: 'block', margin: '0 auto' }}
        >
          {/* HOMO-LUMO gap line + label */}
          {homoIndex >= 0 && homoIndex < orbitals.length - 1 && (() => {
            const hE = orbitals[homoIndex].energy;
            const lE = orbitals[homoIndex + 1].energy;
            const gapEv = (lE - hE) * 27.2114;
            const midE = (hE + lE) / 2;
            const y = padTop + plotH - ((midE - eMin) / eRange) * plotH;
            return (
              <>
                <line
                  x1={0} x2={totalWidth}
                  y1={y} y2={y}
                  stroke={theme.textMuted}
                  strokeDasharray="3 3"
                  strokeWidth={0.5}
                />
                <text
                  x={totalWidth - 2} y={y - 3}
                  textAnchor="end"
                  fontSize={7}
                  fill={theme.textMuted}
                >
                  {`\u0394=${gapEv.toFixed(2)} eV`}
                </text>
              </>
            );
          })()}

          {visible.map((mo, vi) => {
            const globalIdx = start + vi;
            const x = vi * (barWidth + gap);
            const y = padTop + plotH - ((mo.energy - eMin) / eRange) * plotH;
            const isOccupied = mo.occupation > 0;
            const isSelected = globalIdx === selectedIndex;
            const isCompare = globalIdx === compareIndex;
            const color = isSelected
              ? theme.accent
              : isCompare
                ? '#f59e0b'
                : isOccupied
                  ? (theme.moOccupied || '#16a34a')
                  : (theme.moVirtual || '#999');

            return (
              <g
                key={globalIdx}
                onClick={(e) => {
                  if (disabled) return;
                  if (e.shiftKey) {
                    onCompareSelect(globalIdx === compareIndex ? null : globalIdx);
                  } else {
                    onSelect(globalIdx);
                  }
                }}
                style={{ cursor: disabled ? 'default' : 'pointer' }}
              >
                <title>{`${getLabel(globalIdx)}: ${mo.energy.toFixed(4)} Ha (${(mo.energy * 27.2114).toFixed(2)} eV)${isCompare ? ' [Compare]' : ''}`}</title>
                {/* Full-column hit area */}
                <rect
                  x={x} y={0}
                  width={barWidth} height={height}
                  fill="transparent"
                />
                {/* Energy bar (horizontal line) */}
                <line
                  x1={x + 2} x2={x + barWidth - 2}
                  y1={y} y2={y}
                  stroke={color}
                  strokeWidth={isSelected || isCompare ? 3 : 2}
                  strokeLinecap="round"
                />
                {/* Selection highlight */}
                {isSelected && (
                  <rect
                    x={x} y={y - 6}
                    width={barWidth} height={12}
                    fill={theme.accent}
                    opacity={0.15}
                    rx={3}
                  />
                )}
                {/* Compare highlight */}
                {isCompare && (
                  <rect
                    x={x} y={y - 6}
                    width={barWidth} height={12}
                    fill="#f59e0b"
                    opacity={0.15}
                    rx={3}
                  />
                )}
                {/* Label */}
                <text
                  x={x + barWidth / 2} y={height - 2}
                  textAnchor="middle"
                  fontSize={8}
                  fill={isSelected ? theme.accent : isCompare ? '#f59e0b' : theme.textMuted}
                  fontWeight={isSelected || isCompare ? 700 : 400}
                >
                  {getLabel(globalIdx)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
