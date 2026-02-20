import type { Theme } from '../theme';
import type { RenderSettings, SurfaceMode, ColorScheme, RenderPreset } from '../types';

interface Props {
  isovalue: number;
  onIsovalueChange: (value: number) => void;
  gridPoints: number;
  onGridPointsChange: (value: number) => void;
  computing: boolean;
  theme: Theme;
  renderSettings: RenderSettings;
  onRenderSettingsChange: (settings: RenderSettings) => void;
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

export function ControlPanel({
  isovalue,
  onIsovalueChange,
  gridPoints,
  onGridPointsChange,
  computing,
  theme,
  renderSettings,
  onRenderSettingsChange,
}: Props) {
  const update = <K extends keyof RenderSettings>(key: K, val: RenderSettings[K]) => {
    onRenderSettingsChange({ ...renderSettings, [key]: val });
  };

  const labelStyle = { fontSize: 13, color: theme.textMuted, marginBottom: 4 };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12,
      opacity: computing ? 0.5 : 1,
      pointerEvents: computing ? 'none' : 'auto',
    }}>
      <div>
        <div style={labelStyle}>Isovalue</div>
        <ToggleGroup
          options={[
            { value: '0.02', label: '0.02' },
            { value: '0.03', label: '0.03' },
            { value: '0.04', label: '0.04' },
            { value: '0.06', label: '0.06' },
            { value: '0.10', label: '0.10' },
          ]}
          value={isovalue.toFixed(2)}
          onChange={(v) => onIsovalueChange(Number(v))}
          theme={theme}
        />
      </div>

      <div>
        <div style={labelStyle}>Grid Resolution</div>
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

      {/* Preset */}
      <div>
        <div style={labelStyle}>Preset</div>
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

      {/* Surface mode */}
      <div>
        <div style={labelStyle}>Surface Mode</div>
        <ToggleGroup
          options={SURFACE_MODES}
          value={renderSettings.surfaceMode}
          onChange={(v) => update('surfaceMode', v)}
          theme={theme}
        />
      </div>

      {/* Opacity */}
      <div>
        <div style={labelStyle}>
          Opacity: {renderSettings.opacity.toFixed(2)}
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

      {/* Color scheme */}
      <div>
        <div style={labelStyle}>Color</div>
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
        </div>
      </div>

      {/* Atom size */}
      <div>
        <div style={labelStyle}>
          Atom Size: {renderSettings.atomScale.toFixed(1)}x
        </div>
        <input
          type="range"
          min={0.2}
          max={3.0}
          step={0.1}
          value={renderSettings.atomScale}
          onChange={(e) => update('atomScale', parseFloat(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      {/* Bond size */}
      <div>
        <div style={labelStyle}>
          Bond Size: {renderSettings.bondScale.toFixed(1)}x
        </div>
        <input
          type="range"
          min={0.2}
          max={3.0}
          step={0.1}
          value={renderSettings.bondScale}
          onChange={(e) => update('bondScale', parseFloat(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      {computing && (
        <div style={{
          fontSize: 13,
          color: theme.accent,
          textAlign: 'center',
          padding: 4,
        }}>
          Computing...
        </div>
      )}
    </div>
  );
}
