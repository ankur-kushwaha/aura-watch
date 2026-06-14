/**
 * One-time migration: confirm -> same, reject -> different
 * Run: npx ts-node scripts/migrate-reid-feedback-types.ts
 */
import prisma from '../src/services/db';

async function main() {
  const result = await prisma.$runCommandRaw({
    update: 'ReidFeedback',
    updates: [
      { q: { type: 'confirm' }, u: { $set: { type: 'same' } }, multi: true },
      { q: { type: 'reject' }, u: { $set: { type: 'different' } }, multi: true },
    ],
  }) as { n?: number; nModified?: number };

  console.log('Migration complete:', result);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
