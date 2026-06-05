import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import OpenAI from 'openai';
import { AIService } from './types';

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
- Lighting changes or environment details.
Be objective, precise, and descriptive. Do not assume context not shown in the video.`
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
}
