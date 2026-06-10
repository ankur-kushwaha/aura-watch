import { QdrantClient } from '@qdrant/js-client-rest';
import prisma from './db';

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const COLLECTION_NAME = 'video_clips';

// Helper to convert MongoDB ObjectId to a valid UUID format for Qdrant
export function mongoIdToUuid(mongoId: string): string {
  // mongoId is 24 hex characters
  // We pad it with 8 leading zeros to get 32 hex characters, then format as 8-4-4-4-12
  const padded = '00000000' + mongoId;
  return `${padded.slice(0, 8)}-${padded.slice(8, 12)}-${padded.slice(12, 16)}-${padded.slice(16, 20)}-${padded.slice(20, 32)}`;
}

const REID_COLLECTION_NAME = 'reid_embeddings';

export async function initQdrant() {
  try {
    console.log(`Checking Qdrant collections at ${process.env.QDRANT_URL}...`);
    const collections = await qdrant.getCollections();
    
    // Check video_clips
    const exists = collections.collections.some(c => c.name === COLLECTION_NAME);
    if (!exists) {
      console.log(`Creating Qdrant collection: ${COLLECTION_NAME}`);
      await qdrant.createCollection(COLLECTION_NAME, {
        vectors: {
          size: 768, // Gemini text-embedding-004 dimension
          distance: 'Cosine',
        },
      });
      console.log(`Collection ${COLLECTION_NAME} created successfully.`);
    } else {
      console.log(`Qdrant collection ${COLLECTION_NAME} already exists.`);
    }

    // Check reid_embeddings
    const reidExists = collections.collections.some(c => c.name === REID_COLLECTION_NAME);
    if (!reidExists) {
      console.log(`Creating Qdrant collection: ${REID_COLLECTION_NAME}`);
      await qdrant.createCollection(REID_COLLECTION_NAME, {
        vectors: {
          size: 512, // OSNet dimension
          distance: 'Cosine',
        },
      });
      console.log(`Collection ${REID_COLLECTION_NAME} created successfully.`);
    } else {
      console.log(`Qdrant collection ${REID_COLLECTION_NAME} already exists.`);
    }
  } catch (error) {
    console.error('Failed to initialize Qdrant collections:', error);
  }
}

export async function upsertClipVector(mongoId: string, vector: number[], payload: any) {
  const qdrantId = mongoIdToUuid(mongoId);
  try {
    await qdrant.upsert(COLLECTION_NAME, {
      wait: true,
      points: [
        {
          id: qdrantId,
          vector: vector,
          payload: {
            ...payload,
            mongoId,
          },
        },
      ],
    });
    console.log(`Successfully indexed clip in Qdrant with ID: ${qdrantId}`);
  } catch (error) {
    console.error(`Error indexing clip ${mongoId} in Qdrant (Continuing pipeline):`, error);
  }
}

export async function deleteClipVector(mongoId: string) {
  await deleteClipVectors([mongoId]);
}

export async function deleteClipVectors(mongoIds: string[]) {
  if (mongoIds.length === 0) return;
  const qdrantIds = mongoIds.map(mongoIdToUuid);
  try {
    await qdrant.delete(COLLECTION_NAME, {
      points: qdrantIds,
    });
    console.log(`Deleted ${qdrantIds.length} vector(s) from Qdrant`);
  } catch (error) {
    console.error(`Error deleting vectors from Qdrant:`, error);
  }
}

