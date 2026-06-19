import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import OpenAI from 'openai';
import { bindAIServiceMethods } from './bindService';
import { AIService, Tool, ToolExecutionResult } from './types';
import { buildVideoAnalysisPrompt, normalizeAiSummaryJson } from './clipAiAnalysis';
import { formatClipContextSummary } from '../yoloSummary';

const execAsync = promisify(exec);

const CHAT_MODEL = 'openrouter/free';
const VIDEO_MODEL = 'google/gemma-4-26b-a4b-it';
const EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b';
const USE_NATIVE_VIDEO = true;
const MAX_FRAMES = 10;

export class OpenRouterService implements AIService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'https://camera-active.local',
        'X-Title': process.env.OPENROUTER_APP_NAME || 'Camera Active',
      },
    });
  }

  private getChatModel(): string {
    return CHAT_MODEL;
  }

  private getVideoModel(): string {
    return VIDEO_MODEL;
  }

  private getEmbeddingModel(): string {
    return EMBEDDING_MODEL;
  }

  private getOpenRouterHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'https://camera-active.local',
      'X-Title': process.env.OPENROUTER_APP_NAME || 'Camera Active',
    };
  }

  private async chatCompletion(
    model: string,
    messages: any[],
    options?: { tools?: any[]; jsonMode?: boolean },
  ): Promise<any> {
    const body: Record<string, unknown> = { model, messages };
    if (options?.tools) body.tools = options.tools;
    if (options?.jsonMode) body.response_format = { type: 'json_object' };

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: this.getOpenRouterHeaders(),
      body: JSON.stringify(body),
    });

    const data = await response.json() as any;
    if (!response.ok) {
      const error: any = new Error(data?.error?.message || `OpenRouter request failed (${response.status})`);
      error.status = response.status;
      error.code = data?.error?.code;
      throw error;
    }

    return data;
  }

  private encodeVideoToBase64(filepath: string): string {
    const data = fs.readFileSync(filepath);
    return `data:video/mp4;base64,${data.toString('base64')}`;
  }

  /**
   * Fallback: extract up to 10 frames as base64 images (provider limit).
   */
  private async extractFrames(filepath: string, maxFrames: number = MAX_FRAMES): Promise<string[]> {
    if (!fs.existsSync(filepath)) {
      throw new Error(`Video file not found for frame extraction: ${filepath}`);
    }

    const tempDir = path.join(path.dirname(filepath), `frames_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      console.log(`[OpenRouter Video Prep] Extracting up to ${maxFrames} frames to: ${tempDir}`);
      const outputPattern = path.join(tempDir, 'frame_%03d.jpg');
      await execAsync(`ffmpeg -i "${filepath}" -vf "fps=1" -frames:v ${maxFrames} -q:v 2 "${outputPattern}"`);

      const files = fs.readdirSync(tempDir)
        .filter(file => file.endsWith('.jpg'))
        .sort()
        .slice(0, maxFrames);

      console.log(`[OpenRouter Video Prep] Extracted ${files.length} frames.`);

      return files.map(file => {
        const fullPath = path.join(tempDir, file);
        return fs.readFileSync(fullPath).toString('base64');
      });
    } catch (error) {
      console.error('[OpenRouter Video Prep] Error during frame extraction:', error);
      throw error;
    } finally {
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
          console.log('[OpenRouter Video Prep] Cleaned up temporary frames directory.');
        }
      } catch (cleanupError) {
        console.error('[OpenRouter Video Prep] Failed to clean up temp frames dir:', cleanupError);
      }
    }
  }

  private async summarizeWithNativeVideo(filepath: string, cameraName: string, alertInstructions?: string[]): Promise<string> {
    const model = this.getVideoModel();
    const base64Video = this.encodeVideoToBase64(filepath);

    console.log(`[OpenRouter] Sending native video to ${model} for summarization...`);

    const data = await this.chatCompletion(model, [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildVideoAnalysisPrompt(cameraName, undefined, alertInstructions),
          },
          {
            type: 'video_url',
            video_url: {
              url: base64Video,
            },
          },
        ],
      },
    ], { jsonMode: true });

    const raw = data.choices[0].message?.content || '';
    return normalizeAiSummaryJson(raw);
  }

  private async summarizeWithFrames(filepath: string, cameraName: string, alertInstructions?: string[]): Promise<string> {
    const model = this.getVideoModel();
    const base64Frames = await this.extractFrames(filepath, MAX_FRAMES);
    if (base64Frames.length === 0) {
      throw new Error('No frames could be extracted from the video.');
    }

    console.log(`[OpenRouter] Sending ${base64Frames.length} frames to ${model} for summarization...`);

    const data = await this.chatCompletion(model, [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildVideoAnalysisPrompt(cameraName, undefined, alertInstructions),
          },
          ...base64Frames.map(frame => ({
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${frame}`,
              detail: 'low',
            },
          })),
        ],
      },
    ], { jsonMode: true });

    const raw = data.choices[0].message?.content || '';
    return normalizeAiSummaryJson(raw);
  }

  private shouldUseNativeVideo(): boolean {
    return USE_NATIVE_VIDEO;
  }

  private isVideoBalanceError(error: any): boolean {
    return error?.status === 402 || error?.code === 402;
  }

  /**
   * Summarizes a security video clip using a free OpenRouter vision/video model.
   * Tries native video input first (requires >= $1 OpenRouter account balance),
   * then falls back to up to 10 extracted frames.
   */
  async summarizeVideo(filepath: string, cameraName: string, alertInstructions?: string[]): Promise<string> {
    if (!fs.existsSync(filepath)) {
      throw new Error(`Video file not found at path: ${filepath}`);
    }

    console.log(`[OpenRouter] Preparing video clip for summary: ${filepath}`);

    if (this.shouldUseNativeVideo()) {
      try {
        const summary = await this.summarizeWithNativeVideo(filepath, cameraName, alertInstructions);
        console.log(`[OpenRouter] Summary generated via native video: "${summary}"`);
        return summary;
      } catch (nativeError: any) {
        if (this.isVideoBalanceError(nativeError)) {
          console.warn(
            '[OpenRouter] Native video requires >= $1 OpenRouter account balance (free models still apply). ' +
            'Falling back to frame extraction. Add credits at https://openrouter.ai/credits or set OPENROUTER_USE_NATIVE_VIDEO=false.'
          );
        } else {
          console.warn('[OpenRouter] Native video summarization failed, falling back to frame extraction:', nativeError);
        }
      }
    } else {
      console.log('[OpenRouter] Native video disabled (OPENROUTER_USE_NATIVE_VIDEO=false), using frame extraction.');
    }

    try {
      const summary = await this.summarizeWithFrames(filepath, cameraName, alertInstructions);
      console.log(`[OpenRouter] Summary generated via frames: "${summary}"`);
      return summary;
    } catch (frameError) {
      console.error('[OpenRouter] Error generating video summary:', frameError);
      throw frameError;
    }
  }

  /**
   * Generates a 768-dimensional text embedding via OpenRouter's embeddings API.
   */
  async generateTextEmbedding(text: string): Promise<number[]> {
    console.log(`[OpenRouter] Generating embedding for text: "${text.substring(0, 40)}..."`);

    const model = this.getEmbeddingModel();

    try {
      const response = await this.client.embeddings.create({
        model,
        input: text,
        dimensions: 768,
      });

      if (response.data && response.data.length > 0 && response.data[0].embedding) {
        return response.data[0].embedding;
      }
      throw new Error('Could not parse embedding values from response structure.');
    } catch (error) {
      console.error('[OpenRouter] Error generating text embedding:', error);
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

    const model = this.getChatModel();

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      return response.choices[0].message?.content || 'Could not formulate an answer.';
    } catch (error) {
      console.error('[OpenRouter] Error answering question with context:', error);
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
Cite the relevant sources (e.g. "[Clip 1]", "[Detection 1]") in your response where appropriate. Keep the answer concise and helpful.`,
    };

    const messages: any[] = [
      systemMessage,
      ...history.map(h => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: h.content,
      })),
      { role: 'user', content: question },
    ];

    const model = this.getChatModel();

    console.log('[OpenRouter] Requesting answer with tools...');

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages,
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
                    description: 'The search query/description of the video clip/event to search for.',
                  },
                  startTime: {
                    type: 'string',
                    description: 'ISO-8601 string representing the start of the time range query filter (optional). Always resolve relative queries relative to current system time.',
                  },
                  endTime: {
                    type: 'string',
                    description: 'ISO-8601 string representing the end of the time range query filter (optional). Always resolve relative queries relative to current system time.',
                  },
                },
                required: ['queryText'],
              },
            },
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
                    description: 'Filter detections to a specific camera by name (optional). Leave unset to search across all cameras.',
                  },
                  className: {
                    type: 'string',
                    description: 'Filter by object class: "person" or "vehicle" (optional). Leave unset for all classes.',
                  },
                  startTime: {
                    type: 'string',
                    description: 'ISO-8601 string for the start of the time window (optional).',
                  },
                  endTime: {
                    type: 'string',
                    description: 'ISO-8601 string for the end of the time window (optional).',
                  },
                },
                required: [],
              },
            },
          },
        ],
      });

      let finalAnswer = '';
      let clips: any[] = [];
      let reidDetections: any[] = [];

      const choice = response.choices[0];
      const message = choice.message;

      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolMessages: any[] = [];

        for (const toolCall of message.tool_calls as any[]) {
          if (!toolCall.function) continue;
          const args = JSON.parse(toolCall.function.arguments || '{}');

          if (toolCall.function.name === 'searchQdrant') {
            const queryText = args.queryText;
            const toolStartTime = args.startTime;
            const toolEndTime = args.endTime;
            console.log(`[OpenRouter Tool Call] searchQdrant: "${queryText}", startTime: "${toolStartTime}", endTime: "${toolEndTime}"`);

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
              content: contextText,
            });
          } else if (toolCall.function.name === 'searchReidDetections') {
            const cameraName = args.cameraName;
            const className = args.className;
            const toolStartTime = args.startTime;
            const toolEndTime = args.endTime;
            console.log(`[OpenRouter Tool Call] searchReidDetections: camera="${cameraName}", class="${className}", startTime="${toolStartTime}", endTime="${toolEndTime}"`);

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
              content: reidContext,
            });
          }
        }

        const secondMessages = [
          ...messages,
          message,
          ...toolMessages,
        ];

        console.log('[OpenRouter] Resubmitting tool response(s) to get final answer...');
        const secondResponse = await this.client.chat.completions.create({
          model,
          messages: secondMessages,
        });

        finalAnswer = secondResponse.choices[0].message?.content || 'Could not formulate an answer.';
      } else {
        console.log('[OpenRouter] Model responded directly without calling a tool.');
        finalAnswer = message.content || 'Could not formulate an answer.';
      }

      return { answer: finalAnswer, clips, reidDetections };
    } catch (error) {
      console.error('[OpenRouter] Error answering with tools:', error);
      throw error;
    }
  }

  /**
   * Answers a user query by calling the provided tools in a loop until the model
   * decides no further tools are needed.
   */
  async chatWithTools(
    question: string,
    history: { role: 'user' | 'assistant'; content: string }[],
    tools: Tool[],
    systemPrompt: string
  ): Promise<{ answer: string; toolResults: ToolExecutionResult[] }> {
    const systemMessage = {
      role: 'system',
      content: systemPrompt
    };

    const messages: any[] = [
      systemMessage,
      ...history.map(h => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: h.content,
      })),
      { role: 'user', content: question },
    ];

    const model = this.getChatModel();

    console.log('[OpenRouter] Requesting chat completion with looping tools...');

    let loop = true;
    let toolResults: ToolExecutionResult[] = [];
    let finalAnswer = '';
    let iterations = 0;
    const maxIterations = 10;

    try {
      while (loop && iterations < maxIterations) {
        iterations++;
        const response = await this.client.chat.completions.create({
          model,
          messages,
          tools: tools.length > 0 ? tools.map(t => ({
            type: 'function',
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            }
          })) : undefined
        });

        const choice = response.choices[0];
        const message = choice.message;

        // Push the assistant message (which might have tool_calls) to messages
        messages.push(message);

        if (message.tool_calls && message.tool_calls.length > 0) {
          for (const toolCall of message.tool_calls as any[]) {
            if (!toolCall.function) continue;
            const tool = tools.find(t => t.name === toolCall.function.name);
            if (!tool) {
              console.error(`[OpenRouter] Tool ${toolCall.function.name} not found in tools list`);
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `Error: Tool ${toolCall.function.name} not found.`
              });
              continue;
            }

            const args = JSON.parse(toolCall.function.arguments || '{}');
            console.log(`[OpenRouter Tool Loop] Executing tool ${tool.name} with args:`, args);

            try {
              const { resultForModel, rawData } = await tool.execute(args);
              toolResults.push({ toolName: tool.name, rawData });
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: resultForModel,
              });
            } catch (err: any) {
              console.error(`[OpenRouter Tool Loop] Error executing tool ${tool.name}:`, err);
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `Error executing tool: ${err.message || err}`,
              });
            }
          }
        } else {
          finalAnswer = message.content || 'Could not formulate an answer.';
          loop = false;
        }
      }

      if (iterations >= maxIterations && loop) {
        console.warn(`[OpenRouter] Reached maximum tool loop iterations (${maxIterations}). Terminating.`);
        const finalResponse = await this.client.chat.completions.create({
          model,
          messages,
        });
        finalAnswer = finalResponse.choices[0].message?.content || 'Could not formulate an answer.';
      }

      return { answer: finalAnswer, toolResults };
    } catch (error) {
      console.error('[OpenRouter] Error in chatWithTools loop:', error);
      throw error;
    }
  }
}

const {
  service,
  summarizeVideo,
  generateTextEmbedding,
  answerQuestionWithContext,
  answerWithTools,
  chatWithTools,
} = bindAIServiceMethods(new OpenRouterService());

export { service as openrouterService, service, summarizeVideo, generateTextEmbedding, answerQuestionWithContext, answerWithTools, chatWithTools };

