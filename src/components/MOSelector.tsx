import { useState, useRef, useEffect } from 'react';
import type { MolecularOrbital } from '../types';
import type { Theme } from '../theme';
import type { TFunction } from '../i18n';

interface Props {
  orbitals: MolecularOrbital[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  compareIndex: number | null;
  onCompareSelect: (index: number | null) => void;
  theme: Theme;
  disabled?: boolean;
  t: TFunction;
  viewMode?: 'mo' | 'density';
  onViewModeChange?: (mode: 'mo' | 'density') => void;
  densityComputing?: boolean;
  hasDensityCache?: boolean;
  gpuAvailable?: boolean;
  useGPU?: boolean;
  onToggleGPU?: () => void;
}

export function MOSelector({ orbitals, selectedIndex, onSelect, compareIndex, onCompareSelect, theme, disabled, t, viewMode = 'mo', onViewModeChange, densityComputing, hasDensityCache, gpuAvailable, useGPU, onToggleGPU }: Props) {
  if (orbitals.length === 0) return null;

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  let homoIndex = -1;
  for (let i = orbitals.length - 1; i >= 0; i--) {
    if (orbitals[i].occupation > 0) {
      homoIndex = i;
      break;
    }
  }

  const getLabel = (i: number) => {
    if (i === homoIndex) return 'HOMO';
    if (i === homoIndex + 1) return 'LUMO';
    if (i < homoIndex) return `HOMO-${homoIndex - i}`;
    return `LUMO+${i - homoIndex - 1}`;
  };

  const formatItem = (i: number, mo: MolecularOrbital) =>
    `${getLabel(i).padEnd(8)} ${mo.energy.toFixed(4)} Ha  occ=${mo.occupation}`;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Scroll to selected item when opened
  useEffect(() => {
    if (open && listRef.current) {
      const item = listRef.current.children[selectedIndex] as HTMLElement | undefined;
      if (item) item.scrollIntoView({ block: 'nearest' });
    }
  }, [open, selectedIndex]);

  const canPrev = selectedIndex > 0;
  const canNext = selectedIndex < orbitals.length - 1;

  const navBtnStyle = (enabled: boolean): React.CSSProperties => ({
    padding: '6px 10px',
    border: `1px solid ${theme.border}`,
    background: theme.inputBg,
    color: enabled ? theme.text : theme.textMuted,
    fontSize: 14,
    fontWeight: 700,
    cursor: enabled ? 'pointer' : 'default',
    borderRadius: 4,
    opacity: enabled ? 1 : 0.35,
    lineHeight: 1,
  });

  const isDensity = viewMode === 'density';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ fontSize: 13, color: theme.text, fontWeight: 600 }}>
            {isDensity ? t('density.tab') : t('mo.title')}
          </div>
          {onToggleGPU && (
            <button
              onClick={onToggleGPU}
              disabled={!gpuAvailable}
              title={gpuAvailable ? (useGPU ? 'GPU compute ON' : 'GPU compute OFF (using CPU)') : 'WebGPU not available'}
              style={{
                padding: '1px 6px',
                fontSize: 9,
                fontWeight: 600,
                background: useGPU && gpuAvailable ? '#ff9800' : theme.accentBg,
                color: useGPU && gpuAvailable ? '#fff' : theme.textSecondary,
                border: `1px solid ${useGPU && gpuAvailable ? '#ff9800' : theme.border}`,
                borderRadius: 3,
                cursor: gpuAvailable ? 'pointer' : 'default',
                opacity: gpuAvailable ? 1 : 0.4,
                lineHeight: 1.4,
                whiteSpace: 'nowrap',
              }}
            >
              {'\u26A1'}GPU
            </button>
          )}
        </div>
        {onViewModeChange && (
          <div style={{ display: 'flex', gap: 2 }}>
            {(['mo', 'density'] as const).map((mode) => {
              const active = viewMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => onViewModeChange(mode)}
                  disabled={disabled || (mode === 'density' && densityComputing)}
                  style={{
                    padding: '2px 8px',
                    fontSize: 10,
                    fontWeight: active ? 600 : 400,
                    background: active ? theme.accent : theme.accentBg,
                    color: active ? '#fff' : theme.textSecondary,
                    border: `1px solid ${active ? theme.accent : theme.border}`,
                    borderRadius: 3,
                    cursor: disabled ? 'default' : 'pointer',
                    opacity: disabled ? 0.5 : 1,
                  }}
                >
                  {mode === 'mo' ? t('mo.tab') : t('density.tab')}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {isDensity ? (
        <div style={{ fontSize: 12, color: theme.textSecondary, textAlign: 'center', padding: '8px 0' }}>
          {densityComputing
            ? t('density.computing')
            : hasDensityCache
              ? t('density.tab')
              : t('density.compute')
          }
        </div>
      ) : (
      <>
      <div style={{ display: 'flex', gap: 4, alignItems: 'stretch' }}>
        {/* Prev button */}
        <button
          onClick={() => canPrev && !disabled && onSelect(selectedIndex - 1)}
          disabled={disabled || !canPrev}
          title={t('mo.previous')}
          style={navBtnStyle(canPrev && !disabled)}
        >
          {'\u25C0'}
        </button>

        <div ref={containerRef} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          {/* Selected item display button */}
          <button
            onClick={() => !disabled && setOpen(!open)}
            disabled={disabled}
            style={{
              width: '100%',
              height: '100%',
              padding: '6px 8px',
              borderRadius: 4,
              border: `1px solid ${theme.border}`,
              background: theme.inputBg,
              color: theme.text,
              fontSize: 13,
              fontFamily: 'monospace',
              cursor: disabled ? 'default' : 'pointer',
              textAlign: 'left',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>{getLabel(selectedIndex)}</span>
              <span style={{ fontSize: 11, color: theme.text }}>
                {orbitals[selectedIndex].energy.toFixed(4)} Ha  occ={orbitals[selectedIndex].occupation}
              </span>
            </span>
            <span style={{ fontSize: 10, marginLeft: 4, flexShrink: 0 }}>{open ? '\u25B2' : '\u25BC'}</span>
          </button>

        {/* Dropdown list */}
        {open && (
          <div
            ref={listRef}
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              maxHeight: 220,
              overflowY: 'auto',
              border: `1px solid ${theme.border}`,
              borderRadius: 4,
              background: theme.inputBg,
              zIndex: 100,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            }}
          >
            {orbitals.map((mo, i) => {
              const active = i === selectedIndex;
              return (
                <div
                  key={i}
                  onClick={() => { onSelect(i); setOpen(false); }}
                  style={{
                    padding: '5px 8px',
                    fontSize: 12,
                    fontFamily: 'monospace',
                    cursor: 'pointer',
                    background: active ? theme.accent : 'transparent',
                    color: active ? '#fff' : theme.text,
                    fontWeight: active ? 600 : 400,
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.background = theme.accentBg;
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  {formatItem(i, mo)}
                </div>
              );
            })}
          </div>
        )}
        </div>

        {/* Next button */}
        <button
          onClick={() => canNext && !disabled && onSelect(selectedIndex + 1)}
          disabled={disabled || !canNext}
          title={t('mo.next')}
          style={navBtnStyle(canNext && !disabled)}
        >
          {'\u25B6'}
        </button>
      </div>

      {/* Compare MO */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <label style={{ fontSize: 11, color: theme.textSecondary, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <input
            type="checkbox"
            checked={compareIndex !== null}
            disabled={disabled}
            onChange={(e) => {
              if (e.target.checked) {
                onCompareSelect(selectedIndex > 0 ? selectedIndex - 1 : Math.min(1, orbitals.length - 1));
              } else {
                onCompareSelect(null);
              }
            }}
          />
          {t('mo.compare')}
        </label>
        {compareIndex !== null && (
          <select
            value={compareIndex}
            disabled={disabled}
            onChange={(e) => onCompareSelect(parseInt(e.target.value))}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 11,
              fontFamily: 'monospace',
              padding: '2px 4px',
              borderRadius: 4,
              border: `1px solid ${theme.border}`,
              background: theme.inputBg,
              color: theme.text,
            }}
          >
            {orbitals.map((mo, i) => (
              <option key={i} value={i}>
                {getLabel(i)} {mo.energy.toFixed(4)} Ha
              </option>
            ))}
          </select>
        )}
      </div>
      </>
      )}
    </div>
  );
}
