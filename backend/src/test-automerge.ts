import * as fs from 'fs';
import * as path from 'path';
import prisma from './services/db';
import { initQdrant, upsertReidVector, deleteReidVector, deleteIdentityPrototype } from './services/qdrant';
import { processReidTrackEventsFromClip } from './routes/reid';

async function runTest() {
  console.log('=== Start Same-Clip Local Merge Test ===');
  await initQdrant();

  const tempDir = path.join(__dirname, '../storage/crops');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // 1. Create mock device and stream
  const deviceId = 'test_device_merge_99';
  const streamId = 'test_stream_merge_99';

  await prisma.edgeDevice.upsert({
    where: { deviceId },
    create: { deviceId, name: 'Test Merge Device', status: 'Online' },
    update: { status: 'Online' },
  });

  await prisma.cameraStream.upsert({
    where: { streamId },
    create: { streamId, deviceId, name: 'Test Merge Stream' },
    update: {},
  });

  const clipStartMs = Date.now();
  const clipFilename = 'test_local_merge_clip.mp4';
  const trackIdA = 201;
  const trackIdB = 202;

  const timestampA = new Date(clipStartMs + 1000);
  const timestampB = new Date(clipStartMs + 2000);

  const filenameA = `crop_${timestampA.getTime()}_${deviceId}_${trackIdA}.jpg`;
  const filenameB = `crop_${timestampB.getTime()}_${deviceId}_${trackIdB}.jpg`;

  const cropPathA = path.join(tempDir, filenameA);
  const cropPathB = path.join(tempDir, filenameB);

  // Write empty mock files so processReidTrackEventsFromClip skips extractCropFromClip
  fs.writeFileSync(cropPathA, Buffer.alloc(0));
  fs.writeFileSync(cropPathB, Buffer.alloc(0));

  // Generate a mock 512-dim vector
  const vector = new Array(512).fill(0).map(() => Math.random());
  // Normalize vector
  const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  const normalizedVector = vector.map(v => v / norm);

  // Track events
  const mockTrackEvents = [
    {
      trackId: trackIdA,
      bbox: '0,0,100,100',
      offsetMs: 1000,
      confidence: 0.9,
      className: 'person',
      kind: 'reid' as const,
      embedding: normalizedVector,
    },
    {
      trackId: trackIdB,
      bbox: '0,0,100,100',
      offsetMs: 2000,
      confidence: 0.9,
      className: 'person',
      kind: 'reid' as const,
      embedding: normalizedVector,
    }
  ];

  // We need to create a dummy video clip in DB so linkDetectionsToClip doesn't fail
  await prisma.videoClip.create({
    data: {
      filename: clipFilename,
      filepath: 'mock_clip_path.mp4',
      camera: 'Test Merge Stream',
      deviceId,
      streamId,
      summary: 'Mock Clip',
      duration: 10.0,
    }
  });

  console.log('Running processReidTrackEventsFromClip...');
  const mergeResult = await processReidTrackEventsFromClip(
    'mock_clip_path.mp4',
    deviceId,
    streamId,
    clipStartMs,
    clipFilename,
    mockTrackEvents,
    640,
    480
  );

  console.log('Clip process result:', mergeResult);

  // Assertions
  if (mergeResult.failures.length > 0) {
    throw new Error(`Expected no failures in clip processing, got: ${JSON.stringify(mergeResult.failures)}`);
  }

  // Verify that the detections exist in the DB
  const detectionA = await prisma.reidDetection.findFirst({ where: { filename: filenameA } });
  const detectionB = await prisma.reidDetection.findFirst({ where: { filename: filenameB } });

  if (!detectionA || !detectionB) {
    throw new Error('Expected detections to be saved for both tracks');
  }

  const mappingA = await prisma.reidStreamTrackMapping.findUnique({
    where: { streamId_trackId: { streamId, trackId: trackIdA } }
  });
  const mappingB = await prisma.reidStreamTrackMapping.findUnique({
    where: { streamId_trackId: { streamId, trackId: trackIdB } }
  });

  if (!mappingA || !mappingB) {
    throw new Error('Expected stream track mappings to exist for both tracks');
  }

  if (mappingA.identityId !== mappingB.identityId) {
    throw new Error('Expected both tracks to be mapped to the same identity');
  }

  if (detectionA.identityId !== mappingA.identityId || detectionB.identityId !== mappingA.identityId) {
    throw new Error('Expected both detections to be linked to the same identity');
  }

  console.log('✔ ReID Same-Clip Local Merge Test Passed!');

  // Cleanup
  if (fs.existsSync(cropPathA)) fs.unlinkSync(cropPathA);
  if (fs.existsSync(cropPathB)) fs.unlinkSync(cropPathB);

  await deleteReidVector(detectionA.id);
  await deleteReidVector(detectionB.id);

  if (detectionA.identityId) {
    await deleteIdentityPrototype(detectionA.identityId);
    await prisma.reidIdentity.delete({ where: { id: detectionA.identityId } }).catch(() => {});
  }

  await prisma.reidStreamTrackMapping.deleteMany({
    where: { streamId },
  });
  await prisma.reidDetection.deleteMany({
    where: { streamId },
  });
  await prisma.videoClip.deleteMany({
    where: { filename: clipFilename },
  });
  await prisma.cameraStream.delete({
    where: { streamId },
  });
  await prisma.edgeDevice.delete({
    where: { deviceId },
  });

  console.log('Cleanup complete.');
  process.exit(0);
}

runTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
