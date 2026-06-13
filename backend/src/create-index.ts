import dotenv from 'dotenv';
import * as path from 'path';
import { createQdrantClientFromEnv } from './services/qdrantClient';

// Load environment variables
dotenv.config();

const qdrant = createQdrantClientFromEnv();

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

  console.log(`Ensuring payload index for 'classNames' (keyword) exists...`);
  await qdrant.createPayloadIndex(COLLECTION_NAME, {
    field_name: 'classNames',
    field_schema: 'keyword',
    wait: true,
  });

  console.log(`Ensuring payload index for 'personCount' (integer) exists...`);
  await qdrant.createPayloadIndex(COLLECTION_NAME, {
    field_name: 'personCount',
    field_schema: 'integer',
    wait: true,
  });

  console.log(`Ensuring payload index for 'hasVehicle' (bool) exists...`);
  await qdrant.createPayloadIndex(COLLECTION_NAME, {
    field_name: 'hasVehicle',
    field_schema: 'bool',
    wait: true,
  });

  console.log(`Ensuring payload index for 'clothingColors' (keyword) exists...`);
  await qdrant.createPayloadIndex(COLLECTION_NAME, {
    field_name: 'clothingColors',
    field_schema: 'keyword',
    wait: true,
  });

  console.log(`Payload indexes successfully created and verified!`);
}

main().catch((err) => {
  console.error('Failed to create indexes:', err);
  process.exit(1);
});
