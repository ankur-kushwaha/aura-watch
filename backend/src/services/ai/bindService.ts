import { AIService } from './types';

export function bindAIServiceMethods<T extends AIService>(service: T) {
  return {
    service,
    summarizeVideo: service.summarizeVideo.bind(service),
    generateTextEmbedding: service.generateTextEmbedding.bind(service),
    answerQuestionWithContext: service.answerQuestionWithContext.bind(service),
    answerWithTools: service.answerWithTools.bind(service),
  };
}