export async function searchClipVectors(
  vector: number[],
  limit = 5,
  options?: { startTime?: string; endTime?: string; deviceId?: string; streamId?: string }
) {
  try {
    const filterConditions: any[] = [];

    // Add time range filter if provided
    if (options?.startTime || options?.endTime) {
      const rangeCondition: any = {};
      if (options.startTime) {
        rangeCondition.gte = options.startTime;
      }
      if (options.endTime) {
        rangeCondition.lte = options.endTime;
      }
      filterConditions.push({
        key: 'timestamp',
        range: rangeCondition,
      });
    }

    // Add device ID filter if provided
    if (options?.deviceId) {
      filterConditions.push({
        key: 'deviceId',
        match: {
          value: options.deviceId,
        },
      });
    }

    // Add stream ID filter if provided
    if (options?.streamId) {
      filterConditions.push({
        key: 'streamId',
        match: {
          value: options.streamId,
        },
      });
    }

    const results = await qdrant.search(COLLECTION_NAME, {
      vector: vector,
      limit: limit,
      filter: filterConditions.length > 0 ? { must: filterConditions } : undefined,
      with_payload: true,
    });
    return results;
  } catch (error) {
    console.error('Error searching in Qdrant:', error);
    return [];
  }
}

/**
 * Fallback search using MongoDB Contains filters if Qdrant is offline.
 */
export async function fallbackSearchClips(
  queryText: string,
  limit = 5,
  options?: { startTime?: string; endTime?: string; deviceId?: string; streamId?: string }
) {
  try {
    console.log(`[Qdrant Fallback] Searching MongoDB for keywords matching: "${queryText}"`);
    
    // Split the query into terms of length > 2
    const terms = queryText
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // strip punctuation
      .split(/\s+/)
      .filter(t => t.length > 2);

    const baseWhere: any = {};
    if (options?.deviceId) {
      baseWhere.deviceId = options.deviceId;
    }
    if (options?.streamId) {
      baseWhere.streamId = options.streamId;
    }
    if (options?.startTime || options?.endTime) {
      baseWhere.timestamp = {};
      if (options.startTime) {
        baseWhere.timestamp.gte = new Date(options.startTime);
      }
      if (options.endTime) {
        baseWhere.timestamp.lte = new Date(options.endTime);
      }
    }

    if (terms.length === 0) {
      // Return recent clips if no search terms
      const recentClips = await prisma.videoClip.findMany({
        where: baseWhere,
        orderBy: { timestamp: 'desc' },
        take: limit,
      });
      return recentClips.map(clip => ({
        id: mongoIdToUuid(clip.id),
        version: 1,
        score: 0.1,
        payload: {
          mongoId: clip.id,
          filepath: clip.filepath,
          filename: clip.filename,
          timestamp: clip.timestamp.toISOString(),
          summary: clip.summary,
          camera: clip.camera,
          deviceId: clip.deviceId,
          streamId: clip.streamId,
        }
      }));
    }

    // Search clips matching any of the terms in the summary
    const matchingClips = await prisma.videoClip.findMany({
      where: {
        ...baseWhere,
        OR: terms.map(term => ({
          summary: {
            contains: term,
            mode: 'insensitive' as const,
          }
        }))
      },
      take: limit,
      orderBy: { timestamp: 'desc' },
    });

    // Score based on term matches
    return matchingClips.map(clip => {
      const summaryLower = clip.summary.toLowerCase();
      let matchedCount = 0;
      terms.forEach(term => {
        if (summaryLower.includes(term)) matchedCount++;
      });
      const score = matchedCount / terms.length;

      return {
        id: mongoIdToUuid(clip.id),
        version: 1,
        score: Math.min(score + 0.1, 0.95), // Fake score above 0
        payload: {
          mongoId: clip.id,
          filepath: clip.filepath,
          filename: clip.filename,
          timestamp: clip.timestamp.toISOString(),
          summary: clip.summary,
          camera: clip.camera,
          deviceId: clip.deviceId,
          streamId: clip.streamId,
        }
      };
    });

  } catch (error) {
    console.error('Error performing fallback search in MongoDB:', error);
    return [];
  }
}

