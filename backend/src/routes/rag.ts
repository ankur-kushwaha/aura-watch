import { Router, Request, Response } from 'express';
import { generateTextEmbedding, answerQuestionWithContext } from '../services/gemini';
import { searchClipVectors, fallbackSearchClips } from '../services/qdrant';

const router = Router();

/**
 * POST /api/rag/query
 * Perform a vector search on video summaries and answer the user's question with citations.
 */
router.post('/query', async (req: Request, res: Response) => {
  const { question } = req.body;

  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'A valid question string is required.' });
  }

  try {
    console.log(`[RAG] Received query: "${question}"`);

    // 1. Generate text embedding for the question
    const questionEmbedding = await generateTextEmbedding(question);

    // 2. Query Qdrant for top matching clips
    let searchResults = await searchClipVectors(questionEmbedding, 5);

    // Fallback if Qdrant returned nothing (e.g. if it is offline or has no results)
    if (searchResults.length === 0) {
      console.log('[RAG] Qdrant returned no results. Attempting MongoDB fallback keyword search...');
      searchResults = await fallbackSearchClips(question, 5);
    }

    if (searchResults.length === 0) {
      return res.json({
        answer: "No relevant recorded video events were found to answer your question. Please ensure the camera has captured and processed motion clips.",
        clips: [],
      });
    }

    // 3. Extract matching summaries and construct context
    const contexts = searchResults.map((result: any) => {
      const payload = result.payload;
      return `Time: ${payload.timestamp}, Camera: ${payload.camera}, Summary: ${payload.summary}`;
    });

    // 4. Ask Gemini to answer the question using the retrieved context
    const answer = await answerQuestionWithContext(question, contexts);

    // 5. Construct list of cited clips for the frontend
    const citedClips = searchResults.map((result: any) => {
      const payload = result.payload;
      const filename = payload.filename || (payload.filepath ? payload.filepath.split(/[/\\]/).pop() : '');
      return {
        id: payload.mongoId,
        camera: payload.camera,
        timestamp: payload.timestamp,
        summary: payload.summary,
        filepath: payload.filepath,
        filename: filename,
        score: result.score,
      };
    });

    // 6. Return response
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
