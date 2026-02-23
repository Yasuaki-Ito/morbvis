import { useRef, useState } from 'react';
import type { Theme } from '../theme';
import type { RenderSettings, SurfaceMode, ColorScheme, RenderPreset, LightDirection } from '../types';
import type { TFunction } from '../i18n';
import type { CrossSectionState } from './MoleculeViewer';

interface Props {
  isovalue: number;
  onIsovalueChange: (value: number) => void;
  gridPoints: number;
  onGridPointsChange: (value: number) => void;
  computing: boolean;
  theme: Theme;
  renderSettings: RenderSettings;
  onRenderSettingsChange: (settings: RenderSettings) => void;
  hideComputation?: boolean;
  onShowAtomColors?: () => void;
  t: TFunction;
  viewMode?: 'mo' | 'density';
  crossSection?: CrossSectionState;
  onCrossSectionChange?: (cs: CrossSectionState) => void;
  hqMode?: boolean;
  onHqModeChange?: (enabled: boolean) => void;
}

const SURFACE_MODES: { value: SurfaceMode; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'wireframe', label: 'Wire' },
  { value: 'solid+wire', label: 'S+W' },
];

const COLOR_SCHEMES: { value: ColorScheme; colors: [string, string]; label: string }[] = [
  { value: 'classic', colors: ['#4488ff', '#ff4444'], label: 'Classic' },
  { value: 'teal-orange', colors: ['#00bcd4', '#ff9800'], label: 'Teal' },
  { value: 'green-purple', colors: ['#4caf50', '#9c27b0'], label: 'Green' },
  { value: 'mono', colors: ['#ffffff', '#888888'], label: 'Mono' },
];

const PRESETS: { value: RenderPreset; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'matte', label: 'Matte' },
  { value: 'glossy', label: 'Glossy' },
  { value: 'glass', label: 'Glass' },
  { value: 'toon', label: 'Toon' },
  { value: 'minimal-white', label: 'Minimal' },
];

const LIGHT_DIRECTIONS: { value: LightDirection; label: string }[] = [
  { value: 'default', label: 'Auto' },
  { value: 'front', label: 'Front' },
  { value: 'top', label: 'Top' },
  { value: 'side', label: 'Side' },
  { value: 'back', label: 'Back' },
];

