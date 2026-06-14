export const PREVIEW_STALL_MS = 5000;
/** Show a stalled-init message and auto-retry preview if no frame arrives. */
export const STREAM_INIT_TIMEOUT_MS = 30_000;
/** Minimum gap between automatic preview refresh attempts. */
export const STREAM_REFRESH_COOLDOWN_MS = 10_000;
export const CLIPS_PAGE_SIZE = 10;
export const REID_DETECTIONS_PAGE_SIZE = 24;

export const WS_BASE = import.meta.env.DEV
  ? 'ws://localhost:5000'
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

export const HUB_HTTP = import.meta.env.DEV ? 'http://localhost:5000' : window.location.origin;

/** Reid crops are pre-clipped person JPEGs — always object-contain, never object-cover. */
export const REID_CROP_IMG = 'object-contain bg-black';
