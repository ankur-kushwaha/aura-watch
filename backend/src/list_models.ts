import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env
dotenv.config({ path: path.join(__dirname, '../.env') });

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function main() {
  console.log('Listing available models for API key...');
  const response = await ai.models.list();
  for await (const m of response) {
    console.log(`- ${m.name}`);
  }
}

main().catch(console.error);
