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
}
