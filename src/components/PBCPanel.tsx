import type { CSSProperties } from 'react';
import type { KMolecularOrbital, PBCInfo } from '../types';
import type { Theme } from '../theme';
import type { TFunction } from '../i18n';
import { cellVolume } from '../core/lattice';

interface Props {
  pbc: PBCInfo;
  kOrbitals: KMolecularOrbital[];
  /** Index into kOrbitals of the selected crystal orbital; null = standard MO list */
  selectedKMO: number | null;
  onSelectKMO: (index: number | null) => void;
  repeats: [number, number, number];
  onRepeatsChange: (repeats: [number, number, number]) => void;
  showCell: boolean;
  onShowCellChange: (show: boolean) => void;
  showBoundaryAtoms: boolean;
  onShowBoundaryAtomsChange: (show: boolean) => void;
  theme: Theme;
  t: TFunction;
  disabled?: boolean;
}

const vecLen = (v: { x: number; y: number; z: number }) =>
  Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

export function PBCPanel({
  pbc, kOrbitals, selectedKMO, onSelectKMO, repeats, onRepeatsChange,
  showCell, onShowCellChange, showBoundaryAtoms, onShowBoundaryAtomsChange,
  theme, t, disabled,
}: Props) {
  const { cell } = pbc;
  const lengths = [vecLen(cell.a1), vecLen(cell.a2), vecLen(cell.a3)];
  const volume = cellVolume(cell);

  // Group crystal orbitals by k-point index
  const kIndices = Array.from(new Set(kOrbitals.map((o) => o.kIndex))).sort((a, b) => a - b);
  const currentK = selectedKMO !== null && kOrbitals[selectedKMO]
    ? kOrbitals[selectedKMO].kIndex
    : (kIndices[0] ?? null);
  const kpointOf = (idx: number) => pbc.kpoints.find((p) => p.index === idx);

  const selectStyle: CSSProperties = {
    background: theme.accentBg,
    color: theme.text,
    border: `1px solid ${theme.sidebarBorder}`,
    borderRadius: 4,
    padding: '2px 4px',
    fontSize: 12,
    cursor: disabled ? 'default' : 'pointer',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: theme.text }}>
      {/* Lattice summary */}
      <div style={{ color: theme.textSecondary, lineHeight: 1.5 }}>
        <div>
          |a|={lengths[0].toFixed(3)} |b|={lengths[1].toFixed(3)} |c|={lengths[2].toFixed(3)} Å
        </div>
        <div>
          {t('pbc.volume')}: {volume.toFixed(2)} Å³
          {'  '}({pbc.periodic.map((p) => (p ? 'T' : 'F')).join(' ')})
        </div>
      </div>

      {/* Supercell repeats */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: theme.textSecondary }}>{t('pbc.repeats')}</span>
        {[0, 1, 2].map((d) => (
          <select
            key={d}
            value={repeats[d]}
            disabled={disabled}
            onChange={(e) => {
              const next: [number, number, number] = [...repeats];
              next[d] = parseInt(e.target.value, 10);
              onRepeatsChange(next);
            }}
            style={selectStyle}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        ))}
      </div>

      {/* Cell wireframe toggle */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: theme.textSecondary }}>
        <input
          type="checkbox"
          checked={showCell}
          onChange={(e) => onShowCellChange(e.target.checked)}
          style={{ accentColor: theme.accent }}
        />
        {t('pbc.showCell')}
      </label>

      {/* Boundary-atom duplication toggle */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: theme.textSecondary }}>
        <input
          type="checkbox"
          checked={showBoundaryAtoms}
          onChange={(e) => onShowBoundaryAtomsChange(e.target.checked)}
          style={{ accentColor: theme.accent }}
        />
        {t('pbc.boundaryAtoms')}
      </label>

      {/* Crystal orbitals at general k-points */}
      {kOrbitals.length > 0 && kIndices.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontWeight: 600, color: theme.text }}>{t('pbc.kOrbitals')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: theme.textSecondary }}>{t('pbc.kpoint')}</span>
            <select
              value={currentK ?? ''}
              disabled={disabled}
              onChange={(e) => {
                const kIdx = parseInt(e.target.value, 10);
                // Select the first orbital of the chosen k-point
                const first = kOrbitals.findIndex((o) => o.kIndex === kIdx);
                onSelectKMO(first >= 0 ? first : null);
              }}
              style={{ ...selectStyle, flex: 1 }}
            >
              {kIndices.map((idx) => {
                const kp = kpointOf(idx);
                const label = kp
                  ? `#${idx}  (${kp.k.map((v) => v.toFixed(3)).join(', ')})`
                  : `#${idx}`;
                return <option key={idx} value={idx}>{label}</option>;
              })}
            </select>
          </div>
          <div style={{
            maxHeight: 140,
            overflowY: 'auto',
            border: `1px solid ${theme.sidebarBorder}`,
            borderRadius: 4,
          }}>
            {kOrbitals.map((o, i) => {
              if (o.kIndex !== currentK) return null;
              const isSelected = selectedKMO === i;
              return (
                <div
                  key={i}
                  onClick={() => { if (!disabled) onSelectKMO(isSelected ? null : i); }}
                  style={{
                    padding: '3px 6px',
                    cursor: disabled ? 'default' : 'pointer',
                    background: isSelected ? theme.accent : 'transparent',
                    color: isSelected ? '#fff' : theme.text,
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 6,
                    fontSize: 11,
                  }}
                >
                  <span>{o.symmetry || `KMO ${i + 1}`} ({o.spin})</span>
                  <span style={{ opacity: 0.85 }}>
                    {o.energy.toFixed(4)} Ha / occ {o.occupation.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
          {selectedKMO !== null && (
            <div style={{ fontSize: 10, color: theme.textMuted, lineHeight: 1.4 }}>
              {t('pbc.phaseHint')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
