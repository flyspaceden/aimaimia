import {
  NotificationAudience,
  NotificationRecipientKind,
  NotificationSeverity,
  Prisma,
  PrismaClient,
} from '@prisma/client';

export type LegacyInboxRow = {
  id: string;
  userId: string;
  category: string;
  type: string;
  title: string;
  content: string;
  unread: boolean;
  target: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LegacyNotificationAction = {
  routeKey?: string;
  route?: string;
  params?: Record<string, string>;
};

export type MigrateInboxDeps = {
  findLegacyInboxRows: () => Promise<LegacyInboxRow[]>;
  upsertNotificationMessage: (
    recipientKey: string,
    idempotencyKey: string,
    create: Prisma.NotificationMessageUncheckedCreateInput,
  ) => Promise<unknown>;
};

let prisma: PrismaClient | undefined;

const getPrismaClient = () => {
  prisma ??= new PrismaClient();
  return prisma;
};

const normalizeParams = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const params: Record<string, string> = {};
  for (const [key, paramValue] of Object.entries(value)) {
    if (typeof paramValue === 'string' && paramValue.length > 0) {
      params[key] = paramValue;
    }
  }
  return Object.keys(params).length > 0 ? params : undefined;
};

const routeId = (route: string, params?: Record<string, string>) => {
  if (params?.id) return params.id;
  const segments = route.split('/').filter(Boolean);
  return segments.length >= 2 ? segments.at(-1) : undefined;
};

const action = (
  routeKey: string,
  params?: Record<string, string>,
): LegacyNotificationAction => (params ? { routeKey, params } : { routeKey });

const actionWithId = (
  routeKey: string,
  route: string,
  params?: Record<string, string>,
) => {
  const id = routeId(route, params);
  return id ? action(routeKey, { id }) : undefined;
};

export function legacyRouteToAction(target: Prisma.JsonValue | null): LegacyNotificationAction | undefined {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return undefined;
  const routeKey = typeof target.routeKey === 'string' ? target.routeKey : undefined;
  const route = typeof target.route === 'string' ? target.route : undefined;
  const params = normalizeParams(target.params);

  if (routeKey) return action(routeKey, params);
  if (!route) return undefined;

  if (route === '/orders/track') return action('ORDER_TRACK', params);
  if (route === '/orders/[id]' && params?.id) return action('ORDER_DETAIL', { id: params.id });
  if (route === '/orders/receiver-info/[id]' && params?.id) {
    return action('ORDER_RECEIVER_INFO', { id: params.id });
  }
  if (route.startsWith('/orders/receiver-info/')) {
    return actionWithId('ORDER_RECEIVER_INFO', route, params);
  }
  if (route.startsWith('/orders/after-sale-detail/')) {
    return actionWithId('AFTER_SALE_DETAIL', route, params);
  }
  if (route.startsWith('/orders/')) {
    return actionWithId('ORDER_DETAIL', route, params);
  }
  if (route === '/me/coupons') return action('COUPONS');
  if (route === '/me/wallet' || route === '/me/rewards') return action('WALLET');
  if (route === '/me/digital-assets') return action('DIGITAL_ASSETS');
  if (route.startsWith('/group-buy/')) {
    const activityId = routeId(route, params);
    return activityId ? action('GROUP_BUY_DETAIL', { activityId }) : undefined;
  }

  if (route.startsWith('/product/') || route.startsWith('/company/')) {
    return { route, ...(params ? { params } : {}) };
  }

  return undefined;
}

const normalizeCategory = (category: string) =>
  ['interaction', 'transaction', 'system', 'order', 'after_sale', 'wallet', 'group_buy', 'service', 'risk']
    .includes(category)
    ? category
    : 'system';

export function buildNotificationMessageCreateInput(
  row: LegacyInboxRow,
): Prisma.NotificationMessageUncheckedCreateInput {
  const recipientKey = `buyer:${row.userId}`;
  const idempotencyKey = `legacy-inbox:${row.id}`;
  const mappedAction = legacyRouteToAction(row.target);

  return {
    id: row.id,
    recipientKind: NotificationRecipientKind.BUYER_USER,
    recipientKey,
    audience: NotificationAudience.BUYER_APP,
    category: normalizeCategory(row.category),
    eventType: row.type || 'system.legacyInfo',
    title: row.title,
    body: row.content,
    severity: NotificationSeverity.INFO,
    entityType: 'legacyInbox',
    entityId: row.id,
    action: mappedAction as Prisma.InputJsonValue | undefined,
    idempotencyKey,
    readAt: row.unread ? null : row.updatedAt,
    createdAt: row.createdAt,
  };
}

const defaultDeps: MigrateInboxDeps = {
  findLegacyInboxRows: () =>
    getPrismaClient().inboxMessage.findMany({ orderBy: { createdAt: 'asc' } }),
  upsertNotificationMessage: (recipientKey, idempotencyKey, create) =>
    getPrismaClient().notificationMessage.upsert({
      where: {
        recipientKey_idempotencyKey: {
          recipientKey,
          idempotencyKey,
        },
      },
      update: {},
      create,
    }),
};

export async function runMigrateInboxToNotifications({
  deps = defaultDeps,
}: {
  deps?: MigrateInboxDeps;
} = {}) {
  const rows = await deps.findLegacyInboxRows();

  for (const row of rows) {
    const create = buildNotificationMessageCreateInput(row);
    await deps.upsertNotificationMessage(create.recipientKey, create.idempotencyKey, create);
  }

  console.log(`[migrate-inbox-to-notifications] migrated=${rows.length}`);
  return { migrated: rows.length };
}

if (require.main === module) {
  runMigrateInboxToNotifications()
    .catch((err) => {
      console.error('[migrate-inbox-to-notifications] migration failed', err);
      process.exitCode = 1;
    })
    .finally(() => prisma?.$disconnect());
}
