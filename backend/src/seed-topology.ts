import prisma from './services/db';

async function seed() {
  console.log("Seeding default camera topology routes...");

  const routes = [
    {
      fromCamera: 'Gate',
      toCamera: 'Lobby',
      minTimeSeconds: 5,
      maxTimeSeconds: 300,
      topologyScore: 1.0
    },
    {
      fromCamera: 'Lobby',
      toCamera: 'Basement',
      minTimeSeconds: 10,
      maxTimeSeconds: 600,
      topologyScore: 0.8
    },
    {
      fromCamera: 'Gate',
      toCamera: 'Basement',
      minTimeSeconds: 15,
      maxTimeSeconds: 900,
      topologyScore: 0.6
    }
  ];

  for (const r of routes) {
    // Upsert route
    const existing = await prisma.topologyRoute.findFirst({
      where: {
        OR: [
          { fromCamera: r.fromCamera, toCamera: r.toCamera },
          { fromCamera: r.toCamera, toCamera: r.fromCamera }
        ]
      }
    });

    if (existing) {
      await prisma.topologyRoute.update({
        where: { id: existing.id },
        data: r
      });
      console.log(`Updated route ${r.fromCamera} <-> ${r.toCamera}`);
    } else {
      await prisma.topologyRoute.create({
        data: r
      });
      console.log(`Created route ${r.fromCamera} <-> ${r.toCamera}`);
    }
  }

  console.log("Seeding complete!");
  process.exit(0);
}

seed().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
