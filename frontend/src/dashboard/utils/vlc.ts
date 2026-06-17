export type VlcLaunchResult = 'likely-opened' | 'handler-missing';

/** Build a vlc:// handler URL for an RTSP stream (requires VLC + registered handler). */
export function buildVlcRtspUrl(rtspUrl: string): string {
  return `vlc://${rtspUrl.trim()}`;
}

/** macOS Terminal command — works when vlc:// is not registered in the browser. */
export function buildMacVlcTerminalCommand(rtspUrl: string): string {
  const trimmed = rtspUrl.trim().replace(/'/g, `'\\''`);
  return `open -a VLC '${trimmed}'`;
}

function isRtspUrl(url: string): boolean {
  return url.trim().toLowerCase().startsWith('rtsp://');
}

/**
 * Try to open RTSP in VLC via the OS protocol handler.
 * Browsers cannot detect failure reliably; use blur heuristics + fallbacks in the UI.
 */
export function openRtspInVlc(rtspUrl: string): Promise<VlcLaunchResult> {
  const trimmed = rtspUrl.trim();
  if (!isRtspUrl(trimmed)) {
    return Promise.resolve('handler-missing');
  }

  return new Promise((resolve) => {
    let blurred = false;
    const onBlur = () => {
      blurred = true;
    };
    window.addEventListener('blur', onBlur, { once: true });

    const anchor = document.createElement('a');
    anchor.href = buildVlcRtspUrl(trimmed);
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    window.setTimeout(() => {
      window.removeEventListener('blur', onBlur);
      resolve(blurred ? 'likely-opened' : 'handler-missing');
    }, 1200);
  });
}

export async function copyRtspUrl(rtspUrl: string): Promise<boolean> {
  const trimmed = rtspUrl.trim();
  if (!trimmed) return false;
  try {
    await navigator.clipboard.writeText(trimmed);
    return true;
  } catch {
    return false;
  }
}

export async function copyMacVlcTerminalCommand(rtspUrl: string): Promise<boolean> {
  const command = buildMacVlcTerminalCommand(rtspUrl);
  try {
    await navigator.clipboard.writeText(command);
    return true;
  } catch {
    return false;
  }
}
