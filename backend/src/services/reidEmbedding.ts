export const REID_EMBEDDING_DIM = 512;

export function decodeReidEmbeddingHeader(header: string): number[] {
  const trimmed = header.trim();
  if (!trimmed) {
    throw new Error('Empty ReID embedding header');
  }

  const buf = Buffer.from(trimmed, 'base64');
  if (buf.length !== REID_EMBEDDING_DIM * 4) {
    throw new Error(`Invalid ReID embedding byte length: ${buf.length}`);
  }

  const embedding: number[] = new Array(REID_EMBEDDING_DIM);
  for (let i = 0; i < REID_EMBEDDING_DIM; i++) {
    embedding[i] = buf.readFloatLE(i * 4);
  }
  return embedding;
}

export function normalizeReidEmbedding(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length !== REID_EMBEDDING_DIM) {
    return undefined;
  }
  if (!value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    return undefined;
  }
  return value;
}
