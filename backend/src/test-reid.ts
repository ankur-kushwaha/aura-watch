import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config();

import reidWorker from './services/reidWorker';
import { initQdrant, upsertReidVector, searchReidVectors, deleteReidVector } from './services/qdrant';
import prisma from './services/db';

async function runTest() {
  console.log("=== Start ReID End-to-End Test ===");

  const tempDir = path.join(__dirname, '../storage/crops');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Create a mock image file using python + cv2 to ensure it is valid and uncorrupted
  const testImagePath = path.join(tempDir, 'test_reid_target.jpg');
  const { execSync } = require('child_process');
  const pythonBin = process.env.REID_PYTHON
    || (fs.existsSync(path.join(__dirname, '../../.venv-reid/bin/python'))
      ? path.join(__dirname, '../../.venv-reid/bin/python')
      : 'python3');
  execSync(`${pythonBin} -c "import cv2, numpy as np; img = np.zeros((256, 128, 3), dtype=np.uint8); cv2.imwrite('${testImagePath.replace(/'/g, "\\'")}', img)"`);
  console.log(`Created mock crop image at ${testImagePath}`);

  // 1. Start ReID worker
  console.log("Starting ReID OSNet worker...");
  await reidWorker.start();

  // 2. Generate embedding
  console.log("Generating embedding...");
  const embedding = await reidWorker.generateEmbedding(testImagePath);
  console.log(`Generated embedding: length = ${embedding.length}, first 5 elements:`, embedding.slice(0, 5));

  if (embedding.length !== 512) {
    throw new Error(`Embedding size mismatch! Expected 512, got ${embedding.length}`);
  }
  console.log("✔ Embedding generation successful!");

  // 3. Initialize Qdrant collection
  console.log("Initializing Qdrant...");
  await initQdrant();

  // 4. Save metadata to MongoDB via Prisma
  console.log("Saving mock detection to DB...");
  const detection = await prisma.reidDetection.create({
    data: {
      deviceId: 'test_dev_01',
      cameraName: 'Gate',
      trackId: 101,
      timestamp: new Date(),
      filename: 'test_reid_target.jpg',
      bbox: '50,100,120,240',
      className: 'person'
    }
  });
  console.log(`Saved detection: ${detection.id}`);

  // 5. Index vector in Qdrant
  console.log("Indexing vector in Qdrant...");
  await upsertReidVector(detection.id, embedding, {
    deviceId: 'test_dev_01',
    cameraName: 'Gate',
    trackId: 101,
    timestamp: detection.timestamp.toISOString(),
    filename: 'test_reid_target.jpg',
    bbox: '50,100,120,240',
    className: 'person'
  });
  console.log("Indexed in Qdrant successfully!");

  // 6. Test topology rules & smart matching logic
  console.log("Seeding mock topology...");
  // Clear any pre-existing
  await prisma.topologyRoute.deleteMany({
    where: { fromCamera: 'Gate', toCamera: 'Lobby' }
  });
  const route = await prisma.topologyRoute.create({
    data: {
      fromCamera: 'Gate',
      toCamera: 'Lobby',
      minTimeSeconds: 5,
      maxTimeSeconds: 300,
      topologyScore: 1.0
    }
  });
  console.log("Created topology route:", route);

  // Search matches
  console.log("Testing search query matching...");
  const candidates = await searchReidVectors(embedding, 5);
  console.log(`Search returned ${candidates.length} matches:`);
  for (const cand of candidates) {
    const payload = cand.payload as any;
    console.log(`- Match ID: ${payload.mongoId}, Camera: ${payload.cameraName}, Score: ${cand.score}`);
  }

  // Cleanup test database entries
  console.log("Cleaning up database entries...");
  await prisma.reidDetection.delete({ where: { id: detection.id } });
  await deleteReidVector(detection.id);
  await prisma.topologyRoute.delete({ where: { id: route.id } });
  
  if (fs.existsSync(testImagePath)) {
    fs.unlinkSync(testImagePath);
  }

  console.log("Stopping ReID worker...");
  reidWorker.stop();

  console.log("=== ReID End-to-End Test Passed Successfully ===");
  process.exit(0);
}

runTest().catch((err) => {
  console.error("Test failed with error:", err);
  reidWorker.stop();
  process.exit(1);
});
