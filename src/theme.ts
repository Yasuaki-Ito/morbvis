export type ThemeMode = 'light' | 'dark';

export interface Theme {
  bg: string;
  sidebarBg: string;
  sidebarBorder: string;
  canvasBg: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentBg: string;
  dropzoneBorder: string;
  dropzoneHoverBorder: string;
  dropzoneHoverBg: string;
  moSelectedBg: string;
  moOccupied: string;
  moVirtual: string;
  border: string;
  inputBg: string;
}

const light: Theme = {
  bg: '#f5f5f8',
  sidebarBg: '#ffffff',
  sidebarBorder: '#e0e0e0',
  canvasBg: '#e8eaf0',
  text: '#1a1a2e',
  textSecondary: '#555',
  textMuted: '#999',
  accent: '#2563eb',
  accentBg: 'rgba(37,99,235,0.08)',
  dropzoneBorder: '#ccc',
  dropzoneHoverBorder: '#2563eb',
  dropzoneHoverBg: 'rgba(37,99,235,0.06)',
  moSelectedBg: 'rgba(37,99,235,0.1)',
  moOccupied: '#16a34a',
  moVirtual: '#999',
  border: '#ccc',
  inputBg: '#ffffff',
};

const dark: Theme = {
  bg: '#0d0d1a',
  sidebarBg: '#161625',
  sidebarBorder: '#333',
  canvasBg: '#1a1a2e',
  text: '#ddd',
  textSecondary: '#aaa',
  textMuted: '#666',
  accent: '#4488ff',
  accentBg: 'rgba(68,136,255,0.15)',
  dropzoneBorder: '#555',
  dropzoneHoverBorder: '#4488ff',
  dropzoneHoverBg: 'rgba(68,136,255,0.1)',
  moSelectedBg: 'rgba(68,136,255,0.2)',
  moOccupied: '#6f6',
  moVirtual: '#888',
  border: '#444',
  inputBg: '#1e1e30',
};

export function getTheme(mode: ThemeMode): Theme {
  return mode === 'light' ? light : dark;
}
