import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import OpenAI from 'openai';
import { AIService } from './types';
import { formatClipContextSummary } from '../yoloSummary';

const execAsync = promisify(exec);

export class OpenAIService implements AIService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Helper to extract frames from a video clip using FFmpeg
   */
  private async extractFrames(filepath: string, fps: number = 1): Promise<string[]> {
    if (!fs.existsSync(filepath)) {
      throw new Error(`Video file not found for frame extraction: ${filepath}`);
    }

    const tempDir = path.join(path.dirname(filepath), `frames_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    try {
      console.log(`[OpenAI Video Prep] Extracting frames to: ${tempDir}`);
      const outputPattern = path.join(tempDir, 'frame_%03d.jpg');
      
      // Extract frames at specified fps (1 frame/sec by default)
      // -q:v 2 sets high-quality JPEG output
      await execAsync(`ffmpeg -i "${filepath}" -vf "fps=${fps}" -q:v 2 "${outputPattern}"`);

      const files = fs.readdirSync(tempDir)
        .filter(file => file.endsWith('.jpg'))
        .sort();

      console.log(`[OpenAI Video Prep] Extracted ${files.length} frames.`);

      const base64Frames = files.map(file => {
        const fullPath = path.join(tempDir, file);
        const data = fs.readFileSync(fullPath);
        return data.toString('base64');
      });

      return base64Frames;
    } catch (error) {
      console.error('[OpenAI Video Prep] Error during frame extraction:', error);
      throw error;
    } finally {
      // Clean up extracted image frames
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
          console.log(`[OpenAI Video Prep] Cleaned up temporary frames directory.`);
        }
      } catch (cleanupError) {
        console.error(`[OpenAI Video Prep] Failed to clean up temp frames dir:`, cleanupError);
      }
    }
  }

  /**
   * Extracts frames from the local video clip and utilizes OpenAI GPT-4o-mini
   * to analyze the visual sequence and generate a text summary.
   */
  async summarizeVideo(filepath: string, cameraName: string): Promise<string> {
    console.log(`[OpenAI] Preparing video clip for summary: ${filepath}`);
    
    // 1. Extract video frames as base64 images
    const base64Frames = await this.extractFrames(filepath, 1);
    if (base64Frames.length === 0) {
      throw new Error('No frames could be extracted from the video.');
    }

    console.log(`[OpenAI] Sending ${base64Frames.length} frames to GPT-4o-mini for summarization...`);

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    try {
      // 2. Query OpenAI Chat Completion with images
      const response = await this.openai.chat.completions.create({
        model: model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `You are an expert AI video surveillance assistant monitoring a stream named "${cameraName}". 
Analyze this sequence of frames from a 10-second security video clip. 
Summarize what happens in the video in a concise paragraph (2-4 sentences). 
Include specific details such as:
- Any motion or changes detected.
- Objects, people, animals, or vehicles that appear.
- Actions taken (e.g., a person walking, a door opening, a car driving by).
- For each person clearly visible, include searchable visual attributes when discernible: approximate age group (child, teen, adult, elderly), perceived gender presentation, clothing colors and types (e.g., red jacket, blue jeans), and accessories (hat, backpack, bag).
- For each vehicle clearly visible, include searchable attributes when discernible: color, type/body style (sedan, SUV, truck, van, motorcycle, bicycle), and distinguishing features (e.g., roof rack, trailer, license plate visible).
Be objective, precise, and descriptive. Only state attributes you can reasonably infer from visible appearance; use cautious wording when uncertain. Do not assume context not shown in the video.`
              },
              ...base64Frames.map(frame => ({
                type: 'image_url' as const,
                image_url: {
                  url: `data:image/jpeg;base64,${frame}`,
                  detail: 'low' as const // 85 tokens per frame, optimal for speed/cost
                }
              }))
            ]
          }
        ]
      });

      const summary = response.choices[0].message?.content || 'No summary could be generated.';
      console.log(`[OpenAI] Summary generated: "${summary}"`);
      return summary;
    } catch (error) {
      console.error('[OpenAI] Error generating video summary:', error);
      throw error;
    }
  }

  /**
   * Generates a vector embedding for a given text using OpenAI's embedding API.
   * Resizes output to 768 dimensions if text-embedding-3 models are used.
   */
  async generateTextEmbedding(text: string): Promise<number[]> {
    console.log(`[OpenAI] Generating embedding for text: "${text.substring(0, 40)}..."`);
    
    const model = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
    const params: any = {
      model,
      input: text,
    };
    
    // text-embedding-3-small and text-embedding-3-large allow dimensions reduction
    if (model.startsWith('text-embedding-3')) {
      params.dimensions = 768;
    }

    try {
      const response = await this.openai.embeddings.create(params);
      if (response.data && response.data.length > 0 && response.data[0].embedding) {
        return response.data[0].embedding;
      }
      throw new Error('Could not parse embedding values from response structure.');
    } catch (error) {
      console.error('[OpenAI] Error generating text embedding:', error);
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

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    try {
      const response = await this.openai.chat.completions.create({
        model: model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      return response.choices[0].message?.content || 'Could not formulate an answer.';
    } catch (error) {
      console.error('[OpenAI] Error answering question with context:', error);
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
    const systemMessage = {
      role: 'system',
      content: `You are an AI video surveillance analyst dashboard.
The user is asking a question about the security camera recordings.
The current system time is ${currentLocalTime}. Use this reference to resolve relative timestamps like "yesterday", "today", "last 2 hours", "8:00 AM", etc. into absolute ISO-8601 strings.
You have access to two tools:
1. 'searchQdrant' — searches the video clip summaries database for events and activity descriptions. Use this when the user asks about what happened, what activity was recorded, or asks for specific scene descriptions.
2. 'searchReidDetections' — queries the raw person/vehicle REID detection records (individual frames where a person or vehicle was detected). Use this when the user asks about how many people were detected, whether someone was present, which cameras detected people or vehicles, or asks about detection counts and presence over a time window.
You may call both tools if the question requires both video context and detection data.
If the query implies a time filter, resolve it to absolute ISO-8601 strings.
Answer the user's question accurately and objectively using only the retrieved data.
If the search returns no results, state that clearly.
Cite the relevant sources (e.g. "[Clip 1]", "[Detection 1]") in your response where appropriate. Keep the answer concise and helpful.`
    };

    const messages: any[] = [
      systemMessage,
      ...history.map(h => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: h.content
      })),
      { role: 'user', content: question }
    ];

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    console.log('[OpenAI] Requesting answer with tools...');

    try {
      const response = await this.openai.chat.completions.create({
        model: model,
        messages: messages,
        tools: [
          {
            type: 'function',
            function: {
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
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'searchReidDetections',
              description: 'Query raw REID person/vehicle detection records from the database. Use this for counting detections, checking presence of people or vehicles on specific cameras, or getting detection statistics over a time window.',
              parameters: {
                type: 'object',
                properties: {
                  cameraName: {
                    type: 'string',
                    description: 'Filter detections to a specific camera by name (optional). Leave unset to search across all cameras.'
                  },
                  className: {
                    type: 'string',
                    description: 'Filter by object class: "person" or "vehicle" (optional). Leave unset for all classes.'
                  },
                  startTime: {
                    type: 'string',
                    description: 'ISO-8601 string for the start of the time window (optional).'
                  },
                  endTime: {
                    type: 'string',
                    description: 'ISO-8601 string for the end of the time window (optional).'
                  }
                },
                required: []
              }
            }
          }
        ]
      });

      let finalAnswer = '';
      let clips: any[] = [];
      let reidDetections: any[] = [];

      const choice = response.choices[0];
      const message = choice.message;

      if (message.tool_calls && message.tool_calls.length > 0) {
        // Process all tool calls and build responses
        const toolMessages: any[] = [];

        for (const toolCall of message.tool_calls as any[]) {
          if (!toolCall.function) continue;
          const args = JSON.parse(toolCall.function.arguments || '{}');

          if (toolCall.function.name === 'searchQdrant') {
            const queryText = args.queryText;
            const toolStartTime = args.startTime;
            const toolEndTime = args.endTime;
            console.log(`[OpenAI Tool Call] searchQdrant: "${queryText}", startTime: "${toolStartTime}", endTime: "${toolEndTime}"`);

            const searchResults = await searchQdrantFn(queryText, toolStartTime, toolEndTime);
            clips = searchResults;

            const contexts = searchResults.map((result: any, i: number) => {
              const payload = result.payload;
              return `[Clip ${i + 1}]: Time: ${payload.timestamp}, Camera: ${payload.camera}, Summary: ${formatClipContextSummary(payload)}`;
            });
            const contextText = contexts.length > 0 ? contexts.join('\n\n') : 'No matching clips found in database.';

            toolMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: contextText
            });

          } else if (toolCall.function.name === 'searchReidDetections') {
            const cameraName = args.cameraName;
            const className = args.className;
            const toolStartTime = args.startTime;
            const toolEndTime = args.endTime;
            console.log(`[OpenAI Tool Call] searchReidDetections: camera="${cameraName}", class="${className}", startTime="${toolStartTime}", endTime="${toolEndTime}"`);

            const reidResults = await searchReidFn(cameraName, className, toolStartTime, toolEndTime);
            reidDetections = reidResults;

            let reidContext: string;
            if (reidResults.length === 0) {
              reidContext = 'No REID detections found matching the criteria.';
            } else {
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

            toolMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: reidContext
            });
          }
        }

        // Append assistant message + all tool responses then get final answer
        const secondMessages = [
          ...messages,
          message,
          ...toolMessages
        ];

        console.log('[OpenAI] Resubmitting tool response(s) to get final answer...');
        const secondResponse = await this.openai.chat.completions.create({
          model: model,
          messages: secondMessages
        });

        finalAnswer = secondResponse.choices[0].message?.content || 'Could not formulate an answer.';
      } else {
        console.log('[OpenAI] Model responded directly without calling a tool.');
        finalAnswer = message.content || 'Could not formulate an answer.';
      }

      return { answer: finalAnswer, clips, reidDetections };
    } catch (error) {
      console.error('[OpenAI] Error answering with tools:', error);
      throw error;
    }
  }
}