export async function upsertReidVector(mongoId: string, vector: number[], payload: any) {
  const qdrantId = mongoIdToUuid(mongoId);
  try {
    await qdrant.upsert(REID_COLLECTION_NAME, {
      wait: true,
      points: [
        {
          id: qdrantId,
          vector: vector,
          payload: {
            ...payload,
            mongoId,
          },
        },
      ],
    });
    console.log(`Successfully indexed ReID embedding in Qdrant with ID: ${qdrantId}`);
  } catch (error) {
    console.error(`Error indexing ReID embedding ${mongoId} in Qdrant:`, error);
  }
}

export async function deleteReidVector(mongoId: string) {
  const qdrantId = mongoIdToUuid(mongoId);
  try {
    await qdrant.delete(REID_COLLECTION_NAME, {
      points: [qdrantId],
    });
    console.log(`Deleted ReID vector from Qdrant: ${qdrantId}`);
  } catch (error) {
    console.error(`Error deleting ReID vector from Qdrant:`, error);
  }
}

export async function deleteReidVectors(mongoIds: string[]) {
  if (mongoIds.length === 0) return;
  const qdrantIds = mongoIds.map(mongoIdToUuid);
  try {
    await qdrant.delete(REID_COLLECTION_NAME, {
      points: qdrantIds,
    });
    console.log(`Deleted ${qdrantIds.length} ReID vector(s) from Qdrant`);
  } catch (error) {
    console.error(`Error deleting ReID vectors from Qdrant:`, error);
  }
}

export async function updateReidPayload(mongoId: string, payloadUpdate: Record<string, unknown>) {
  const qdrantId = mongoIdToUuid(mongoId);
  try {
    await qdrant.setPayload(REID_COLLECTION_NAME, {
      wait: true,
      payload: payloadUpdate,
      points: [qdrantId],
    });
  } catch (error) {
    console.error(`Error updating ReID payload for ${mongoId}:`, error);
  }
}

export async function updateReidPayloadBatch(mongoIds: string[], payloadUpdate: Record<string, unknown>) {
  if (mongoIds.length === 0) return;
  const qdrantIds = mongoIds.map(mongoIdToUuid);
  try {
    await qdrant.setPayload(REID_COLLECTION_NAME, {
      wait: true,
      payload: payloadUpdate,
      points: qdrantIds,
    });
  } catch (error) {
    console.error(`Error batch updating ReID payloads:`, error);
  }
}

export async function retrieveReidVectors(mongoIds: string[]): Promise<{ mongoId: string; vector: number[] }[]> {
  if (mongoIds.length === 0) return [];
  const qdrantIds = mongoIds.map(mongoIdToUuid);
  try {
    const points = await qdrant.retrieve(REID_COLLECTION_NAME, {
      ids: qdrantIds,
      with_vector: true,
    });
    return points
      .filter((p) => p.vector && (p.payload as any)?.mongoId)
      .map((p) => ({
        mongoId: (p.payload as any).mongoId as string,
        vector: p.vector as number[],
      }));
  } catch (error) {
    console.error('Error retrieving ReID vectors from Qdrant:', error);
    return [];
  }
}

export async function searchReidVectors(
  vector: number[],
  limit = 20,
  options?: { startTime?: string; endTime?: string; deviceId?: string }
) {
  try {
    const filterConditions: any[] = [];

    if (options?.startTime || options?.endTime) {
      const rangeCondition: any = {};
      if (options.startTime) {
        rangeCondition.gte = options.startTime;
      }
      if (options.endTime) {
        rangeCondition.lte = options.endTime;
      }
      filterConditions.push({
        key: 'timestamp',
        range: rangeCondition,
      });
    }

    if (options?.deviceId) {
      filterConditions.push({
        key: 'deviceId',
        match: {
          value: options.deviceId,
        },
      });
    }

    const results = await qdrant.search(REID_COLLECTION_NAME, {
      vector: vector,
      limit: limit,
      filter: filterConditions.length > 0 ? { must: filterConditions } : undefined,
      with_payload: true,
    });
    return results;
  } catch (error) {
    console.error('Error searching ReID vectors in Qdrant:', error);
    return [];
  }
}


