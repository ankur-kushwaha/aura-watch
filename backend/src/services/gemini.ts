import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';

// Initialize the Google Gen AI SDK client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

/**
 * Uploads a local video file to Gemini, polls until it is processed,
 * and generates a structured summary of the video content.
 */
export async function summarizeVideo(filepath: string, cameraName: string): Promise<string> {
  if (!fs.existsSync(filepath)) {
    throw new Error(`Video file not found at path: ${filepath}`);
  }

  console.log(`[Gemini] Starting video upload for: ${filepath}`);
  
  // 1. Upload the video file
  const uploadResult = await ai.files.upload({
    file: filepath,
    config: {
      mimeType: 'video/mp4',
    }
  });
  
  const fileId = uploadResult.name;
  if (!fileId) {
    throw new Error('Failed to upload video to Gemini - file identifier name is missing.');
  }
  console.log(`[Gemini] Uploaded successfully, file reference ID: ${fileId}. Waiting for processing...`);

  // 2. Poll until the file state is ACTIVE
  let fileInfo = await ai.files.get({ name: fileId });
  let attempts = 0;
  const maxAttempts = 24; // 2 minutes max
  
  while (fileInfo.state === 'PROCESSING' && attempts < maxAttempts) {
    console.log(`[Gemini] Processing state: ${fileInfo.state}. Waiting 5 seconds...`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    fileInfo = await ai.files.get({ name: fileId });
    attempts++;
  }

  if (!fileInfo.state) {
    throw new Error(`Gemini video processing state is missing.`);
  }

  if (fileInfo.state !== 'ACTIVE') {
    // If it failed or timed out, attempt cleanup and throw
    try {
      await ai.files.delete({ name: fileId });
    } catch (e) {}
    throw new Error(`Gemini video processing failed or timed out. State: ${fileInfo.state}`);
  }

  console.log(`[Gemini] Video is active. Requesting summary...`);

  try {
    // 3. Generate content from the video
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { fileData: { fileUri: fileInfo.uri!, mimeType: fileInfo.mimeType! } },
            {
              text: `You are an expert AI video surveillance assistant monitoring a stream named "${cameraName}". 
Analyze this 10-second security video clip. 
Summarize what happens in the video in a concise paragraph (2-4 sentences). 
Include specific details such as:
- Any motion or changes detected.
- Objects, people, animals, or vehicles that appear.
- Actions taken (e.g., a person walking, a door opening, a car driving by).
- Lighting changes or environment details.
Be objective, precise, and descriptive. Do not assume context not shown in the video.`
            }
          ]
        }
      ]
    });

    const summary = response.text || 'No summary could be generated.';
    console.log(`[Gemini] Summary generated: "${summary}"`);
    
    return summary;
  } finally {
    // 4. Cleanup the file from Gemini storage
    try {
      console.log(`[Gemini] Cleaning up file reference ${fileId} from Gemini storage...`);
      await ai.files.delete({ name: fileId });
    } catch (cleanupError) {
      console.error(`[Gemini] Failed to delete file reference ${fileId} from Gemini:`, cleanupError);
    }
  }
}

/**
 * Generates a vector embedding for a given text summary using Gemini's text-embedding-004 model.
 * Vector dimension will be 768.
 */
export async function generateTextEmbedding(text: string): Promise<number[]> {
  console.log(`[Gemini] Generating embedding for text: "${text.substring(0, 40)}..."`);
  
  try {
    const response = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: text,
      config: {
        outputDimensionality: 768,
      }
    });

    // Check embeddings array in the response
    if (response.embeddings && response.embeddings.length > 0 && response.embeddings[0].values) {
      return response.embeddings[0].values;
    }
    
    // Fallback if returned in another structure
    const fallbackEmbedding = (response as any).embedding;
    if (fallbackEmbedding && fallbackEmbedding.values) {
      return fallbackEmbedding.values;
    }

    throw new Error('Could not parse embedding values from response structure.');
  } catch (error) {
    console.error('[Gemini] Error generating text embedding:', error);
    throw error;
  }
}

/**
 * Answer a question using retrieved summaries as context (RAG).
 */
export async function answerQuestionWithContext(question: string, contexts: string[]): Promise<string> {
  const contextText = contexts.map((c, i) => `[Clip ${i + 1}]: ${c}`).join('\n\n');
  
  const prompt = `You are an AI video surveillance analyst dashboard.
The user is asking a question about the security camera recordings: "${question}".

Below are the relevant video clip summaries retrieved from the database based on the user's query:
---
${contextText}
---

Answer the user's question accurately and objectively using only the retrieved summaries. 
If the summaries do not contain enough information to answer the question, state that you cannot answer it with the current clips, but mention what you did find.
Cite the relevant Clips (e.g. "[Clip 1]", "[Clip 2]") in your response where appropriate. Keep the answer concise and helpful.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text || 'Could not formulate an answer.';
  } catch (error) {
    console.error('[Gemini] Error answering question with context:', error);
    throw error;
  }
}
