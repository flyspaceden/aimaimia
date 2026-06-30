import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('notification seed data', () => {
  const seedSource = readFileSync(resolve(__dirname, '../prisma/seed.ts'), 'utf8');

  it('seeds canonical NotificationMessage rows instead of legacy InboxMessage rows', () => {
    expect(seedSource).toContain('prisma.notificationMessage.upsert');
    expect(seedSource).not.toContain('prisma.inboxMessage.upsert');
  });

  it('does not seed stale message routes', () => {
    expect(seedSource).not.toContain('/me/bookings');
    expect(seedSource).not.toContain('/me/rewards');
  });
});
