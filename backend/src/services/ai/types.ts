export interface AIService {
  /**
   * Summarizes a 10-second security video clip.
   * @param filepath Absolute path to the local video file.
   * @param cameraName The name of the camera stream.
   * @returns A structured summary of the clip content.
   */
  summarizeVideo(filepath: string, cameraName: string): Promise<string>;

  /**
   * Generates a 768-dimensional text embedding for the given text.
   * @param text The input text to embed.
   * @returns An array of 768 floats.
   */
  generateTextEmbedding(text: string): Promise<number[]>;

  /**
   * Answers a user query using the provided context summaries.
   * @param question The user's natural language question.
   * @param contexts Array of clip summaries to use as grounding context.
   * @returns The generated answer.
   */
  answerQuestionWithContext(question: string, contexts: string[]): Promise<string>;

  /**
   * Answers a user query by calling search tools if necessary, maintaining conversation history.
   * @param question The user's current question.
   * @param history The conversation history.
   * @param searchQdrantFn Function to run Qdrant/MongoDB search query.
   */
  answerWithTools(
    question: string,
    history: { role: 'user' | 'assistant'; content: string }[],
    searchQdrantFn: (queryText: string, startTime?: string, endTime?: string) => Promise<any[]>
  ): Promise<{ answer: string; clips: any[] }>;
}
