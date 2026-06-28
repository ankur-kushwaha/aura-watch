import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const HOVER_PREVIEW_CLASS =
  'w-56 max-h-80 rounded-xl border border-[rgba(56,189,248,0.35)] shadow-2xl bg-black object-contain';

function computeHoverPreviewPosition(rect: DOMRect, previewW = 224) {
  const left = rect.right + 8 + previewW > window.innerWidth
    ? rect.left - previewW - 8
    : rect.right + 8;
  return { top: Math.max(8, rect.top), left: Math.max(8, left) };
}

export function useHoverCropPreview(enabled = true) {
  const anchorRef = useRef<HTMLElement>(null);
  const [hovering, setHovering] = useState(false);
  const [hoverPos, setHoverPos] = useState({ top: 0, left: 0 });

  const onMouseEnter = () => {
    if (!enabled) return;
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) setHoverPos(computeHoverPreviewPosition(rect));
    setHovering(true);
  };

  const onMouseLeave = () => setHovering(false);

  const renderPreview = (src: string, className = HOVER_PREVIEW_CLASS) => {
    if (!enabled || !hovering) return null;
    return createPortal(
      <div
        className="fixed z-10001 pointer-events-none"
        style={{ top: hoverPos.top, left: hoverPos.left }}
      >
        <img src={src} alt="" className={className} />
      </div>,
      document.body,
    );
  };

  return { anchorRef, onMouseEnter, onMouseLeave, renderPreview };
}
