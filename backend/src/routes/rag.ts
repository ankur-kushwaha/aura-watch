import { Router, Request, Response } from 'express';
import { generateTextEmbedding, answerWithTools } from '../services/ai';
import { searchClipVectors, fallbackSearchClips } from '../services/qdrant';
import prisma from '../services/db';
import { getOrgOnlineDeviceIds } from '../services/orgScope';

const router = Router();

/**
 * POST /api/rag/query
 * Perform a vector search on video summaries and answer the user's question with citations.
 * Also supports REID detection queries via a second tool available to the AI.
 */
router.post('/query', async (req: Request, res: Response) => {
  const { question, history = [], startTime, endTime, deviceId, streamId } = req.body;

  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'A valid question string is required.' });
  }

  try {
    console.log(`[RAG] Received query: "${question}" with history size: ${history.length}, filters:`, { startTime, endTime, deviceId, streamId });

    const onlineDeviceIdList = await getOrgOnlineDeviceIds(req.auth.orgId);
    const onlineDeviceIds = new Set(onlineDeviceIdList);
    const isFromOnlineDevice = (detDeviceId?: string | null) =>
      !!detDeviceId && onlineDeviceIds.has(detDeviceId);

    // Call AI service with tools
    const { answer, clips, reidDetections } = await answerWithTools(
      question,
      history,
      async (queryText: string, toolStartTime?: string, toolEndTime?: string) => {
        // Prioritize UI-provided filter over LLM-parsed filter
        const finalStartTime = startTime || toolStartTime;
        const finalEndTime = endTime || toolEndTime;

        console.log(`[RAG Router callback] Executing Qdrant search tool for: "${queryText}"`, {
          finalStartTime,
          finalEndTime,
          deviceId,
          streamId
        });

        const queryEmbedding = await generateTextEmbedding(queryText);
        let searchResults = await searchClipVectors(queryEmbedding, 5, { 
          startTime: finalStartTime, 
          endTime: finalEndTime, 
          deviceId,
          streamId,
          orgDeviceIds: deviceId ? undefined : onlineDeviceIdList,
        });

        if (searchResults.length === 0) {
          console.log('[RAG Router callback] Qdrant returned no results. Attempting MongoDB fallback keyword search...');
          searchResults = await fallbackSearchClips(queryText, 5, { 
            startTime: finalStartTime, 
            endTime: finalEndTime, 
            deviceId,
            streamId,
            orgDeviceIds: deviceId ? undefined : onlineDeviceIdList,
          });
        }

        return searchResults;
      },
      async (cameraName?: string, className?: string, toolStartTime?: string, toolEndTime?: string) => {
        // Prioritize UI-provided time filter over LLM-parsed filter
        const finalStartTime = startTime || toolStartTime;
        const finalEndTime = endTime || toolEndTime;

        console.log(`[RAG Router callback] Executing REID detection search`, {
          cameraName,
          className,
          finalStartTime,
          finalEndTime,
          streamId
        });

        const where: any = {};

        if (cameraName) {
          where.cameraName = { contains: cameraName, mode: 'insensitive' };
        }

        if (className) {
          where.className = className;
        }

        if (streamId) {
          where.streamId = streamId;
        }

        if (finalStartTime || finalEndTime) {
          where.timestamp = {};
          if (finalStartTime) where.timestamp.gte = new Date(finalStartTime);
          if (finalEndTime) where.timestamp.lte = new Date(finalEndTime);
        }

        const detections = await prisma.reidDetection.findMany({
          where: {
            ...where,
            deviceId: { in: Array.from(onlineDeviceIds) },
          },
          orderBy: { timestamp: 'desc' },
          take: 200, // cap to avoid huge context
        });

        console.log(`[RAG REID callback] Found ${detections.length} REID detections`);
        return detections;
      }
    );

    // Construct list of cited video clips for the frontend
    const citedClips = clips
      .filter((result: any) => isFromOnlineDevice(result.payload?.deviceId))
      .map((result: any) => {
      const payload = result.payload;
      const filename = payload.filename || (payload.filepath ? payload.filepath.split(/[/\\]/).pop() : '');
      return {
        id: payload.mongoId,
        camera: payload.camera,
        timestamp: payload.timestamp,
        summary: payload.summary,
        filepath: payload.filepath,
        filename: filename,
        deviceId: payload.deviceId ?? null,
        score: result.score || 1.0,
      };
    });

    // Construct list of cited REID detections for the frontend
    const citedReid = reidDetections
      .filter((det: any) => isFromOnlineDevice(det.deviceId))
      .map((det: any) => ({
      id: det.id,
      cameraName: det.cameraName,
      trackId: det.trackId,
      timestamp: det.timestamp instanceof Date ? det.timestamp.toISOString() : det.timestamp,
      filename: det.filename,
      className: det.className,
      deviceId: det.deviceId ?? null,
      bbox: det.bbox,
    }));

    // Return response
    res.json({
      answer,
      clips: citedClips,
      reidDetections: citedReid,
    });

  } catch (error) {
    console.error('Error in RAG endpoint:', error);
    res.status(500).json({ error: 'Failed to process RAG query.' });
  }
});

export default router;
