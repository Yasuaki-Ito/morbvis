import { useCallback, useRef, useState } from 'react';
import type { Theme } from '../theme';
import type { TFunction } from '../i18n';

interface Props {
  onFileLoaded: (text: string, filename: string) => void;
  theme: Theme;
  t: TFunction;
}

export function FileUpload({ onFileLoaded, theme, t }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onFileLoaded(reader.result, file.name);
      }
    };
    reader.readAsText(file);
  }, [onFileLoaded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, [handleFile]);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragOver ? theme.dropzoneHoverBorder : theme.dropzoneBorder}`,
        borderRadius: 8,
        padding: '16px 20px',
        textAlign: 'center',
        cursor: 'pointer',
        background: dragOver ? theme.dropzoneHoverBg : 'transparent',
        transition: 'all 0.2s',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".molden,.input,.cube"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <div style={{ fontSize: 14, color: theme.textSecondary }}>
        {t('upload.dragDrop')}
        <br />
        {t('upload.orClick')}
      </div>
    </div>
  );
}
