import { GeminiService } from './gemini';
import { OpenAIService } from './openai';
import { AIService } from './types';

const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
let activeService: AIService;

console.log(`[AI Factory] Initializing AI Service Provider: ${provider.toUpperCase()}`);

if (provider === 'openai') {
  activeService = new OpenAIService();
} else {
  activeService = new GeminiService();
}

// Export the functions bound to the active service instance
export const summarizeVideo = activeService.summarizeVideo.bind(activeService);
export const generateTextEmbedding = activeService.generateTextEmbedding.bind(activeService);
export const answerQuestionWithContext = activeService.answerQuestionWithContext.bind(activeService);
export const answerWithTools = activeService.answerWithTools.bind(activeService);
