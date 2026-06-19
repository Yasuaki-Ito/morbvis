import { useMemo } from 'react';
import type { Theme } from '../theme';
import type { TFunction } from '../i18n';
import type { AOLabel } from '../core/aoLabels';

interface Props {
  /** AO labels (length = number of basis functions). */
  labels: AOLabel[];
  /** MO coefficients for the currently selected MO (same length as labels). */
  coefficients: number[];
  /** Index of the AO currently overlaid as wireframe (null = none). */
  overlayAOIndex: number | null;
  onOverlayChange: (basisIndex: number | null) => void;
  /** Cumulative top-K mode: null = full MO, integer = use only top-K AOs. */
  cumulativeK: number | null;
  onCumulativeChange: (k: number | null) => void;
  /** Threshold for filtering AOs in the bar chart by |coefficient|. */
  showThreshold: number;
  onShowThresholdChange: (v: number) => void;
  theme: Theme;
  t: TFunction;
}

/** Color for positive / negative coefficient bars. */
const POS_COLOR = '#4488ff';
const NEG_COLOR = '#ff4444';

export function AODecomposition({
  labels, coefficients,
  overlayAOIndex, onOverlayChange,
  cumulativeK, onCumulativeChange,
  showThreshold, onShowThresholdChange,
  theme, t,
}: Props) {
  // Sort by |coefficient| descending
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

  const cumulativeActive = cumulativeK !== null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Cumulative slider */}
      <div style={{
        padding: '6px 8px',
        background: theme.accentBg,
        border: `1px solid ${theme.sidebarBorder}`,
        borderRadius: 4,
      }}>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 12, color: theme.text, cursor: 'pointer',
          marginBottom: cumulativeActive ? 6 : 0,
        }}>
          <input
            type="checkbox"
            checked={cumulativeActive}
            onChange={(e) => onCumulativeChange(e.target.checked ? sorted.length : null)}
          />
          {t('ao.cumulative')}
        </label>
        {cumulativeActive && (
          <>
            <input
              type="range"
              min={1}
              max={sorted.length}
              step={1}
              value={cumulativeK ?? sorted.length}
              onChange={(e) => onCumulativeChange(parseInt(e.target.value, 10))}
              style={{ width: '100%', accentColor: theme.accent }}
            />
            <div style={{ fontSize: 11, color: theme.textSecondary, textAlign: 'center', marginTop: 2 }}>
              {t('ao.topK').replace('{k}', String(cumulativeK ?? sorted.length)).replace('{n}', String(sorted.length))}
            </div>
          </>
        )}
      </div>

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

      {/* AO coefficient bars */}
      <div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          fontSize: 12, color: theme.textSecondary, fontWeight: 500, marginBottom: 4,
        }}>
          <span>{t('ao.coefficients')}</span>
          <span style={{ fontSize: 10 }}>
            {visible.length} / {sorted.length}
          </span>
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
            const selected = overlayAOIndex === label.basisIndex;
            const rel = maxAbs > 0 ? Math.abs(coef) / maxAbs : 0;
            const color = coef >= 0 ? POS_COLOR : NEG_COLOR;
            return (
              <button
                key={label.basisIndex}
                onClick={() => onOverlayChange(selected ? null : label.basisIndex)}
                title={`${label.fullLabel}: ${coef.toFixed(4)}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '60px 1fr 56px',
                  alignItems: 'center', gap: 6,
                  padding: '3px 6px',
                  background: selected ? theme.accent : 'transparent',
                  color: selected ? '#fff' : theme.text,
                  border: 'none', borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 11,
                  textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {label.fullLabel}
                </span>
                <span style={{
                  position: 'relative',
                  height: 10,
                  background: selected ? 'rgba(255,255,255,0.2)' : theme.sidebarBorder,
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
                    background: selected ? 'rgba(255,255,255,0.6)' : theme.text,
                    opacity: 0.5,
                  }} />
                </span>
                <span style={{
                  textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                  color: selected ? '#fff' : (coef >= 0 ? POS_COLOR : NEG_COLOR),
                  fontWeight: 600,
                }}>
                  {coef >= 0 ? '+' : ''}{coef.toFixed(3)}
                </span>
              </button>
            );
          })}
          {visible.length === 0 && (
            <div style={{ fontSize: 11, color: theme.textMuted, padding: 8, textAlign: 'center' }}>
              {t('ao.noneVisible')}
            </div>
          )}
        </div>
        {overlayAOIndex !== null && (
          <button
            onClick={() => onOverlayChange(null)}
            style={{
              marginTop: 6,
              padding: '3px 8px', fontSize: 11,
              background: 'transparent',
              border: `1px solid ${theme.sidebarBorder}`,
              color: theme.textSecondary,
              borderRadius: 3, cursor: 'pointer',
              width: '100%',
            }}
          >
            {t('ao.clearOverlay')}
          </button>
        )}
      </div>
    </div>
  );
}
