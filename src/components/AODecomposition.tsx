import { useMemo, type CSSProperties } from 'react';
import type { Theme } from '../theme';
import type { TFunction } from '../i18n';
import type { AOLabel } from '../core/aoLabels';

interface Props {
  /** AO labels (length = number of basis functions). */
  labels: AOLabel[];
  /** MO coefficients for the currently selected MO (same length as labels). */
  coefficients: number[];
  /**
   * Set of basis indices included in the partial sum.
   * Empty or full = displays full MO; intermediate = displays partial sum.
   */
  selectedAOIndices: Set<number>;
  onSelectionChange: (s: Set<number>) => void;
  /** Whether the MO mesh is shown as wireframe outline when partial sum is displayed. */
  showMOMesh: boolean;
  onShowMOMeshChange: (v: boolean) => void;
  /** Threshold for filtering AOs in the bar chart by |coefficient|. */
  showThreshold: number;
  onShowThresholdChange: (v: number) => void;
  /**
   * Display mode:
   *  - 'weighted': partial sum uses MO coefficients (Σ C_μ χ_μ) — the true LCAO.
   *  - 'raw':      partial sum treats every selected AO with unit weight (Σ χ_μ) — pure AO shape,
   *                useful when a coefficient is too small to reach the isovalue.
   */
  displayMode: 'weighted' | 'raw';
  onDisplayModeChange: (m: 'weighted' | 'raw') => void;
  theme: Theme;
  t: TFunction;
}

const POS_COLOR = '#4488ff';
const NEG_COLOR = '#ff4444';

const TOP_PRESETS = [1, 3, 5, 10];

