import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma, VisualAgentClientKeyStatus, VisualAgentClientStatus, VisualAgentTenantStatus } from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

const ID_PATTERN = /^[A-Za-z0-9._:-]{3,120}$/;
const ADAPTER_PATTERN = /^[A-Za-z0-9._:-]{3,120}$/;
const KEY_PATTERN = /^(vag_(?:live|test)_[a-f0-9]{12})_([A-Za-z0-9_-]{32,128})$/;

export type VisualAgentClientPrincipal = {
  tenantId: string;
  clientId: string;
  adapterNamespace: string;
  allowedAdapterTypes: string[];
  keyId: string;
};

type ProvisionInput = {
  tenantId: string;
  tenantName: string;
  clientId: string;
  clientName: string;
  adapterNamespace: string;
  allowedAdapterTypes: string[];
  metadata?: Prisma.InputJsonValue;
};

/**
 * The raw API key is deliberately absent from every read/list response. It is
 * generated in this process, stored as a verifier only, and returned exactly
 * once by `issueKey` to an authorized operator or provisioning workflow.
 */
@Injectable()
export class VisualAgentClientKeyService {
  constructor(private readonly prisma: PrismaService) {}

  async provisionClient(input: ProvisionInput) {
    this.assertProvisionInput(input);
    return this.prisma.$transaction(async (tx) => {
      await tx.visualAgentTenant.upsert({
        where: { id: input.tenantId },
        create: { id: input.tenantId, name: input.tenantName, status: VisualAgentTenantStatus.ACTIVE },
        update: { name: input.tenantName },
      });
      const sameNamespace = await tx.visualAgentClient.findUnique({
        where: { tenantId_adapterNamespace: { tenantId: input.tenantId, adapterNamespace: input.adapterNamespace } },
        select: { id: true },
      });
      if (sameNamespace && sameNamespace.id !== input.clientId) {
        throw new ConflictException('该租户的 Adapter namespace 已属于另一个 AI Visual Agent Client');
      }
      const existing = await tx.visualAgentClient.findUnique({ where: { id: input.clientId } });
      if (existing && (existing.tenantId !== input.tenantId || existing.adapterNamespace !== input.adapterNamespace)) {
        throw new ConflictException('AI Visual Agent Client ID 已绑定到另一个租户或 Adapter namespace');
      }
      const client = await tx.visualAgentClient.upsert({
        where: { id: input.clientId },
        create: {
          id: input.clientId,
          tenantId: input.tenantId,
          name: input.clientName,
          adapterNamespace: input.adapterNamespace,
          allowedAdapterTypes: input.allowedAdapterTypes,
          metadata: input.metadata,
          status: VisualAgentClientStatus.ACTIVE,
        },
        update: {
          name: input.clientName,
          allowedAdapterTypes: input.allowedAdapterTypes,
          metadata: input.metadata,
        },
      });
      return this.toClientResponse(client);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async issueKey(input: {
    clientId: string;
    environment: 'live' | 'test';
    expiresAt?: Date | null;
    issuedByOperatorId?: string | null;
  }) {
    if (!ID_PATTERN.test(input.clientId)) throw new ConflictException('AI Visual Agent Client ID 格式无效');
    if (input.expiresAt && input.expiresAt <= new Date()) throw new ConflictException('API Key 过期时间必须在未来');
    const client = await this.prisma.visualAgentClient.findUnique({
      where: { id: input.clientId },
      include: { tenant: { select: { status: true } } },
    });
    if (!client) throw new NotFoundException('AI Visual Agent Client 不存在');
    if (client.status !== VisualAgentClientStatus.ACTIVE || client.tenant.status !== VisualAgentTenantStatus.ACTIVE) {
      throw new ConflictException('AI Visual Agent Client 或租户未启用，不能签发 API Key');
    }
    // Key collisions are cryptographically negligible, but a unique index is
    // still the authority. Retrying never reveals an already stored raw key.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const keyPrefix = `vag_${input.environment}_${randomBytes(6).toString('hex')}`;
      const rawKey = `${keyPrefix}_${randomBytes(32).toString('base64url')}`;
      try {
        const key = await this.prisma.visualAgentClientKey.create({
          data: {
            clientId: client.id,
            keyPrefix,
            keyHash: this.keyHash(rawKey),
            status: VisualAgentClientKeyStatus.ACTIVE,
            expiresAt: input.expiresAt ?? null,
            issuedByOperatorId: input.issuedByOperatorId ?? null,
          },
        });
        return { key: rawKey, record: this.toKeyResponse(key) };
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002' || attempt === 2) throw error;
      }
    }
    throw new ConflictException('无法安全签发 AI Visual Agent API Key');
  }

  async listKeys(clientId: string) {
    const client = await this.prisma.visualAgentClient.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!client) throw new NotFoundException('AI Visual Agent Client 不存在');
    const keys = await this.prisma.visualAgentClientKey.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map((key) => this.toKeyResponse(key));
  }

  async revokeKey(clientId: string, keyId: string) {
    const revoked = await this.prisma.visualAgentClientKey.updateMany({
      where: { id: keyId, clientId, status: VisualAgentClientKeyStatus.ACTIVE },
      data: {
        status: VisualAgentClientKeyStatus.REVOKED,
        revokedAt: new Date(),
      },
    });
    if (revoked.count !== 1) throw new NotFoundException('可撤销的 AI Visual Agent API Key 不存在');
  }

  async authenticate(rawKey: string): Promise<VisualAgentClientPrincipal> {
    const parsed = KEY_PATTERN.exec(rawKey);
    if (!parsed) throw new UnauthorizedException('AI Visual Agent API Key 无效');
    const [keyPrefix] = parsed.slice(1);
    const now = new Date();
    const record = await this.prisma.visualAgentClientKey.findFirst({
      where: {
        keyPrefix,
        status: VisualAgentClientKeyStatus.ACTIVE,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        client: {
          is: {
            status: VisualAgentClientStatus.ACTIVE,
            tenant: { is: { status: VisualAgentTenantStatus.ACTIVE } },
          },
        },
      },
      include: { client: { select: { id: true, tenantId: true, adapterNamespace: true, allowedAdapterTypes: true } } },
    });
    if (!record || !this.safeHashEquals(record.keyHash, this.keyHash(rawKey))) {
      throw new UnauthorizedException('AI Visual Agent API Key 无效');
    }
    await this.prisma.visualAgentClientKey.updateMany({
      where: { id: record.id, status: VisualAgentClientKeyStatus.ACTIVE },
      data: { lastUsedAt: now },
    });
    return {
      tenantId: record.client.tenantId,
      clientId: record.client.id,
      adapterNamespace: record.client.adapterNamespace,
      allowedAdapterTypes: record.client.allowedAdapterTypes,
      keyId: record.id,
    };
  }

  assertAdapterAccess(principal: VisualAgentClientPrincipal, adapterType: string) {
    if (!ADAPTER_PATTERN.test(adapterType) || !principal.allowedAdapterTypes.includes(adapterType)) {
      throw new ForbiddenException('当前 AI Visual Agent Client 无权使用该 Adapter');
    }
  }

  private assertProvisionInput(input: ProvisionInput) {
    const fields = [input.tenantId, input.clientId, input.adapterNamespace];
    if (fields.some((field) => !ID_PATTERN.test(field))
      || !input.tenantName.trim() || !input.clientName.trim()
      || input.allowedAdapterTypes.length === 0
      || input.allowedAdapterTypes.some((adapter) => !ADAPTER_PATTERN.test(adapter))) {
      throw new ConflictException('AI Visual Agent Tenant/Client 配置不合法');
    }
    if (new Set(input.allowedAdapterTypes).size !== input.allowedAdapterTypes.length) {
      throw new ConflictException('AI Visual Agent Adapter 类型不能重复');
    }
  }

  private keyHash(rawKey: string) {
    return createHash('sha256').update(rawKey).digest('hex');
  }

  private safeHashEquals(left: string, right: string) {
    const leftBuffer = Buffer.from(left, 'hex');
    const rightBuffer = Buffer.from(right, 'hex');
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }

  private toClientResponse(client: {
    id: string; tenantId: string; name: string; adapterNamespace: string;
    allowedAdapterTypes: string[]; status: VisualAgentClientStatus;
  }) {
    return {
      id: client.id,
      tenantId: client.tenantId,
      name: client.name,
      adapterNamespace: client.adapterNamespace,
      allowedAdapterTypes: client.allowedAdapterTypes,
      status: client.status,
    };
  }

  private toKeyResponse(key: {
    id: string; clientId: string; keyPrefix: string; status: VisualAgentClientKeyStatus;
    expiresAt: Date | null; lastUsedAt: Date | null; revokedAt: Date | null; createdAt: Date;
  }) {
    return {
      id: key.id,
      clientId: key.clientId,
      keyPrefix: key.keyPrefix,
      status: key.status,
      expiresAt: key.expiresAt,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt,
      createdAt: key.createdAt,
    };
  }
}
