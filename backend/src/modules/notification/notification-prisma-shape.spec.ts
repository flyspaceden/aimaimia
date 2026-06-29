import { PrismaClient } from '@prisma/client';

describe('notification prisma client shape', () => {
  it('exposes notification models', () => {
    const prisma = new PrismaClient();

    expect(prisma.notificationOutbox).toBeDefined();
    expect(prisma.notificationMessage).toBeDefined();

    void prisma.$disconnect();
  });
});
