import { GoogleGenAI, Type } from '@google/genai';
import * as fs from 'fs';
import { AIService } from './types';

export class GeminiService implements AIService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
  }

  /**
   * Uploads a local video file to Gemini, polls until it is processed,
   * and generates a structured summary of the video content.
   */
  async summarizeVideo(filepath: string, cameraName: string): Promise<string> {
    if (!fs.existsSync(filepath)) {
      throw new Error(`Video file not found at path: ${filepath}`);
    }

    console.log(`[Gemini] Starting video upload for: ${filepath}`);

    // 1. Upload the video file
    const uploadResult = await this.ai.files.upload({
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
    let fileInfo = await this.ai.files.get({ name: fileId });
    let attempts = 0;
    const maxAttempts = 24; // 2 minutes max

    while (fileInfo.state === 'PROCESSING' && attempts < maxAttempts) {
      console.log(`[Gemini] Processing state: ${fileInfo.state}. Waiting 5 seconds...`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      fileInfo = await this.ai.files.get({ name: fileId });
      attempts++;
    }

    if (!fileInfo.state) {
      throw new Error(`Gemini video processing state is missing.`);
    }

    if (fileInfo.state !== 'ACTIVE') {
      // If it failed or timed out, attempt cleanup and throw
      try {
        await this.ai.files.delete({ name: fileId });
      } catch (e) { }
      throw new Error(`Gemini video processing failed or timed out. State: ${fileInfo.state}`);
    }

    console.log(`[Gemini] Video is active. Requesting summary...`);

    try {
      // 3. Generate content from the video
      const response = await this.ai.models.generateContent({
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
        await this.ai.files.delete({ name: fileId });
      } catch (cleanupError) {
        console.error(`[Gemini] Failed to delete file reference ${fileId} from Gemini:`, cleanupError);
      }
    }
  }

  /**
   * Generates a vector embedding for a given text summary using Gemini's text-embedding-004 model.
   * Vector dimension will be 768.
   */
  async generateTextEmbedding(text: string): Promise<number[]> {
    console.log(`[Gemini] Generating embedding for text: "${text.substring(0, 40)}..."`);

    try {
      const response = await this.ai.models.embedContent({
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
  async answerQuestionWithContext(question: string, contexts: string[]): Promise<string> {
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
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      return response.text || 'Could not formulate an answer.';
    } catch (error) {
      console.error('[Gemini] Error answering question with context:', error);
      throw error;
    }
  }

  /**
   * Answers a user query by calling search tools if necessary, maintaining conversation history.
   */
  async answerWithTools(
    question: string,
    history: { role: 'user' | 'assistant'; content: string }[],
    searchQdrantFn: (queryText: string, startTime?: string, endTime?: string) => Promise<any[]>,
    searchReidFn: (cameraName?: string, className?: string, startTime?: string, endTime?: string) => Promise<any[]>
  ): Promise<{ answer: string; clips: any[]; reidDetections: any[] }> {
    const currentLocalTime = new Date().toISOString();
    const systemInstruction = `You are an AI video surveillance analyst dashboard.
The user is asking a question about the security camera recordings.
The current system time is ${currentLocalTime}. Use this reference to resolve relative timestamps like "yesterday", "today", "last 2 hours", "8:00 AM", etc. into absolute ISO-8601 strings.
You have access to two tools:
1. 'searchQdrant' — searches the video clip summaries database for events and activity descriptions. Use this when the user asks about what happened, what activity was recorded, or asks for specific scene descriptions.
2. 'searchReidDetections' — queries the raw person/vehicle REID detection records (individual frames where a person or vehicle was detected). Use this when the user asks about how many people were detected, whether someone was present, which cameras detected people or vehicles, or asks about detection counts and presence over a time window.
You may call both tools if the question requires both video context and detection data.
If the query implies a time filter, resolve it to absolute ISO-8601 strings.
Answer the user's question accurately and objectively using only the retrieved data.
If the search returns no results, state that clearly.
Cite the relevant sources (e.g. "[Clip 1]", "[Detection 1]") in your response where appropriate. Keep the answer concise and helpful.`;

    const contents: any[] = [
      ...history.map(h => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }]
      })),
      { role: 'user', parts: [{ text: question }] }
    ];

    console.log('[Gemini] Requesting answer with tools...');

    const searchToolDeclaration = {
      name: 'searchQdrant',
      description: 'Search the vector database or MongoDB fallback for video surveillance summaries matching the query.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          queryText: {
            type: Type.STRING,
            description: 'The search query/description of the video clip/event to search for.'
          },
          startTime: {
            type: Type.STRING,
            description: 'ISO-8601 string representing the start of the time range query filter (optional). Always resolve relative queries relative to current system time.'
          },
          endTime: {
            type: Type.STRING,
            description: 'ISO-8601 string representing the end of the time range query filter (optional). Always resolve relative queries relative to current system time.'
          }
        },
        required: ['queryText']
      }
    };

    const reidToolDeclaration = {
      name: 'searchReidDetections',
      description: 'Query raw REID person/vehicle detection records from the database. Use this for counting detections, checking presence of people or vehicles on specific cameras, or getting detection statistics over a time window.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          cameraName: {
            type: Type.STRING,
            description: 'Filter detections to a specific camera by name (optional). Leave unset to search across all cameras.'
          },
          className: {
            type: Type.STRING,
            description: 'Filter by object class: "person" or "vehicle" (optional). Leave unset for all classes.'
          },
          startTime: {
            type: Type.STRING,
            description: 'ISO-8601 string for the start of the time window (optional).'
          },
          endTime: {
            type: Type.STRING,
            description: 'ISO-8601 string for the end of the time window (optional).'
          }
        },
        required: []
      }
    };

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contents,
        config: {
          systemInstruction,
          tools: [{
            functionDeclarations: [searchToolDeclaration, reidToolDeclaration]
          }]
        }
      });

      let finalAnswer = '';
      let clips: any[] = [];
      let reidDetections: any[] = [];

      // Collect all tool calls from the model response (may be multiple parts)
      const candidate = response.candidates?.[0];
      const allParts = candidate?.content?.parts || [];
      const toolCallParts = allParts.filter((p: any) => p?.functionCall);

      if (toolCallParts.length > 0) {
        // Build tool responses for all requested tool calls
        const toolResponseParts: any[] = [];

        for (const toolPart of toolCallParts) {
          const call = toolPart.functionCall;
          if (!call) continue;

          if (call.name === 'searchQdrant') {
            const queryText = (call.args as any)?.queryText;
            const toolStartTime = (call.args as any)?.startTime;
            const toolEndTime = (call.args as any)?.endTime;
            console.log(`[Gemini Tool Call] searchQdrant: "${queryText}", startTime: "${toolStartTime}", endTime: "${toolEndTime}"`);

            const searchResults = await searchQdrantFn(queryText, toolStartTime, toolEndTime);
            clips = searchResults;

            const contexts = searchResults.map((result: any, i: number) => {
              const payload = result.payload;
              return `[Clip ${i + 1}]: Time: ${payload.timestamp}, Camera: ${payload.camera}, Summary: ${payload.summary}`;
            });
            const contextText = contexts.length > 0 ? contexts.join('\n\n') : 'No matching clips found in database.';

            toolResponseParts.push({
              functionResponse: {
                name: 'searchQdrant',
                response: { result: contextText }
              }
            });

          } else if (call.name === 'searchReidDetections') {
            const cameraName = (call.args as any)?.cameraName;
            const className = (call.args as any)?.className;
            const toolStartTime = (call.args as any)?.startTime;
            const toolEndTime = (call.args as any)?.endTime;
            console.log(`[Gemini Tool Call] searchReidDetections: camera="${cameraName}", class="${className}", startTime="${toolStartTime}", endTime="${toolEndTime}"`);

            const reidResults = await searchReidFn(cameraName, className, toolStartTime, toolEndTime);
            reidDetections = reidResults;

            // Build a text summary of detections for the LLM
            let reidContext: string;
            if (reidResults.length === 0) {
              reidContext = 'No REID detections found matching the criteria.';
            } else {
              // Group by camera and class for a concise summary
              const grouped: Record<string, { person: number; vehicle: number; trackIds: Set<number> }> = {};
              for (const det of reidResults) {
                const cam = det.cameraName || 'Unknown';
                if (!grouped[cam]) grouped[cam] = { person: 0, vehicle: 0, trackIds: new Set() };
                if (det.className === 'vehicle') grouped[cam].vehicle++;
                else grouped[cam].person++;
                grouped[cam].trackIds.add(det.trackId);
              }
              const lines = Object.entries(grouped).map(([cam, stats], i) =>
                `[Detection ${i + 1}]: Camera: ${cam}, Persons detected: ${stats.person}, Vehicles detected: ${stats.vehicle}, Unique track IDs: ${stats.trackIds.size} (IDs: ${[...stats.trackIds].join(', ')})`
              );
              reidContext = lines.join('\n');
            }

            toolResponseParts.push({
              functionResponse: {
                name: 'searchReidDetections',
                response: { result: reidContext }
              }
            });
          }
        }

        // Re-submit with all tool responses at once
        const secondContents = [
          ...contents,
          {
            role: 'model',
            parts: toolCallParts
          },
          {
            role: 'tool',
            parts: toolResponseParts
          }
        ];

        console.log('[Gemini] Resubmitting tool response(s) to get final answer...');
        const secondResponse = await this.ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: secondContents,
          config: {
            systemInstruction,
            tools: [{
              functionDeclarations: [searchToolDeclaration, reidToolDeclaration]
            }]
          }
        });

        finalAnswer = secondResponse.text || 'Could not formulate an answer.';
      } else {
        console.log('[Gemini] Model responded directly without calling a tool.');
        finalAnswer = response.text || 'Could not formulate an answer.';
      }

      return { answer: finalAnswer, clips, reidDetections };
    } catch (error) {
      console.error('[Gemini] Error generating content with tools:', error);
      throw error;
    }
  }
}
