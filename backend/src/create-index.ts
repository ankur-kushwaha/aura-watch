import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config();

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const COLLECTION_NAME = 'video_clips';

async function main() {
  console.log(`Connecting to Qdrant at ${process.env.QDRANT_URL}...`);
  
  console.log(`Ensuring payload index for 'timestamp' (datetime) exists...`);
  await qdrant.createPayloadIndex(COLLECTION_NAME, {
    field_name: 'timestamp',
    field_schema: 'datetime',
    wait: true,
  });

  console.log(`Ensuring payload index for 'deviceId' (keyword) exists...`);
  await qdrant.createPayloadIndex(COLLECTION_NAME, {
    field_name: 'deviceId',
    field_schema: 'keyword',
    wait: true,
  });

  console.log(`Payload indexes successfully created and verified!`);
}

main().catch((err) => {
  console.error('Failed to create indexes:', err);
  process.exit(1);
});
