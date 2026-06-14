export interface StreamErrorState {
  errorType: string;
  message: string;
  retryInSec?: number;
}

function classifyError(detail: string): string {
  const lower = detail.toLowerCase();
  if (lower.includes('no route to host') || lower.includes('network is unreachable')) {
    return 'camera_unreachable';
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return 'camera_timeout';
  }
  if (lower.includes('stream lost') || lower.includes('no frame')) {
    return 'camera_stall';
  }
  if (lower.includes('connection refused')) {
    return 'camera_refused';
  }
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized')) {
    return 'camera_auth';
  }
  return 'camera_error';
}

function simplifyError(detail: string): string {
  const cleaned = detail
    .replace(/\[[^\]]+\]/g, '')
    .replace(/Error opening input files?:/gi, '')
    .replace(/Error opening input file/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length > 220) {
    return `${cleaned.slice(0, 217)}...`;
  }
  return cleaned || 'Camera connection failed';
}

export function parseStreamErrorFromLog(message: string): StreamErrorState | null {
  const failedOpen = message.match(/Failed to open camera \((.+?)\)\. Retrying in (\d+)s/i);
  if (failedOpen) {
    const detail = failedOpen[1];
    return {
      errorType: classifyError(detail),
      message: simplifyError(detail),
      retryInSec: Number.parseInt(failedOpen[2], 10),
    };
  }

  const noFrames = message.match(/Camera opened but no frames \((.+?)\)\. Retrying in (\d+)s/i);
  if (noFrames) {
    const detail = noFrames[1];
    return {
      errorType: 'camera_no_frames',
      message: simplifyError(detail),
      retryInSec: Number.parseInt(noFrames[2], 10),
    };
  }

  const detector = message.match(/\[Detector Error\]\s*(.+?)\.\s*Reconnecting/i);
  if (detector) {
    const detail = detector[1];
    return {
      errorType: classifyError(detail),
      message: simplifyError(detail),
    };
  }

  return null;
}

export function getStreamErrorTitle(errorType: string): string {
  switch (errorType) {
    case 'camera_unreachable':
      return 'Camera unreachable';
    case 'camera_timeout':
      return 'Camera connection timed out';
    case 'camera_stall':
      return 'Camera stream stalled';
    case 'camera_no_frames':
      return 'Camera not sending frames';
    case 'camera_refused':
      return 'Camera refused connection';
    case 'camera_auth':
      return 'Camera authentication failed';
    default:
      return 'Camera connection error';
  }
}

export function getStreamErrorHint(errorType: string, message: string): string {
  const lower = message.toLowerCase();
  if (errorType === 'camera_unreachable' || lower.includes('no route to host')) {
    return 'The Pi cannot reach the camera IP. Check the camera is powered on, on the same network as the Pi, and the RTSP URL/host is correct (e.g. 192.168.29.204).';
  }
  if (errorType === 'camera_timeout' || lower.includes('timed out')) {
    return 'RTSP connection timed out. Verify the camera IP, RTSP port (usually 554), and try RTSP transport TCP in stream settings.';
  }
  if (errorType === 'camera_auth' || lower.includes('401') || lower.includes('403')) {
    return 'RTSP credentials may be wrong. Open stream settings and verify username/password in the RTSP URL.';
  }
  if (errorType === 'camera_refused') {
    return 'The camera rejected the connection. Confirm RTSP is enabled on the camera and the stream path (e.g. /stream1) is correct.';
  }
  if (errorType === 'camera_stall' || errorType === 'camera_no_frames') {
    return 'The camera stopped sending video. Power-cycle the camera or reboot the edge device. The agent will keep retrying automatically.';
  }
  return 'Open stream settings to verify the RTSP URL and credentials. Use Device Logs for full FFmpeg output.';
}