export function AODecomposition({
  labels, coefficients,
  selectedAOIndices, onSelectionChange,
  showMOMesh, onShowMOMeshChange,
  showThreshold, onShowThresholdChange,
  displayMode, onDisplayModeChange,
  theme, t,
}: Props) {
  // Sorted by |coefficient| descending — used for both display and "Top-N" presets
  const sorted = useMemo(() => {
    const items = labels.map((l) => ({
      label: l,
      coef: coefficients[l.basisIndex] ?? 0,
    }));
    items.sort((a, b) => Math.abs(b.coef) - Math.abs(a.coef));
    return items;
  }, [labels, coefficients]);

  const maxAbs = useMemo(() => {
    let m = 0;
    for (const c of coefficients) {
      const a = Math.abs(c);
      if (a > m) m = a;
    }
    return m;
  }, [coefficients]);

  // Atom contributions: sum |C_μ|² per atom
  const atomContributions = useMemo(() => {
    const totals: Map<number, { symbol: string; w: number }> = new Map();
    let sum = 0;
    for (const { label, coef } of sorted) {
      const w = coef * coef;
      sum += w;
      const cur = totals.get(label.atomIndex);
      if (cur) cur.w += w;
      else totals.set(label.atomIndex, { symbol: label.atomSymbol, w });
    }
    const arr = Array.from(totals.entries()).map(([idx, v]) => ({
      atomIndex: idx,
      symbol: v.symbol,
      weight: sum > 0 ? v.w / sum : 0,
    }));
    arr.sort((a, b) => b.weight - a.weight);
    return arr;
  }, [sorted]);

  const visible = useMemo(
    () => sorted.filter((s) => Math.abs(s.coef) >= showThreshold),
    [sorted, showThreshold],
  );

  // In weighted mode: full selection = full MO, so partial sum is inactive.
  // In raw mode:      full selection = Σ χ_μ (≠ full MO), so partial sum is still active.
  const partialSumActive =
    displayMode === 'raw'
      ? selectedAOIndices.size > 0
      : selectedAOIndices.size > 0 && selectedAOIndices.size < sorted.length;

  const toggleAO = (basisIndex: number) => {
    const next = new Set(selectedAOIndices);
    if (next.has(basisIndex)) next.delete(basisIndex);
    else next.add(basisIndex);
    onSelectionChange(next);
  };

  const selectTopN = (n: number) => {
    const next = new Set<number>();
    for (let i = 0; i < Math.min(n, sorted.length); i++) {
      next.add(sorted[i].label.basisIndex);
    }
    onSelectionChange(next);
  };

  const selectedCount = selectedAOIndices.size;
  const total = sorted.length;

  const modeButtonStyle = (active: boolean): CSSProperties => ({
    flex: 1,
    padding: '4px 6px',
    fontSize: 11,
    background: active ? theme.accent : theme.accentBg,
    color: active ? '#fff' : theme.text,
    border: `1px solid ${active ? theme.accent : theme.sidebarBorder}`,
    borderRadius: 3,
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Display mode selector */}
      <div>
        <div style={{ fontSize: 12, color: theme.textSecondary, fontWeight: 500, marginBottom: 4 }}>
          {t('ao.mode')}
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          <button
            onClick={() => onDisplayModeChange('weighted')}
            style={modeButtonStyle(displayMode === 'weighted')}
            title={t('ao.modeWeightedDesc')}
          >
            {t('ao.modeWeighted')}
          </button>
          <button
            onClick={() => onDisplayModeChange('raw')}
            style={modeButtonStyle(displayMode === 'raw')}
            title={t('ao.modeRawDesc')}
          >
            {t('ao.modeRaw')}
          </button>
        </div>
      </div>

      {/* Preset selection buttons */}
      <div>
        <div style={{ fontSize: 12, color: theme.textSecondary, fontWeight: 500, marginBottom: 4 }}>
          {t('ao.selection')}
        </div>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {TOP_PRESETS.filter((n) => n < total).map((n) => (
            <button
              key={`top-${n}`}
              onClick={() => selectTopN(n)}
              style={{
                flex: 1, minWidth: 0,
                padding: '4px 6px',
                fontSize: 11,
                background: theme.accentBg,
                color: theme.text,
                border: `1px solid ${theme.sidebarBorder}`,
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              {`Top ${n}`}
            </button>
          ))}
          <button
            onClick={() => selectTopN(total)}
            style={{
              flex: 1, minWidth: 0,
              padding: '4px 6px',
              fontSize: 11,
              background: theme.accentBg,
              color: theme.text,
              border: `1px solid ${theme.sidebarBorder}`,
              borderRadius: 3,
              cursor: 'pointer',
            }}
          >
            {t('ao.presetAll')}
          </button>
          <button
            onClick={() => onSelectionChange(new Set())}
            style={{
              flex: 1, minWidth: 0,
              padding: '4px 6px',
              fontSize: 11,
              background: theme.accentBg,
              color: theme.text,
              border: `1px solid ${theme.sidebarBorder}`,
              borderRadius: 3,
              cursor: 'pointer',
            }}
          >
            {t('ao.presetNone')}
          </button>
        </div>
        <div style={{ fontSize: 11, color: theme.textSecondary, marginTop: 4, textAlign: 'center' }}>
          {t('ao.selectedCount').replace('{n}', String(selectedCount)).replace('{total}', String(total))}
          {selectedCount === 0 && ` — ${t('ao.fullMO')}`}
          {selectedCount === total && total > 0 && displayMode === 'weighted' && ` — ${t('ao.fullMO')}`}
        </div>
      </div>

      {/* MO mesh toggle — visible only when partial sum is active */}
      {partialSumActive && (
        <label style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 12, color: theme.text, cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={showMOMesh}
            onChange={(e) => onShowMOMeshChange(e.target.checked)}
          />
          {t('ao.showMO')}
        </label>
      )}

      {/* Atom contributions */}
      {atomContributions.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: theme.textSecondary, fontWeight: 500, marginBottom: 4 }}>
            {t('ao.atomContributions')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {atomContributions.slice(0, 6).map((c) => (
              <div key={c.atomIndex} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <div style={{ width: 36, color: theme.text }}>{c.symbol}{c.atomIndex}</div>
                <div style={{ flex: 1, height: 8, background: theme.sidebarBorder, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    width: `${(c.weight * 100).toFixed(1)}%`,
                    height: '100%',
                    background: theme.accent,
                  }} />
                </div>
                <div style={{ width: 40, textAlign: 'right', color: theme.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                  {(c.weight * 100).toFixed(1)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Threshold filter */}
      <div>
        <div style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 2 }}>
          {t('ao.filter')}: |C| ≥ {showThreshold.toFixed(2)}
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(0.5, maxAbs)}
          step={0.01}
          value={showThreshold}
          onChange={(e) => onShowThresholdChange(parseFloat(e.target.value))}
          style={{ width: '100%', accentColor: theme.accent }}
        />
      </div>

      {/* AO coefficient list with checkboxes */}
      <div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          fontSize: 12, color: theme.textSecondary, fontWeight: 500, marginBottom: 4,
        }}>
          <span>{t('ao.coefficients')}</span>
          <span style={{ fontSize: 10 }}>{visible.length} / {sorted.length}</span>
        </div>
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 2,
          maxHeight: 320, overflowY: 'auto', overflowX: 'hidden',
          padding: 2,
          background: theme.accentBg,
          border: `1px solid ${theme.sidebarBorder}`,
          borderRadius: 4,
        }}>
          {visible.map(({ label, coef }) => {
            const checked = selectedAOIndices.has(label.basisIndex);
            const rel = maxAbs > 0 ? Math.abs(coef) / maxAbs : 0;
            const color = coef >= 0 ? POS_COLOR : NEG_COLOR;
            return (
              <label
                key={label.basisIndex}
                title={`${label.fullLabel}: ${coef.toFixed(4)}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '16px 60px 1fr 56px',
                  alignItems: 'center', gap: 6,
                  padding: '3px 6px',
                  background: checked ? 'rgba(255,200,0,0.18)' : 'transparent',
                  color: theme.text,
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 11,
                  fontFamily: 'inherit',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleAO(label.basisIndex)}
                  style={{ margin: 0 }}
                />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {label.fullLabel}
                </span>
                <span style={{
                  position: 'relative',
                  height: 10,
                  background: theme.sidebarBorder,
                  borderRadius: 2,
                  overflow: 'hidden',
                }}>
                  <span style={{
                    position: 'absolute',
                    left: coef >= 0 ? '50%' : `${50 - rel * 50}%`,
                    width: `${rel * 50}%`,
                    top: 0, bottom: 0,
                    background: color,
                  }} />
                  <span style={{
                    position: 'absolute',
                    left: '50%', top: 0, bottom: 0, width: 1,
                    background: theme.text,
                    opacity: 0.5,
                  }} />
                </span>
                <span style={{
                  textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                  color: coef >= 0 ? POS_COLOR : NEG_COLOR,
                  fontWeight: 600,
                }}>
                  {coef >= 0 ? '+' : ''}{coef.toFixed(3)}
                </span>
              </label>
            );
          })}
          {visible.length === 0 && (
            <div style={{ fontSize: 11, color: theme.textMuted, padding: 8, textAlign: 'center' }}>
              {t('ao.noneVisible')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
