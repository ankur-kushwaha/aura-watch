import { Request, Response } from 'express';
import { Readable } from 'stream';
import { extractAccessToken } from '../middleware/auth';

const DEFAULT_DEV_REMOTE_HUB = 'https://aura-watch.adboardtools.com';

export function getRemoteHubUrl(): string | null {
  if (process.env.REMOTE_HUB_URL !== undefined) {
    const configured = process.env.REMOTE_HUB_URL.trim().replace(/\/$/, '');
    return configured || null;
  }
  if (process.env.NODE_ENV === 'development') {
    return DEFAULT_DEV_REMOTE_HUB;
  }
  return null;
}

/**
 * Stream a media file from the production hub (archived on disk there).
 * Used in local dev when clips are not on disk and the edge is connected elsewhere.
 * Returns true if the response was fully proxied.
 */
export async function tryProxyFromRemoteHub(
  req: Request,
  res: Response,
  apiPath: string,
): Promise<boolean> {
  const hubUrl = getRemoteHubUrl();
  if (!hubUrl) return false;

  const token = extractAccessToken(req);
  if (!token) return false;

  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const url = `${hubUrl}/api${path}?access_token=${encodeURIComponent(token)}`;

  try {
    const upstream = await fetch(url);
    if (!upstream.ok || !upstream.body) {
      return false;
    }

    const contentType = upstream.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    await new Promise<void>((resolve, reject) => {
      Readable.fromWeb(upstream.body as import('stream/web').ReadableStream)
        .on('error', reject)
        .pipe(res)
        .on('finish', resolve)
        .on('error', reject);
    });
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Remote Hub] Proxy failed for ${path}:`, message);
    return false;
  }
}
