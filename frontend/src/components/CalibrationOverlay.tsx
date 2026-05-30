import React, { useCallback, useRef, useState } from 'react';

const CORNER_LABELS = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'];

interface CalibrationOverlayProps {
  previewUrl: string;
  onSubmit: (corners: [number, number][]) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

export const CalibrationOverlay: React.FC<CalibrationOverlayProps> = ({
  previewUrl,
  onSubmit,
  onCancel,
  isSubmitting = false,
}) => {
  const [points, setPoints] = useState<[number, number][]>([]);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (points.length >= 4 || isSubmitting) return;
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    setPoints((prev) => [...prev, [Math.round(x), Math.round(y)]]);
  }, [points.length, isSubmitting]);

  const handleSubmit = () => {
    if (points.length === 4) onSubmit(points);
  };

  return (
    <div className="calibration-overlay">
      <div className="calibration-modal animate-scale-in">
        <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 800 }}>
          Mark Court Corners
        </h3>
        <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-muted)' }}>
          Click the 4 outer court corners in order:{' '}
          <strong>{CORNER_LABELS[points.length] ?? 'done'}</strong>
        </p>
        <div className="calibration-image-wrap" onClick={handleClick}>
          <img ref={imgRef} src={previewUrl} alt="Court preview" draggable={false} />
          {points.map(([x, y], i) => {
            const img = imgRef.current;
            if (!img || !img.naturalWidth) return null;
            return (
              <span
                key={i}
                className="calibration-dot"
                style={{
                  left: `${(x / img.naturalWidth) * 100}%`,
                  top: `${(y / img.naturalHeight) * 100}%`,
                }}
                title={CORNER_LABELS[i]}
              >
                {i + 1}
              </span>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end' }}>
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSubmit}
            disabled={points.length !== 4 || isSubmitting}
          >
            {isSubmitting ? 'Submitting…' : 'Apply Calibration'}
          </button>
        </div>
      </div>
    </div>
  );
};
