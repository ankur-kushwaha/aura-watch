import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { REID_CROP_IMG } from '../constants';
import type { CropClipPlayback } from '../types';
import { mediaUrl } from '../utils/media';

export function CropThumbnail({
  filename,
  size = 'sm',
  onPreview,
  onPlayClip,
  clipPlayback,
}: {
  filename: string;
  size?: 'sm' | 'md';
  onPreview: (filename: string) => void;
  onPlayClip?: (opts: CropClipPlayback & { cropFilename: string }) => void | Promise<void>;
  clipPlayback?: CropClipPlayback;
}) {
  const [hovering, setHovering] = useState(false);
  const [hoverPos, setHoverPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const src = mediaUrl(`/crops/${filename}`);
  const thumbClass = size === 'sm' ? 'w-10 h-10' : 'w-12 h-12';
  const hasVideo = !!(clipPlayback?.clipFilename || clipPlayback?.detectionId);

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
    <>
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
          updateHoverPos();
          setHovering(true);
        }}
        onMouseLeave={() => setHovering(false)}
        className={`${thumbClass} rounded-lg overflow-hidden border border-[rgba(56,189,248,0.2)] shrink-0 p-0 bg-black ${
          hasVideo ? 'cursor-pointer hover:border-[#38bdf8]/60' : 'cursor-zoom-in hover:border-[#38bdf8]/60'
        } transition-colors`}
        title={hasVideo ? 'Hover to preview crop · Click to play clip' : 'Hover or click to enlarge'}
      >
        <img src={src} alt="" className={`w-full h-full ${REID_CROP_IMG}`} />
      </button>
      {hovering && createPortal(
        <div
          className="fixed z-[10001] pointer-events-none"
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
    </>
  );
}
