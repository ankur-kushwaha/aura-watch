import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { User } from 'lucide-react';
import { REID_CROP_IMG } from '../constants';
import { useDeferredLoad } from '../hooks/useDeferredLoad';
import type { CropClipPlayback } from '../types';
import { mediaUrl } from '../utils/media';

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

export function ReidGridAvatar({
  src,
  broken,
  brokenFallback,
  borderClassName,
  sizeClassName = 'w-[88px] h-[88px]',
  shapeClassName = 'rounded-full',
  onImageError,
  overlay,
}: {
  src: string;
  broken?: boolean;
  brokenFallback: ReactNode;
  borderClassName?: string;
  sizeClassName?: string;
  shapeClassName?: string;
  onImageError?: () => void;
  overlay?: ReactNode;
}) {
  const { anchorRef, onMouseEnter, onMouseLeave, renderPreview } = useHoverCropPreview(!broken);

  return (
    <>
      <div
        ref={anchorRef as RefObject<HTMLDivElement>}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className={`relative overflow-hidden border-2 ${sizeClassName} ${shapeClassName} ${borderClassName ?? ''}`}
      >
        {broken ? brokenFallback : (
          <img
            src={src}
            alt=""
            onError={onImageError}
            className={`w-full h-full ${REID_CROP_IMG}`}
          />
        )}
        {overlay}
      </div>
      {!broken && renderPreview(src)}
    </>
  );
}

export function DeferredCropImage({
  filename,
  size = 'md',
  eager = false,
  onClick,
  title,
  showHoverPreview = true,
}: {
  filename: string;
  size?: 'sm' | 'md';
  /** Load immediately instead of waiting until scrolled into view. */
  eager?: boolean;
  onClick?: () => void;
  title?: string;
  showHoverPreview?: boolean;
}) {
  const { ref, shouldLoad } = useDeferredLoad(!eager);
  const { anchorRef, onMouseEnter, onMouseLeave, renderPreview } = useHoverCropPreview(
    showHoverPreview && shouldLoad,
  );
  const thumbClass = size === 'sm' ? 'w-10 h-10' : 'w-12 h-12';
  const src = mediaUrl(`/crops/${filename}`);

  const inner = shouldLoad ? (
    <img src={src} alt="" className={`w-full h-full ${REID_CROP_IMG}`} />
  ) : (
    <div className="w-full h-full flex items-center justify-center bg-[#0a0f1a]">
      <User size={size === 'sm' ? 14 : 16} className="text-text-muted/50" />
    </div>
  );

  const hoverHandlers = showHoverPreview && shouldLoad
    ? { onMouseEnter, onMouseLeave }
    : {};

  if (onClick) {
    return (
      <div ref={ref} className={`${thumbClass} shrink-0`}>
        <button
          ref={anchorRef as RefObject<HTMLButtonElement>}
          type="button"
          onClick={onClick}
          title={title ?? 'Hover to preview · Click to enlarge'}
          className={`${thumbClass} rounded-lg overflow-hidden border border-[rgba(56,189,248,0.2)] p-0 bg-black cursor-zoom-in hover:border-[#38bdf8]/60 transition-colors`}
          {...hoverHandlers}
        >
          {inner}
        </button>
        {renderPreview(src)}
      </div>
    );
  }

  return (
    <div ref={ref} className={`${thumbClass} shrink-0`}>
      <div
        ref={anchorRef as RefObject<HTMLDivElement>}
        className={`${thumbClass} rounded-lg overflow-hidden border border-[rgba(56,189,248,0.2)] bg-black`}
        {...hoverHandlers}
      >
        {inner}
      </div>
      {renderPreview(src)}
    </div>
  );
}

export function CropThumbnail({
  filename,
  size = 'sm',
  lazy = false,
  deferUntilVisible = false,
  showHoverPreview = true,
  playOnClick = true,
  onPreview,
  onPlayClip,
  clipPlayback,
}: {
  filename: string;
  size?: 'sm' | 'md';
  lazy?: boolean;
  deferUntilVisible?: boolean;
  showHoverPreview?: boolean;
  /** When false, click opens crop preview even if clip playback is available. */
  playOnClick?: boolean;
  onPreview: (filename: string) => void;
  onPlayClip?: (opts: CropClipPlayback & { cropFilename: string }) => void | Promise<void>;
  clipPlayback?: CropClipPlayback;
}) {
  const { ref, shouldLoad } = useDeferredLoad(deferUntilVisible);
  const { anchorRef, onMouseEnter, onMouseLeave, renderPreview } = useHoverCropPreview(
    showHoverPreview && (shouldLoad || !deferUntilVisible),
  );
  const src = mediaUrl(`/crops/${filename}`);
  const thumbClass = size === 'sm' ? 'w-10 h-10' : 'w-12 h-12';
  const hasVideo = playOnClick && !!(clipPlayback?.clipFilename || clipPlayback?.detectionId);
  const canShowImage = shouldLoad || !deferUntilVisible;

  return (
    <div ref={deferUntilVisible ? ref : undefined} className={`${thumbClass} shrink-0`}>
      <button
        ref={anchorRef as RefObject<HTMLButtonElement>}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (hasVideo && onPlayClip && clipPlayback) {
            void onPlayClip({ cropFilename: filename, ...clipPlayback });
          } else {
            onPreview(filename);
          }
        }}
        onMouseEnter={() => {
          if (!showHoverPreview || !canShowImage) return;
          onMouseEnter();
        }}
        onMouseLeave={onMouseLeave}
        className={`${thumbClass} rounded-lg overflow-hidden border border-[rgba(56,189,248,0.2)] shrink-0 p-0 bg-black ${
          hasVideo ? 'cursor-pointer hover:border-[#38bdf8]/60' : 'cursor-zoom-in hover:border-[#38bdf8]/60'
        } transition-colors`}
        title={hasVideo ? 'Hover to preview crop · Click to play clip' : 'Hover or click to enlarge'}
      >
        {canShowImage ? (
          <img src={src} alt="" loading={lazy ? 'lazy' : undefined} className={`w-full h-full ${REID_CROP_IMG}`} />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-[#0a0f1a]">
            <User size={size === 'sm' ? 14 : 16} className="text-text-muted/50" />
          </div>
        )}
      </button>
      {canShowImage && renderPreview(src)}
    </div>
  );
}