export function CollapsibleSection({
  title,
  defaultOpen = false,
  theme,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  theme: Theme;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 600,
          color: theme.text,
          padding: '4px 0',
          userSelect: 'none',
        }}
      >
        <span style={{
          fontSize: 10,
          display: 'inline-block',
          transition: 'transform 0.15s',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
        }}>
          {'\u25B6'}
        </span>
        {title}
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  theme,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  theme: Theme;
}) {
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              flex: 1,
              padding: '4px 6px',
              fontSize: 11,
              fontWeight: active ? 600 : 400,
              background: active ? theme.accent : theme.accentBg,
              color: active ? '#fff' : theme.textSecondary,
              border: `1px solid ${active ? theme.accent : theme.sidebarBorder}`,
              borderRadius: 4,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function CustomColorButton({ active, colors, onSelect, onChangePos, onChangeNeg, theme }: {
  active: boolean;
  colors: [string, string];
  onSelect: () => void;
  onChangePos: (c: string) => void;
  onChangeNeg: (c: string) => void;
  theme: Theme;
}) {
  const posRef = useRef<HTMLInputElement>(null);
  const negRef = useRef<HTMLInputElement>(null);

  const dotStyle: React.CSSProperties = {
    width: 10, height: 10, borderRadius: '50%',
    border: '1px solid rgba(0,0,0,0.2)',
    flexShrink: 0,
  };

  return (
    <div
      title="Custom"
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'stretch',
        border: `1px solid ${active ? theme.accent : theme.sidebarBorder}`,
        borderRadius: 4,
        overflow: 'hidden',
        background: active ? theme.accent : theme.accentBg,
      }}
    >
      {/* Hidden color inputs */}
      <input ref={posRef} type="color" value={colors[0]}
        onChange={(e) => onChangePos(e.target.value)}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
      />
      <input ref={negRef} type="color" value={colors[1]}
        onChange={(e) => onChangeNeg(e.target.value)}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
      />
      {/* Left: positive color */}
      <button
        onClick={() => { onSelect(); posRef.current?.click(); }}
        style={{
          flex: 1, padding: '5px 2px',
          background: 'transparent', border: 'none',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <span style={{ ...dotStyle, background: colors[0] }} />
      </button>
      {/* Divider */}
      <div style={{
        width: 1,
        background: active ? 'rgba(255,255,255,0.3)' : theme.sidebarBorder,
      }} />
      {/* Right: negative color */}
      <button
        onClick={() => { onSelect(); negRef.current?.click(); }}
        style={{
          flex: 1, padding: '5px 2px',
          background: 'transparent', border: 'none',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <span style={{ ...dotStyle, background: colors[1] }} />
      </button>
    </div>
  );
}

export function ControlPanel({
  isovalue,
  onIsovalueChange,
  gridPoints,
  onGridPointsChange,
  computing,
  theme,
  renderSettings,
  onRenderSettingsChange,
  hideComputation,
  onShowAtomColors,
  t,
  viewMode = 'mo',
  crossSection,
  onCrossSectionChange,
  hqMode,
  onHqModeChange,
}: Props) {
  const update = <K extends keyof RenderSettings>(key: K, val: RenderSettings[K]) => {
    onRenderSettingsChange({ ...renderSettings, [key]: val });
  };

  const labelStyle = { fontSize: 12, color: theme.textSecondary, fontWeight: 500 as const, marginBottom: 4 };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8,
      opacity: computing ? 0.5 : 1,
      pointerEvents: computing ? 'none' : 'auto',
    }}>
      {/* Computation */}
      {!hideComputation && (
        <CollapsibleSection title={t('cp.computation')} defaultOpen theme={theme}>
          <div>
            <div style={labelStyle}>{t('cp.isovalue')}</div>
            <ToggleGroup
              options={viewMode === 'density'
                ? [
                    { value: '0.001', label: '0.001' },
                    { value: '0.002', label: '0.002' },
                    { value: '0.005', label: '0.005' },
                    { value: '0.010', label: '0.01' },
                    { value: '0.020', label: '0.02' },
                  ]
                : [
                    { value: '0.02', label: '0.02' },
                    { value: '0.03', label: '0.03' },
                    { value: '0.04', label: '0.04' },
                    { value: '0.06', label: '0.06' },
                    { value: '0.10', label: '0.10' },
                  ]
              }
              value={viewMode === 'density'
                ? isovalue.toFixed(3)
                : isovalue.toFixed(2)
              }
              onChange={(v) => onIsovalueChange(Number(v))}
              theme={theme}
            />
          </div>
          <div>
            <div style={labelStyle}>{t('cp.gridResolution')}</div>
            <ToggleGroup
              options={[
                { value: '40', label: '40' },
                { value: '60', label: '60' },
                { value: '80', label: '80' },
                { value: '120', label: '120' },
                { value: '160', label: '160' },
              ]}
              value={String(gridPoints)}
              onChange={(v) => onGridPointsChange(Number(v))}
              theme={theme}
            />
          </div>
        </CollapsibleSection>
      )}

      {/* Appearance */}
      <CollapsibleSection title={t('cp.appearance')} theme={theme}>
        <div>
          <div style={labelStyle}>{t('cp.preset')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>
            {PRESETS.map((p) => {
              const active = p.value === renderSettings.preset;
              return (
                <button
                  key={p.value}
                  onClick={() => update('preset', p.value)}
                  style={{
                    padding: '5px 2px',
                    fontSize: 10,
                    fontWeight: active ? 600 : 400,
                    background: active ? theme.accent : theme.accentBg,
                    color: active ? '#fff' : theme.textSecondary,
                    border: `1px solid ${active ? theme.accent : theme.sidebarBorder}`,
                    borderRadius: 4,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
        {onHqModeChange && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={hqMode ?? false}
              onChange={(e) => onHqModeChange(e.target.checked)}
            />
            <span style={{ fontSize: 12, color: theme.text }}>{t('cp.hqMode')}</span>
          </label>
        )}
        <div>
          <div style={labelStyle}>{t('cp.surfaceMode')}</div>
          <ToggleGroup
            options={SURFACE_MODES}
            value={renderSettings.surfaceMode}
            onChange={(v) => update('surfaceMode', v)}
            theme={theme}
          />
        </div>
        <div>
          <div style={labelStyle}>
            {t('cp.opacity')}: {renderSettings.opacity.toFixed(2)}
          </div>
          <input
            type="range"
            min={0.1}
            max={1.0}
            step={0.05}
            value={renderSettings.opacity}
            onChange={(e) => update('opacity', parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
        {/* Lighting (within Appearance) */}
        <div>
          <div style={labelStyle}>{t('cp.direction')}</div>
          <ToggleGroup
            options={LIGHT_DIRECTIONS}
            value={renderSettings.lightDirection}
            onChange={(v) => update('lightDirection', v)}
            theme={theme}
          />
        </div>
        <div>
          <div style={labelStyle}>
            {t('cp.brightness')}: {renderSettings.lightIntensity.toFixed(1)}x
          </div>
          <input
            type="range"
            min={0}
            max={2.0}
            step={0.1}
            value={renderSettings.lightIntensity}
            onChange={(e) => update('lightIntensity', parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
      </CollapsibleSection>

      {/* Color */}
      <CollapsibleSection title={t('cp.color')} theme={theme}>
        {viewMode === 'density' ? (
        <div>
          <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
            {t('density.color')}
            <input
              type="color"
              value={renderSettings.densityColor}
              onChange={(e) => update('densityColor', e.target.value)}
              style={{ width: 20, height: 20, border: 'none', padding: 0, cursor: 'pointer', borderRadius: 3 }}
            />
            {renderSettings.densityColor !== '#4488ff' && (
              <button
                onClick={() => update('densityColor', '#4488ff')}
                style={{
                  fontSize: 10, padding: '1px 5px',
                  background: theme.accentBg, border: `1px solid ${theme.sidebarBorder}`,
                  borderRadius: 3, cursor: 'pointer', color: theme.textSecondary,
                }}
              >
                {t('cp.reset')}
              </button>
            )}
          </div>
        </div>
        ) : (
        <div>
          <div style={labelStyle}>{t('cp.scheme')}</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {COLOR_SCHEMES.map((cs) => {
              const active = cs.value === renderSettings.colorScheme;
              return (
                <button
                  key={cs.value}
                  onClick={() => update('colorScheme', cs.value)}
                  title={cs.label}
                  style={{
                    flex: 1,
                    padding: '5px 2px',
                    background: active ? theme.accent : theme.accentBg,
                    border: `1px solid ${active ? theme.accent : theme.sidebarBorder}`,
                    borderRadius: 4,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 3,
                  }}
                >
                  <span style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: cs.colors[0],
                    border: '1px solid rgba(0,0,0,0.2)',
                    display: 'inline-block',
                  }} />
                  <span style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: cs.colors[1],
                    border: '1px solid rgba(0,0,0,0.2)',
                    display: 'inline-block',
                  }} />
                </button>
              );
            })}
            <CustomColorButton
              active={renderSettings.colorScheme === 'custom'}
              colors={renderSettings.customColors}
              onSelect={() => update('colorScheme', 'custom')}
              onChangePos={(c) => {
                if (renderSettings.colorScheme !== 'custom') update('colorScheme', 'custom');
                update('customColors', [c, renderSettings.customColors[1]]);
              }}
              onChangeNeg={(c) => {
                if (renderSettings.colorScheme !== 'custom') update('colorScheme', 'custom');
                update('customColors', [renderSettings.customColors[0], c]);
              }}
              theme={theme}
            />
          </div>
        </div>
        )}
        <div>
          <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
            {t('cp.background')}
            <input
              type="color"
              value={renderSettings.canvasColor || theme.canvasBg}
              onChange={(e) => update('canvasColor', e.target.value)}
              style={{ width: 20, height: 20, border: 'none', padding: 0, cursor: 'pointer', borderRadius: 3 }}
            />
            {renderSettings.canvasColor && (
              <button
                onClick={() => update('canvasColor', '')}
                style={{
                  fontSize: 10, padding: '1px 5px',
                  background: theme.accentBg, border: `1px solid ${theme.sidebarBorder}`,
                  borderRadius: 3, cursor: 'pointer', color: theme.textSecondary,
                }}
              >
                {t('cp.reset')}
              </button>
            )}
          </div>
        </div>
      </CollapsibleSection>

      {/* Molecule */}
      <CollapsibleSection title={t('cp.molecule')} theme={theme}>
        <div>
          <div style={labelStyle}>
            {t('cp.atomSize')}: {renderSettings.atomScale.toFixed(1)}x
          </div>
          <input
            type="range"
            min={0}
            max={3.0}
            step={0.1}
            value={renderSettings.atomScale}
            onChange={(e) => update('atomScale', parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <div style={labelStyle}>
            {t('cp.bondSize')}: {renderSettings.bondScale.toFixed(1)}x
          </div>
          <input
            type="range"
            min={0}
            max={3.0}
            step={0.1}
            value={renderSettings.bondScale}
            onChange={(e) => update('bondScale', parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={renderSettings.showAtomLabels}
              onChange={(e) => update('showAtomLabels', e.target.checked)}
            />
            {t('cp.atomLabels')}
          </label>
        </div>
        {onShowAtomColors && (
          <button
            onClick={onShowAtomColors}
            style={{
              width: '100%',
              padding: '4px 8px',
              fontSize: 11,
              background: theme.accentBg,
              color: theme.textSecondary,
              border: `1px solid ${theme.sidebarBorder}`,
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {t('cp.atomColors')}{Object.keys(renderSettings.atomColors).length > 0 ? ' *' : ''}
          </button>
        )}
      </CollapsibleSection>

      {/* Cross-section */}
      {crossSection && onCrossSectionChange && (
        <CollapsibleSection title={t('cs.title')} theme={theme}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={crossSection.enabled}
                onChange={(e) => onCrossSectionChange({ ...crossSection, enabled: e.target.checked })}
              />
              {t('cs.enabled')}
            </label>
          </div>
          {crossSection.enabled && (
            <>
              <div>
                <div style={labelStyle}>{t('cs.plane')}</div>
                <ToggleGroup
                  options={[
                    { value: 'XY', label: 'XY' },
                    { value: 'XZ', label: 'XZ' },
                    { value: 'YZ', label: 'YZ' },
                  ]}
                  value={crossSection.plane}
                  onChange={(v) => onCrossSectionChange({ ...crossSection, plane: v as 'XY' | 'XZ' | 'YZ' })}
                  theme={theme}
                />
              </div>
              <div>
                <div style={labelStyle}>
                  {t('cs.position')}: {crossSection.position.toFixed(2)}
                </div>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={crossSection.position}
                  onChange={(e) => onCrossSectionChange({ ...crossSection, position: parseFloat(e.target.value) })}
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={crossSection.showContours}
                    onChange={(e) => onCrossSectionChange({ ...crossSection, showContours: e.target.checked })}
                  />
                  {t('cs.contours')}
                </label>
              </div>
            </>
          )}
        </CollapsibleSection>
      )}

      {computing && (
        <div style={{
          fontSize: 13,
          color: theme.accent,
          textAlign: 'center',
          padding: 4,
        }}>
          {t('cp.computing')}
        </div>
      )}
    </div>
  );
}
