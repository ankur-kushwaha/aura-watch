import * as gemini from './gemini';
import * as openai from './openai';
import * as openrouter from './openrouter';

const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

const modules = {
  openai,
  openrouter,
  gemini,
} as const;

const activeModule =
  provider === 'openai'
    ? modules.openai
    : provider === 'openrouter'
      ? modules.openrouter
      : modules.gemini;

console.log(`[AI Factory] Initializing AI Service Provider: ${provider.toUpperCase()}`);

export const activeService = activeModule.service;
export const summarizeVideo = activeModule.summarizeVideo;
export const generateTextEmbedding = activeModule.generateTextEmbedding;
export const answerQuestionWithContext = activeModule.answerQuestionWithContext;
export const answerWithTools = activeModule.answerWithTools;
