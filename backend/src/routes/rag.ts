import { Router, Request, Response } from 'express';
import { generateTextEmbedding, answerWithTools } from '../services/ai';
import { searchClipVectors, fallbackSearchClips } from '../services/qdrant';

const router = Router();

/**
 * POST /api/rag/query
 * Perform a vector search on video summaries and answer the user's question with citations.
 */
router.post('/query', async (req: Request, res: Response) => {
  const { question, history = [], startTime, endTime, deviceId, streamId } = req.body;

  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'A valid question string is required.' });
  }

  try {
    console.log(`[RAG] Received query: "${question}" with history size: ${history.length}, filters:`, { startTime, endTime, deviceId, streamId });

    // Call AI service with tools
    const { answer, clips } = await answerWithTools(
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
          streamId
        });

        if (searchResults.length === 0) {
          console.log('[RAG Router callback] Qdrant returned no results. Attempting MongoDB fallback keyword search...');
          searchResults = await fallbackSearchClips(queryText, 5, { 
            startTime: finalStartTime, 
            endTime: finalEndTime, 
            deviceId,
            streamId
          });
        }

        return searchResults;
      }
    );

    // Construct list of cited clips for the frontend
    const citedClips = clips.map((result: any) => {
      const payload = result.payload;
      const filename = payload.filename || (payload.filepath ? payload.filepath.split(/[/\\]/).pop() : '');
      return {
        id: payload.mongoId,
        camera: payload.camera,
        timestamp: payload.timestamp,
        summary: payload.summary,
        filepath: payload.filepath,
        filename: filename,
        score: result.score || 1.0,
      };
    });

    // Return response
    res.json({
      answer,
      clips: citedClips,
    });

  } catch (error) {
    console.error('Error in RAG endpoint:', error);
    res.status(500).json({ error: 'Failed to process RAG query.' });
  }
});

export default router;
