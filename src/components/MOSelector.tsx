import { useState, useRef, useEffect } from 'react';
import type { MolecularOrbital } from '../types';
import type { Theme } from '../theme';

interface Props {
  orbitals: MolecularOrbital[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  theme: Theme;
  disabled?: boolean;
}

export function MOSelector({ orbitals, selectedIndex, onSelect, theme, disabled }: Props) {
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

  return (
    <div>
      <div style={{ fontSize: 13, color: theme.text, fontWeight: 600, marginBottom: 6 }}>
        Molecular Orbital
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'stretch' }}>
        {/* Prev button */}
        <button
          onClick={() => canPrev && !disabled && onSelect(selectedIndex - 1)}
          disabled={disabled || !canPrev}
          title="Previous orbital"
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
          title="Next orbital"
          style={navBtnStyle(canNext && !disabled)}
        >
          {'\u25B6'}
        </button>
      </div>
    </div>
  );
}
