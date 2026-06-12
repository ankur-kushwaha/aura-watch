import { QdrantClient } from '@qdrant/js-client-rest';

/**
 * Build a Qdrant REST client from env vars.
 *
 * The official client defaults missing ports to 6333. Behind Nginx (HTTPS on 443
 * → Qdrant on 6333) that makes it speak TLS to the raw HTTP port. JS URL() also
 * strips default ports (:443 / :80), so `https://host` must map to 443, not 6333.
 */
export function createQdrantClientFromEnv(): QdrantClient {
  const rawUrl = process.env.QDRANT_URL;
  const apiKey = process.env.QDRANT_API_KEY;

  if (!rawUrl) {
    return new QdrantClient({ apiKey });
  }

  const parsed = new URL(rawUrl);
  const isHttps = parsed.protocol === 'https:';
  const port = parsed.port ? Number(parsed.port) : isHttps ? 443 : 80;

  return new QdrantClient({
    host: parsed.hostname,
    port,
    https: isHttps,
    apiKey,
  });
}
