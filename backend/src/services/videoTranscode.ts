import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

/**
 * Transcode a clip for Gemini upload (lower fps/resolution). Returns path to use for summarization.
 */
export async function transcodeForGemini(inputPath: string): Promise<string> {
  if (process.env.GEMINI_OPTIMIZE?.toLowerCase() === 'false') {
    return inputPath;
  }

  const fps = process.env.GEMINI_OPTIMIZE_FPS || '1';
  const resolution = process.env.GEMINI_OPTIMIZE_RESOLUTION || '640:480';
  const crf = process.env.GEMINI_OPTIMIZE_CRF || '28';
  const outputPath = path.join(
    path.dirname(inputPath),
    `temp_gemini_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.mp4`,
  );

  await execAsync(
    `ffmpeg -y -i "${inputPath}" -vf "fps=${fps},scale=${resolution}" -c:v libx264 -preset veryfast -crf ${crf} -an "${outputPath}"`,
    { maxBuffer: 10 * 1024 * 1024 },
  );

  if (!fs.existsSync(outputPath)) {
    throw new Error('Gemini transcode produced no output file');
  }

  return outputPath;
}
