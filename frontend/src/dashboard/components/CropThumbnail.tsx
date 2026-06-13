import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { User } from 'lucide-react';
import { REID_CROP_IMG } from '../constants';
import { useDeferredLoad } from '../hooks/useDeferredLoad';
import type { CropClipPlayback } from '../types';
import { mediaUrl } from '../utils/media';

export function DeferredCropImage({
  filename,
  size = 'md',
  eager = false,
  onClick,
  title,
}: {
  filename: string;
  size?: 'sm' | 'md';
  /** Load immediately instead of waiting until scrolled into view. */
  eager?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const { ref, shouldLoad } = useDeferredLoad(!eager);
  const thumbClass = size === 'sm' ? 'w-10 h-10' : 'w-12 h-12';
  const src = mediaUrl(`/crops/${filename}`);

  const inner = shouldLoad ? (
    <img src={src} alt="" className={`w-full h-full ${REID_CROP_IMG}`} />
  ) : (
    <div className="w-full h-full flex items-center justify-center bg-[#0a0f1a]">
      <User size={size === 'sm' ? 14 : 16} className="text-text-muted/50" />
    </div>
  );

  if (onClick) {
    return (
      <div ref={ref} className={`${thumbClass} shrink-0`}>
        <button
          type="button"
          onClick={onClick}
          title={title}
          className={`${thumbClass} rounded-lg overflow-hidden border border-[rgba(56,189,248,0.2)] p-0 bg-black cursor-zoom-in hover:border-[#38bdf8]/60 transition-colors`}
        >
          {inner}
        </button>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={`${thumbClass} rounded-lg overflow-hidden border border-[rgba(56,189,248,0.2)] shrink-0 bg-black`}
    >
      {inner}
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
  const [hovering, setHovering] = useState(false);
  const [hoverPos, setHoverPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const src = mediaUrl(`/crops/${filename}`);
  const thumbClass = size === 'sm' ? 'w-10 h-10' : 'w-12 h-12';
  const hasVideo = playOnClick && !!(clipPlayback?.clipFilename || clipPlayback?.detectionId);
  const canShowImage = shouldLoad || !deferUntilVisible;

  const updateHoverPos = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const previewW = 224;
    const left = rect.right + 8 + previewW > window.innerWidth
      ? rect.left - previewW - 8
      : rect.right + 8;
    setHoverPos({ top: Math.max(8, rect.top), left: Math.max(8, left) });
  };

  return (
    <div ref={deferUntilVisible ? ref : undefined} className={`${thumbClass} shrink-0`}>
      <button
        ref={btnRef}
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
          updateHoverPos();
          setHovering(true);
        }}
        onMouseLeave={() => setHovering(false)}
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
      {showHoverPreview && hovering && canShowImage && createPortal(
        <div
          className="fixed z-10001 pointer-events-none"
          style={{ top: hoverPos.top, left: hoverPos.left }}
        >
          <img
            src={src}
            alt=""
            className="w-56 max-h-80 rounded-xl border border-[rgba(56,189,248,0.35)] shadow-2xl bg-black object-contain"
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
