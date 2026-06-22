import prisma from './services/db';

async function main() {
  const result = await prisma.$runCommandRaw({
    update: "Notification",
    updates: [
      {
        q: { readAt: { $exists: false } },
        u: { $set: { readAt: null } },
        multi: true
      }
    ]
  });
  console.log('Raw update result:', result);

  const count = await prisma.notification.count({
    where: { readAt: null }
  });
  console.log('New unread count via Prisma query:', count);
}

main()
  .catch(err => console.error(err))
  .finally(() => prisma.$disconnect());
