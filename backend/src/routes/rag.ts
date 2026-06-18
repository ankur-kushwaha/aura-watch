import { Router, Request, Response } from 'express';
import { generateTextEmbedding, chatWithTools } from '../services/ai';
import { Tool } from '../services/ai/types';
import { searchClipVectors, fallbackSearchClips } from '../services/qdrant';
import prisma from '../services/db';
import { getOrgOnlineDeviceIds } from '../services/orgScope';
import { getOrgSettings } from '../services/orgSettings';
import { buildClipSearchText, formatClipContextSummary } from '../services/yoloSummary';

const router = Router();

/**
 * POST /api/rag/query
 * Perform a vector search on video summaries and answer the user's question with citations.
 * Also supports REID detection queries via a second tool available to the AI.
 */
router.post('/query', async (req: Request, res: Response) => {
  const { question, history = [], startTime, endTime, deviceId, streamId, systemPrompt } = req.body;

  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'A valid question string is required.' });
  }

  try {
    const orgSettings = await getOrgSettings(req.auth.orgId);
    if (!orgSettings.aiChat) {
      return res.status(403).json({ error: 'AI chat is disabled for this organization.' });
    }

    console.log(`[RAG] Received query: "${question}" with history size: ${history.length}, filters:`, { startTime, endTime, deviceId, streamId });

    const onlineDeviceIdList = await getOrgOnlineDeviceIds(req.auth.orgId);
    const onlineDeviceIds = new Set(onlineDeviceIdList);
    const isFromOnlineDevice = (detDeviceId?: string | null) =>
      !!detDeviceId && onlineDeviceIds.has(detDeviceId);

    // Call AI service with tools
    const tools: Tool[] = [
      {
        name: 'searchQdrant',
        description: 'Search the vector database or MongoDB fallback for video surveillance summaries matching the query.',
        parameters: {
          type: 'object',
          properties: {
            queryText: {
              type: 'string',
              description: 'The search query/description of the video clip/event to search for.'
            },
            startTime: {
              type: 'string',
              description: 'ISO-8601 string representing the start of the time range query filter (optional). Always resolve relative queries relative to current system time.'
            },
            endTime: {
              type: 'string',
              description: 'ISO-8601 string representing the end of the time range query filter (optional). Always resolve relative queries relative to current system time.'
            }
          },
          required: ['queryText']
        },
        execute: async (args: any) => {
          const queryText = args.queryText;
          const toolStartTime = args.startTime;
          const toolEndTime = args.endTime;

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

          const contexts = searchResults.map((result: any, i: number) => {
            const payload = result.payload;
            return `[Clip ${i + 1}]: Time: ${payload.timestamp}, Camera: ${payload.camera}, Summary: ${formatClipContextSummary(payload)}`;
          });
          const contextText = contexts.length > 0 ? contexts.join('\n\n') : 'No matching clips found in database.';

          return {
            resultForModel: contextText,
            rawData: searchResults
          };
        }
      }
    ];

    const currentLocalTime = new Date().toISOString();
    const defaultPrompt = `You are an AI video surveillance analyst dashboard.
The user is asking a question about the security camera recordings.
The current system time is ${currentLocalTime}. Use this reference to resolve relative timestamps like "yesterday", "today", "last 2 hours", "8:00 AM", etc. into absolute ISO-8601 strings.
You have access to a tool:
1. 'searchQdrant' — searches the video clip summaries database for events and activity descriptions. Use this when the user asks about what happened, what activity was recorded, or asks for specific scene descriptions.
If the query implies a time filter, resolve it to absolute ISO-8601 strings.
Answer the user's question accurately and objectively using only the retrieved data.
If the search returns no results, state that clearly.
Cite the relevant sources (e.g. "[Clip 1]") in your response where appropriate. Keep the answer concise and helpful.`;

    const finalSystemPrompt = systemPrompt || defaultPrompt;

    const { answer, toolResults } = await chatWithTools(question, history, tools, finalSystemPrompt);

    const clips = toolResults
      .filter(tr => tr.toolName === 'searchQdrant')
      .flatMap(tr => tr.rawData || []);

    const reidDetections: any[] = [];

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
        summary: payload.summary ?? '',
        aiSummary: payload.aiSummary ?? null,
        filepath: payload.filepath,
        filename: filename,
        deviceId: payload.deviceId ?? null,
        score: result.score || 1.0,
      };
    });

    const citedReid: any[] = [];

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
