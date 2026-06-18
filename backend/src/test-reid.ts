import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
dotenv.config();

import { initQdrant, upsertReidVector, searchReidVectors, deleteReidVector } from './services/qdrant';
import prisma from './services/db';

function generateEdgeEmbedding(imagePath: string): number[] {
  const edgeDir = path.join(__dirname, '../../edge');
  const edgePython = process.env.EDGE_PYTHON
    || (fs.existsSync(path.join(edgeDir, '.venv/bin/python'))
      ? path.join(edgeDir, '.venv/bin/python')
      : 'python3');

  const script = `import json, sys; sys.path.insert(0, ${JSON.stringify(edgeDir)}); from reid_embedder import ReidEmbedder; print("EMB_START" + json.dumps(ReidEmbedder().generate_from_path(${JSON.stringify(imagePath)})) + "EMB_END")`;

  const output = execSync(`${edgePython} -c ${JSON.stringify(script)}`, { encoding: 'utf8' }).trim();
  const match = output.match(/EMB_START([\s\S]*?)EMB_END/);
  if (!match) {
    throw new Error(`Could not find embedding in python output: ${output}`);
  }
  const embedding = JSON.parse(match[1]);
  if (!Array.isArray(embedding) || embedding.length !== 512) {
    throw new Error(`Edge embedder returned invalid embedding: ${output.slice(0, 120)}`);
  }
  return embedding;
}

async function runTest() {
  console.log('=== Start ReID End-to-End Test (edge embeddings) ===');

  const tempDir = path.join(__dirname, '../storage/crops');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const testImagePath = path.join(tempDir, 'test_reid_target.jpg');
  const edgePython = process.env.EDGE_PYTHON
    || (fs.existsSync(path.join(__dirname, '../../edge/.venv/bin/python'))
      ? path.join(__dirname, '../../edge/.venv/bin/python')
      : 'python3');
  execSync(`${edgePython} -c "import cv2, numpy as np; img = np.zeros((256, 128, 3), dtype=np.uint8); cv2.imwrite('${testImagePath.replace(/'/g, "\\'")}', img)"`);
  console.log(`Created mock crop image at ${testImagePath}`);

  console.log('Generating embedding via edge OSNet...');
  const embedding = generateEdgeEmbedding(testImagePath);
  console.log(`Generated embedding: length = ${embedding.length}, first 5 elements:`, embedding.slice(0, 5));
  console.log('✔ Edge embedding generation successful!');

  console.log('Initializing Qdrant...');
  await initQdrant();

  console.log('Saving mock detection to DB...');
  const detection = await prisma.reidDetection.create({
    data: {
      deviceId: 'test_dev_01',
      cameraName: 'Gate',
      trackId: 101,
      timestamp: new Date(),
      filename: 'test_reid_target.jpg',
      bbox: '50,100,120,240',
      className: 'person',
    },
  });

  console.log('Indexing vector in Qdrant...');
  await upsertReidVector(detection.id, embedding, {
    deviceId: 'test_dev_01',
    cameraName: 'Gate',
    trackId: 101,
    timestamp: detection.timestamp.toISOString(),
    filename: 'test_reid_target.jpg',
    bbox: '50,100,120,240',
    className: 'person',
  });

  console.log('Seeding mock topology...');
  await prisma.topologyRoute.deleteMany({
    where: { fromCamera: 'Gate', toCamera: 'Lobby' },
  });
  const route = await prisma.topologyRoute.create({
    data: {
      fromCamera: 'Gate',
      toCamera: 'Lobby',
      minTimeSeconds: 5,
      maxTimeSeconds: 300,
      topologyScore: 1.0,
    },
  });

  const candidates = await searchReidVectors(embedding, 5);
  console.log(`Search returned ${candidates.length} matches`);

  await prisma.reidDetection.delete({ where: { id: detection.id } });
  await deleteReidVector(detection.id);
  await prisma.topologyRoute.delete({ where: { id: route.id } });

  if (fs.existsSync(testImagePath)) {
    fs.unlinkSync(testImagePath);
  }

  console.log('=== ReID End-to-End Test Passed Successfully ===');
  process.exit(0);
}

runTest().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
