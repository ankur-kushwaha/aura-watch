import * as gemini from './gemini';
import * as openai from './openai';
import * as openrouter from './openrouter';

const modules = {
  openai,
  openrouter,
  gemini,
} as const;

type ProviderType = keyof typeof modules;

function getModuleForProvider(providerName: string): typeof modules[ProviderType] {
  const normalized = providerName.toLowerCase();
  if (normalized === 'openai') return modules.openai;
  if (normalized === 'openrouter') return modules.openrouter;
  return modules.gemini;
}

// Centralized configuration for AI providers used by different parts of the system.
// By defining these directly in code, we ensure consistency across the application
// (such as ensuring the same embedding model is used for storing and retrieving vectors).
export const VIDEO_SUMMARY_PROVIDER = 'openrouter';
export const RAG_EMBEDDING_PROVIDER = 'openrouter';
export const RAG_CHAT_PROVIDER = 'openai';

const videoModule = getModuleForProvider(VIDEO_SUMMARY_PROVIDER);
const embeddingModule = getModuleForProvider(RAG_EMBEDDING_PROVIDER);
const chatModule = getModuleForProvider(RAG_CHAT_PROVIDER);

console.log(`[AI Factory] Initializing AI Services:`);
console.log(`  - Video Summarization : ${VIDEO_SUMMARY_PROVIDER.toUpperCase()}`);
console.log(`  - Embeddings (RAG)    : ${RAG_EMBEDDING_PROVIDER.toUpperCase()}`);
console.log(`  - Q&A Chat (RAG)      : ${RAG_CHAT_PROVIDER.toUpperCase()}`);

export const activeService = chatModule.service;
export const summarizeVideo = videoModule.summarizeVideo;
export const generateTextEmbedding = embeddingModule.generateTextEmbedding;
export const answerQuestionWithContext = chatModule.answerQuestionWithContext;
export const answerWithTools = chatModule.answerWithTools;
