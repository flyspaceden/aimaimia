import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CAPTAIN_SEAFOOD_PROGRAM_CODE } from './captain.constants';

interface CreateCaptainProfileInput {
  userId: string;
  captainCode?: string;
  displayName?: string | null;
  adminUserId?: string | null;
}

interface BindBuyerToCaptainCodeInput {
  buyerUserId: string;
  captainCode: string;
  source?: string | null;
}

@Injectable()
export class CaptainRelationService {
  constructor(private readonly prisma: PrismaService) {}

  async createCaptainProfile(input: CreateCaptainProfileInput) {
    return this.prisma.$transaction(async (tx) => {
      return this.createCaptainProfileInTx(tx, input);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async createCaptainProfileInTx(
    tx: Prisma.TransactionClient,
    input: CreateCaptainProfileInput,
  ) {
    const captainCode = this.normalizeCaptainCode(input.captainCode || this.generateCaptainCode());

    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('用户不存在，无法开通团长');
    }

    const existingByUser = await tx.captainProfile.findUnique({
      where: { userId: input.userId },
    });
    if (existingByUser) {
      throw new BadRequestException('该用户已是团长');
    }

    const existingByCode = await tx.captainProfile.findUnique({
      where: { captainCode },
    });
    if (existingByCode) {
      throw new BadRequestException('团长码已存在');
    }

    const profile = await tx.captainProfile.create({
      data: {
        userId: input.userId,
        captainCode,
        programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
        displayName: input.displayName || null,
        status: 'ACTIVE',
        approvedAt: new Date(),
        createdByAdminId: input.adminUserId || null,
      },
    });

    await tx.captainAccount.upsert({
      where: {
        userId_programCode: {
          userId: input.userId,
          programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
        },
      },
      update: {},
      create: {
        userId: input.userId,
        programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
      },
    });

    return profile;
  }

  async bindBuyerToCaptainCode(input: BindBuyerToCaptainCodeInput) {
    const captainCode = this.normalizeCaptainCode(input.captainCode);

    return this.prisma.$transaction(async (tx) => {
      const buyer = await tx.user.findUnique({
        where: { id: input.buyerUserId },
        select: { id: true },
      });
      if (!buyer) {
        throw new NotFoundException('用户不存在，无法绑定团长');
      }

      const directCaptain = await tx.captainProfile.findFirst({
        where: {
          captainCode,
          programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
          status: 'ACTIVE',
        },
        select: {
          userId: true,
          captainCode: true,
          status: true,
        },
      });
      if (!directCaptain) {
        throw new NotFoundException('团长码无效或已停用');
      }
      if (directCaptain.userId === input.buyerUserId) {
        throw new BadRequestException('不能绑定自己为团长');
      }

      const existing = await tx.captainRelation.findUnique({
        where: {
          buyerUserId_programCode: {
            buyerUserId: input.buyerUserId,
            programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
          },
        },
      });
      if (existing) {
        if (existing.directCaptainUserId === directCaptain.userId) {
          return existing;
        }
        throw new BadRequestException('用户已绑定其他团长，不能自动换绑');
      }

      const upstream = await tx.captainRelation.findUnique({
        where: {
          buyerUserId_programCode: {
            buyerUserId: directCaptain.userId,
            programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
          },
        },
        select: {
          directCaptainUserId: true,
        },
      });
      const indirectCaptainUserId =
        upstream?.directCaptainUserId &&
        upstream.directCaptainUserId !== input.buyerUserId
          ? upstream.directCaptainUserId
          : null;

      return tx.captainRelation.create({
        data: {
          buyerUserId: input.buyerUserId,
          directCaptainUserId: directCaptain.userId,
          indirectCaptainUserId,
          programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
          codeUsed: captainCode,
          source: input.source || null,
          status: 'ACTIVE',
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private normalizeCaptainCode(code: string) {
    const normalized = code.trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestException('团长码不能为空');
    }
    return normalized;
  }

  private generateCaptainCode() {
    return `SEA${Date.now().toString(36).toUpperCase()}${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;
  }
}
