import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { InboxService } from '../../inbox/inbox.service';
import { maskPhone } from '../../../common/security/privacy-mask';

type VipNodeStatus = 'active' | 'silent' | 'frozen' | 'exited';

const NORMAL_TREE_ROOT_VIEW_ID = '__NORMAL_TREE_ROOT__';

@Injectable()
export class AdminBonusService {
  private readonly logger = new Logger(AdminBonusService.name);

  constructor(
    private prisma: PrismaService,
    private inboxService: InboxService,
  ) {}

  /** VIP 会员列表 */
  async findMembers(page = 1, pageSize = 20, tier?: string) {
    const skip = (page - 1) * pageSize;
    const where: any = {};
    if (tier) where.tier = tier;

    const [items, total] = await Promise.all([
      this.prisma.memberProfile.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              profile: { select: { nickname: true } },
            },
          },
        },
      }),
      this.prisma.memberProfile.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /** 提现审核列表 */
  async findWithdrawals(page = 1, pageSize = 20, status?: string) {
    const skip = (page - 1) * pageSize;
    const where: any = {};
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      this.prisma.withdrawRequest.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              profile: { select: { nickname: true } },
            },
          },
        },
      }),
      this.prisma.withdrawRequest.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /** 审批提现：扣减冻结金额（实际打款为占位实现） */
  async approveWithdraw(id: string, adminUserId: string) {
    const withdraw = await this.prisma.withdrawRequest.findUnique({
      where: { id },
    });
    if (!withdraw) throw new NotFoundException('提现申请不存在');
    if (withdraw.status !== 'REQUESTED') {
      throw new BadRequestException('仅待审核的提现可审批');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 状态 CAS：仅允许 REQUESTED -> APPROVED
      const cas = await tx.withdrawRequest.updateMany({
        where: { id, status: 'REQUESTED' },
        data: {
          status: 'APPROVED',
          reviewerAdminId: adminUserId,
        },
      });
      if (cas.count === 0) {
        throw new BadRequestException('该提现申请已被处理，请刷新后重试');
      }

      const updated = await tx.withdrawRequest.findUnique({
        where: { id },
      });
      if (!updated) {
        throw new NotFoundException('提现申请不存在');
      }

      // 扣减冻结金额（CAS 守卫，防止并发审批导致 frozen 变负数）
      // 使用 withdraw.accountType 动态确定账户类型，支持 VIP_REWARD 和 NORMAL_REWARD
      const frozenCas = await tx.rewardAccount.updateMany({
        where: {
          userId: withdraw.userId,
          type: withdraw.accountType as any,
          frozen: { gte: withdraw.amount },
        },
        data: { frozen: { decrement: withdraw.amount } },
      });
      if (frozenCas.count === 0) {
        throw new BadRequestException('冻结余额不足，可能存在并发操作');
      }

      // P0-4: 更新提现流水为已提现
      await tx.rewardLedger.updateMany({
        where: { refType: 'WITHDRAW', refId: id, status: 'FROZEN' },
        data: { status: 'WITHDRAWN' },
      });

      return updated;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    // C12: 提现通过通知
    this.inboxService.send({
      userId: withdraw.userId,
      category: 'transaction',
      type: 'withdraw_approved',
      title: '提现审核通过',
      content: `您的 ${withdraw.amount.toFixed(2)} 元提现申请已通过，款项将在 1-3 个工作日到账。`,
      target: { route: '/me/wallet' },
    }).catch((err) => this.logger.warn(`提现通过通知发送失败: ${err?.message}`));

    return result;
  }

  /** 会员详情 — 聚合钱包、树位置、收支流水、提现记录 */
  async getMemberDetail(userId: string) {
    const [user, member, progress, account, node] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          profile: { select: { nickname: true, avatarUrl: true } },
          authIdentities: { where: { provider: 'PHONE' }, select: { identifier: true }, take: 1 },
        },
      }),
      this.prisma.memberProfile.findUnique({ where: { userId } }),
      this.prisma.vipProgress.findUnique({ where: { userId } }),
      this.prisma.rewardAccount.findUnique({
        where: { userId_type: { userId, type: 'VIP_REWARD' } },
      }),
      this.prisma.vipTreeNode.findUnique({ where: { userId } }),
    ]);
    if (!user) throw new NotFoundException('用户不存在');

    // 累计收入
    const earned = await this.prisma.rewardLedger.aggregate({
      where: { userId, status: { in: ['AVAILABLE', 'WITHDRAWN'] } },
      _sum: { amount: true },
    });

    // 子节点数
    const childCount = node
      ? await this.prisma.vipTreeNode.count({ where: { parentId: node.id } })
      : 0;

    // 上级用户
    let parentUserId: string | null = null;
    if (node?.parentId) {
      const parentNode = await this.prisma.vipTreeNode.findUnique({ where: { id: node.parentId } });
      parentUserId = parentNode?.userId ?? null;
    }

    // 收支流水（最近 20 条）
    const ledgers = await this.prisma.rewardLedger.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        entryType: true,
        amount: true,
        status: true,
        refType: true,
        refId: true,
        createdAt: true,
      },
    });

    // 提现记录（最近 10 条）
    const withdrawals = await this.prisma.withdrawRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        amount: true,
        status: true,
        channel: true,
        createdAt: true,
        reviewerAdminId: true,
      },
    });

    return {
      userId: user.id,
      nickname: user.profile?.nickname ?? null,
      avatarUrl: user.profile?.avatarUrl ?? null,
      phone: maskPhone(user.authIdentities?.[0]?.identifier ?? null),
      tier: member?.tier ?? 'NORMAL',
      referralCode: member?.referralCode ?? null,
      inviterUserId: member?.inviterUserId ?? null,
      vipPurchasedAt: member?.vipPurchasedAt?.toISOString() ?? null,
      wallet: {
        balance: account?.balance ?? 0,
        frozen: account?.frozen ?? 0,
        totalEarned: earned._sum.amount ?? 0,
      },
      tree: node ? {
        level: node.level,
        position: node.position,
        parentUserId,
        childCount,
        selfPurchaseCount: progress?.selfPurchaseCount ?? 0,
        unlockedLevel: progress?.unlockedLevel ?? 0,
        exitedAt: progress?.exitedAt?.toISOString() ?? null,
      } : null,
      ledgers,
      withdrawals,
    };
  }

  // ============ VIP 树可视化 ============

  /** 获取以指定用户为中心的 VIP 树上下文（面包屑 + 父节点 + 当前 + 子节点） */
  async getVipTreeContext(userId: string, descendantDepth = 1) {
    // 查找用户的树节点
    let node = await this.prisma.vipTreeNode.findUnique({
      where: { userId },
    });
    // 支持通过节点 ID 访问系统根节点（userId 为 null）
    if (!node) {
      node = await this.prisma.vipTreeNode.findUnique({
        where: { id: userId },
      });
    }
    if (!node) throw new NotFoundException('该用户不在 VIP 树中');

    // 系统根节点特殊处理（userId 为 null）
    const isSystemRoot = node.userId === null;

    // 构建面包屑（从当前节点沿 parentId 向上遍历至根）
    const breadcrumb: Array<{ userId: string; nickname: string | null; level: number }> = [];
    let cur = node;
    // H7修复：增加环路保护（visited Set + 最大跳数），避免脏数据导致无限循环
    const visitedNodeIds = new Set<string>([node.id]);
    const maxBreadcrumbHops = 64;
    let hops = 0;
    while (cur.parentId) {
      if (hops >= maxBreadcrumbHops) break;
      if (visitedNodeIds.has(cur.parentId)) break;
      visitedNodeIds.add(cur.parentId);
      hops++;

      const parent = await this.prisma.vipTreeNode.findUnique({
        where: { id: cur.parentId },
      });
      if (!parent || !parent.userId) break;
      // 查昵称
      const parentUser = await this.prisma.user.findUnique({
        where: { id: parent.userId },
        select: { profile: { select: { nickname: true } } },
      });
      breadcrumb.unshift({
        userId: parent.userId,
        nickname: parentUser?.profile?.nickname ?? parent.userId,
        level: parent.level,
      });
      cur = parent;
    }

    // 当前节点详情
    const childCount = await this.prisma.vipTreeNode.count({ where: { parentId: node.id } });
    const currentView = isSystemRoot
      ? {
          userId: node.id,
          nickname: node.rootId ?? node.id,
          phone: null,
          tier: 'VIP' as const,
          selfPurchaseCount: 0,
          totalEarned: 0,
          frozenAmount: 0,
          childCount,
          level: node.level,
          status: 'active' as VipNodeStatus,
          isSystemNode: true,
          joinedTreeAt: node.createdAt?.toISOString() ?? null,
          position: node.position,
          unlockedLevel: 0,
          exitedAt: null,
          rootId: node.rootId,
          referrerUserId: null,
          referrerNickname: null,
          entryMode: 'SYSTEM' as const,
        }
      : await this.buildNodeView(node.userId!);

    // 父节点详情
    let parentView = null;
    if (node.parentId) {
      const parentNode = await this.prisma.vipTreeNode.findUnique({ where: { id: node.parentId } });
      if (parentNode?.userId) parentView = await this.buildNodeView(parentNode.userId);
    }

    // Clamp descendantDepth to 1-5
    const safeDepth = Math.max(1, Math.min(5, descendantDepth));
    const nodeCount = { count: 0 };
    const MAX_NODES = 100;

    // 递归加载子树
    const subtree = await this.buildVipSubtree(node.id, safeDepth, nodeCount, MAX_NODES);

    return { breadcrumb, parent: parentView, current: currentView, children: subtree.nodes, truncated: subtree.truncated };
  }

  /** 懒加载子节点 */
  async getVipTreeChildren(nodeUserId: string) {
    const node = await this.prisma.vipTreeNode.findUnique({ where: { userId: nodeUserId } });
    if (!node) throw new NotFoundException('节点不存在');

    const childNodes = await this.prisma.vipTreeNode.findMany({
      where: { parentId: node.id },
      orderBy: { position: 'asc' },
    });
    return {
      children: await Promise.all(
        childNodes.filter((c) => c.userId).map((c) => this.buildNodeView(c.userId!)),
      ),
    };
  }

  /** 搜索用户（用于 VIP 树搜索框） */
  async searchUsers(keyword: string, limit = 10) {
    // 搜索手机号、用户ID 或昵称
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { id: { contains: keyword } },
          { authIdentities: { some: { provider: 'PHONE', identifier: { contains: keyword } } } },
          { profile: { nickname: { contains: keyword } } },
        ],
      },
      take: limit,
      select: {
        id: true,
        profile: { select: { nickname: true, avatarUrl: true } },
        authIdentities: { where: { provider: 'PHONE' }, select: { identifier: true }, take: 1 },
        memberProfile: { select: { tier: true, vipNodeId: true } },
      },
    });

    const userIds = users.map((u) => u.id);
    const [progresses, frozenAccounts] = await Promise.all([
      this.prisma.vipProgress.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, selfPurchaseCount: true, exitedAt: true },
      }),
      this.prisma.rewardAccount.findMany({
        where: { userId: { in: userIds }, type: 'VIP_REWARD' },
        select: { userId: true, frozen: true },
      }),
    ]);
    const progressMap = new Map(progresses.map((item) => [item.userId, item]));
    const frozenMap = new Map(frozenAccounts.map((item) => [item.userId, item.frozen]));

    return users.map((u) => ({
      userId: u.id,
      nickname: u.profile?.nickname ?? null,
      phone: maskPhone(u.authIdentities?.[0]?.identifier ?? null),
      avatarUrl: u.profile?.avatarUrl ?? null,
      tier: u.memberProfile?.tier ?? 'NORMAL',
      treeStatus: this.resolveVipNodeStatus(
        !!u.memberProfile?.vipNodeId,
        progressMap.get(u.id)?.selfPurchaseCount ?? 0,
        progressMap.get(u.id)?.exitedAt ?? null,
        frozenMap.get(u.id) ?? 0,
      ),
      hasVipNode: !!u.memberProfile?.vipNodeId,
    }));
  }

  /** 搜索普通树用户（返回所有用户，标注是否已入普通树） */
  async searchNormalTreeUsers(keyword: string, limit = 10) {
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { id: { contains: keyword } },
          { authIdentities: { some: { provider: 'PHONE', identifier: { contains: keyword } } } },
          { profile: { nickname: { contains: keyword } } },
        ],
      },
      take: Math.max(limit * 3, limit),
      select: {
        id: true,
        profile: { select: { nickname: true, avatarUrl: true } },
        authIdentities: { where: { provider: 'PHONE' }, select: { identifier: true }, take: 1 },
        memberProfile: { select: { tier: true, normalTreeNodeId: true } },
      },
    });

    const userIds = users.map((u) => u.id);
    const progresses = await this.prisma.normalProgress.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, selfPurchaseCount: true, frozenAt: true },
    });
    const progressMap = new Map(progresses.map((item) => [item.userId, item]));

    return users
      .slice(0, limit)
      .map((u) => ({
        userId: u.id,
        nickname: u.profile?.nickname ?? null,
        phone: maskPhone(u.authIdentities?.[0]?.identifier ?? null),
        avatarUrl: u.profile?.avatarUrl ?? null,
        tier: u.memberProfile?.tier ?? 'NORMAL',
        treeStatus: this.resolveNormalNodeStatus(
          !!u.memberProfile?.normalTreeNodeId,
          u.memberProfile?.tier ?? 'NORMAL',
          progressMap.get(u.id)?.selfPurchaseCount ?? 0,
          progressMap.get(u.id)?.frozenAt ?? null,
        ),
        hasNormalNode: !!u.memberProfile?.normalTreeNodeId,
      }));
  }

  private resolveVipNodeStatus(
    hasNode: boolean,
    selfPurchaseCount: number,
    exitedAt: Date | null,
    frozenAmount: number,
  ): VipNodeStatus | null {
    if (!hasNode) return null;
    if (exitedAt) return 'exited';
    if (frozenAmount > 0) return 'frozen';
    if (selfPurchaseCount === 0) return 'silent';
    return 'active';
  }

  private resolveNormalNodeStatus(
    hasNode: boolean,
    tier: string,
    selfPurchaseCount: number,
    frozenAt: Date | null,
  ): VipNodeStatus | null {
    if (!hasNode) return null;
    if (tier === 'VIP' || frozenAt) return 'frozen';
    if (selfPurchaseCount === 0) return 'silent';
    return 'active';
  }

  /** 构建节点视图（聚合统计） */
  private async buildNodeView(userId: string) {
    const [node, user, progress, account, frozenAccount, memberProfile] = await Promise.all([
      this.prisma.vipTreeNode.findUnique({ where: { userId } }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          profile: { select: { nickname: true } },
          authIdentities: { where: { provider: 'PHONE' }, select: { identifier: true }, take: 1 },
        },
      }),
      this.prisma.vipProgress.findUnique({ where: { userId } }),
      this.prisma.rewardAccount.findUnique({
        where: { userId_type: { userId, type: 'VIP_REWARD' } },
      }),
      this.prisma.rewardAccount.findUnique({
        where: { userId_type: { userId, type: 'VIP_REWARD' } },
        select: { frozen: true },
      }),
      this.prisma.memberProfile.findUnique({
        where: { userId },
        select: { inviterUserId: true, vipPurchasedAt: true },
      }),
    ]);

    // 查询推荐人昵称
    let referrerNickname: string | null = null;
    if (memberProfile?.inviterUserId) {
      const referrer = await this.prisma.user.findUnique({
        where: { id: memberProfile.inviterUserId },
        select: { profile: { select: { nickname: true } } },
      });
      referrerNickname = referrer?.profile?.nickname ?? null;
    }

    // 计算累计收入（AVAILABLE + WITHDRAWN 的 ledger 总额）
    const earned = await this.prisma.rewardLedger.aggregate({
      where: { userId, status: { in: ['AVAILABLE', 'WITHDRAWN'] } },
      _sum: { amount: true },
    });

    // 子节点数
    const childCount = node
      ? await this.prisma.vipTreeNode.count({ where: { parentId: node.id } })
      : 0;

    // 判断状态
    const phone = user?.authIdentities?.[0]?.identifier ?? null;
    const isSystem = userId.startsWith('A') && /^A\d+$/.test(userId);
    let status: VipNodeStatus = 'active';
    if (progress?.exitedAt) {
      status = 'exited';
    } else if ((frozenAccount?.frozen ?? 0) > 0) {
      status = 'frozen';
    } else if ((progress?.selfPurchaseCount ?? 0) === 0 && !isSystem) {
      status = 'silent';
    }

    // 入树方式推断
    // SYSTEM = 高管根节点 A1-A10
    // REFERRAL = 有推荐人，落入推荐人子树（可能直接挂或 BFS 滑落到子树空位）
    // AUTO_PLACE = 无推荐人，由系统 BFS 自动分配到全局空位
    const entryMode = isSystem ? 'SYSTEM' as const
      : memberProfile?.inviterUserId ? 'REFERRAL' as const
      : 'AUTO_PLACE' as const;

    return {
      userId,
      nickname: user?.profile?.nickname ?? (isSystem ? userId : null),
      phone: maskPhone(phone),
      tier: isSystem ? 'VIP' : (progress ? 'VIP' : 'NORMAL'),
      selfPurchaseCount: progress?.selfPurchaseCount ?? 0,
      totalEarned: earned._sum.amount ?? 0,
      frozenAmount: frozenAccount?.frozen ?? 0,
      childCount,
      level: node?.level ?? 0,
      status,
      isSystemNode: isSystem,
      joinedTreeAt: node?.createdAt?.toISOString() ?? null,
      position: node?.position ?? 0,
      unlockedLevel: progress?.unlockedLevel ?? 0,
      exitedAt: progress?.exitedAt?.toISOString() ?? null,
      rootId: node?.rootId ?? null,
      referrerUserId: memberProfile?.inviterUserId ?? null,
      referrerNickname,
      entryMode,
    };
  }

  /**
   * 递归构建 VIP 子树
   * @param nodeId - VipTreeNode.id (not userId)
   * @param remainingDepth - 剩余递归深度
   * @param nodeCount - 引用计数器，用于限制总节点数
   * @param maxNodes - 最大节点数限制
   */
  private async buildVipSubtree(
    nodeId: string,
    remainingDepth: number,
    nodeCount: { count: number },
    maxNodes: number,
  ): Promise<{ nodes: any[]; truncated: boolean }> {
    if (remainingDepth <= 0) return { nodes: [], truncated: false };

    const childTreeNodes = await this.prisma.vipTreeNode.findMany({
      where: { parentId: nodeId },
      orderBy: { position: 'asc' },
    });

    const nodes: any[] = [];
    let truncated = false;

    for (const child of childTreeNodes.filter(c => c.userId)) {
      if (nodeCount.count >= maxNodes) {
        truncated = true;
        break;
      }
      nodeCount.count++;
      const view = await this.buildNodeView(child.userId!);

      // 递归加载更深层级
      if (remainingDepth > 1) {
        const sub = await this.buildVipSubtree(child.id, remainingDepth - 1, nodeCount, maxNodes);
        if (sub.truncated) truncated = true;
        (view as any).children = sub.nodes;
      }

      nodes.push(view);
    }

    return { nodes, truncated };
  }

  // ============ 树根节点统计 ============

  /** VIP 树各根节点统计（A1-A10） */
  async getVipRootStats() {
    // 找到所有系统根节点（userId 为 null 的节点）
    const roots = await this.prisma.vipTreeNode.findMany({
      where: { userId: null },
      select: { id: true, rootId: true },
      orderBy: { rootId: 'asc' },
    });

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const nodes = await this.prisma.vipTreeNode.findMany({
      where: { rootId: { in: roots.map((root) => root.rootId) }, userId: { not: null } },
      select: { rootId: true, userId: true, createdAt: true },
    });
    const userIds = nodes.map((node) => node.userId!).filter(Boolean);
    const [progresses, frozenAccounts] = await Promise.all([
      this.prisma.vipProgress.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, selfPurchaseCount: true, exitedAt: true },
      }),
      this.prisma.rewardAccount.findMany({
        where: { userId: { in: userIds }, type: 'VIP_REWARD' },
        select: { userId: true, frozen: true },
      }),
    ]);
    const progressMap = new Map(progresses.map((item) => [item.userId, item]));
    const frozenMap = new Map(frozenAccounts.map((item) => [item.userId, item.frozen]));
    const bucketMap = new Map<string, { totalNodes: number; weeklyNew: number; activeNodes: number }>();
    for (const root of roots) {
      bucketMap.set(root.rootId, { totalNodes: 0, weeklyNew: 0, activeNodes: 0 });
    }
    for (const node of nodes) {
      if (!node.rootId || !node.userId) continue;
      const bucket = bucketMap.get(node.rootId);
      if (!bucket) continue;
      bucket.totalNodes += 1;
      if (node.createdAt >= oneWeekAgo) bucket.weeklyNew += 1;
      const status = this.resolveVipNodeStatus(
        true,
        progressMap.get(node.userId)?.selfPurchaseCount ?? 0,
        progressMap.get(node.userId)?.exitedAt ?? null,
        frozenMap.get(node.userId) ?? 0,
      );
      if (status === 'active') bucket.activeNodes += 1;
    }

    const stats = roots.map((root) => {
      const bucket = bucketMap.get(root.rootId) ?? { totalNodes: 0, weeklyNew: 0, activeNodes: 0 };
      return {
        rootId: root.rootId,
        rootNodeId: root.id,
        totalNodes: bucket.totalNodes,
        activeNodes: bucket.activeNodes,
        activeRate: bucket.totalNodes > 0 ? Number(((bucket.activeNodes / bucket.totalNodes) * 100).toFixed(1)) : 0,
        weeklyNew: bucket.weeklyNew,
      };
    });

    // 按 rootId 数字部分排序（A1, A2, ..., A10），避免字典序排列
    stats.sort((a, b) => {
      const numA = parseInt(a.rootId.replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(b.rootId.replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });

    return stats;
  }

  /** 普通树根节点统计 */
  async getNormalRootStats() {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const nodes = await this.prisma.normalTreeNode.findMany({
      where: { userId: { not: null } },
      select: { userId: true, createdAt: true },
    });
    const userIds = nodes.map((node) => node.userId!).filter(Boolean);
    const [progresses, memberProfiles] = await Promise.all([
      this.prisma.normalProgress.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, selfPurchaseCount: true, frozenAt: true },
      }),
      this.prisma.memberProfile.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, tier: true },
      }),
    ]);
    const progressMap = new Map(progresses.map((item) => [item.userId, item]));
    const tierMap = new Map(memberProfiles.map((item) => [item.userId, item.tier]));
    let weeklyNew = 0;
    let activeNodes = 0;
    for (const node of nodes) {
      if (!node.userId) continue;
      if (node.createdAt >= oneWeekAgo) weeklyNew += 1;
      const status = this.resolveNormalNodeStatus(
        true,
        tierMap.get(node.userId) ?? 'NORMAL',
        progressMap.get(node.userId)?.selfPurchaseCount ?? 0,
        progressMap.get(node.userId)?.frozenAt ?? null,
      );
      if (status === 'active') activeNodes += 1;
    }
    const totalNodes = nodes.length;

    return {
      rootId: 'ROOT',
      totalNodes,
      activeNodes,
      activeRate: totalNodes > 0 ? Number(((activeNodes / totalNodes) * 100).toFixed(1)) : 0,
      weeklyNew,
    };
  }

  // ============ 普通奖励滑动窗口 ============

  /** 获取所有桶的概览统计 */
  async getBroadcastBuckets() {
    const buckets = await this.prisma.normalBucket.findMany({
      orderBy: { bucketKey: 'asc' },
    });

    const result = await Promise.all(
      buckets.map(async (b) => {
        const stats = await this.prisma.normalQueueMember.aggregate({
          where: { bucketId: b.id, active: true },
          _count: true,
        });
        // 汇总该桶内的分配总额
        const reward = await this.prisma.rewardLedger.aggregate({
          where: {
            meta: { path: ['bucketKey'], equals: b.bucketKey },
            status: { in: ['AVAILABLE', 'WITHDRAWN'] },
          },
          _sum: { amount: true },
        });

        return {
          bucketKey: b.bucketKey,
          totalOrders: stats._count,
          totalAmount: 0, // 需从队列计算
          totalReward: reward._sum.amount ?? 0,
        };
      }),
    );

    return result;
  }

  /** 获取指定桶的滑动窗口订单列表 */
  async getBroadcastWindow(bucketKey: string, page = 1, pageSize = 30) {
    const bucket = await this.prisma.normalBucket.findUnique({ where: { bucketKey } });
    if (!bucket) throw new NotFoundException('桶不存在');

    const skip = (page - 1) * pageSize;

    const [members, total] = await Promise.all([
      this.prisma.normalQueueMember.findMany({
        where: { bucketId: bucket.id, active: true },
        orderBy: { joinedAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          order: { select: { totalAmount: true } },
          user: { select: { id: true, profile: { select: { nickname: true } } } },
        },
      }),
      this.prisma.normalQueueMember.count({ where: { bucketId: bucket.id, active: true } }),
    ]);

    // 查每笔订单分出去的奖励总额
    const orderIds = members.map((m) => m.orderId).filter((id): id is string => id !== null);
    const ledgers = await this.prisma.rewardLedger.groupBy({
      by: ['refId'],
      where: {
        refId: { in: orderIds },
        meta: { path: ['scheme'], equals: 'NORMAL_BROADCAST' },
        status: { in: ['AVAILABLE', 'WITHDRAWN'] },
      },
      _sum: { amount: true },
    });
    const rewardMap = new Map(ledgers.map((l) => [l.refId, l._sum?.amount ?? 0]));

    const rewardTotal = await this.prisma.rewardLedger.aggregate({
      where: {
        meta: { path: ['bucketKey'], equals: bucketKey },
        status: { in: ['AVAILABLE', 'WITHDRAWN'] },
      },
      _sum: { amount: true },
    });

    return {
      bucketInfo: {
        bucketKey: bucket.bucketKey,
        totalOrders: total,
        totalAmount: members.reduce((s, m) => s + (m.order?.totalAmount ?? 0), 0),
        totalReward: rewardTotal._sum.amount ?? 0,
      },
      windowOrders: members.map((m) => ({
        orderId: m.orderId,
        userId: m.userId,
        nickname: m.user?.profile?.nickname ?? null,
        amount: m.order?.totalAmount ?? 0,
        rewardDistributed: rewardMap.get(m.orderId) ?? 0,
        createdAt: m.joinedAt.toISOString(),
      })),
      pagination: { total, page, pageSize },
    };
  }

  /** 获取某笔订单的奖励分配明细 */
  async getBroadcastDistributions(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        totalAmount: true,
        userId: true,
        user: { select: { profile: { select: { nickname: true } } } },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');

    // 查该订单触发的所有普通广播分配
    const ledgers = await this.prisma.rewardLedger.findMany({
      where: {
        refId: orderId,
        meta: { path: ['scheme'], equals: 'NORMAL_BROADCAST' },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        account: { select: { userId: true } },
      },
    });

    // 查受益人昵称
    const userIds = [...new Set(ledgers.map((l) => l.userId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, profile: { select: { nickname: true } } },
    });
    const userMap = new Map(users.map((u) => [u.id, u.profile?.nickname ?? null]));

    return {
      order: {
        id: order.id,
        amount: order.totalAmount,
        buyerName: order.user?.profile?.nickname ?? null,
      },
      distributions: ledgers.map((l, i) => ({
        recipientId: l.userId,
        recipientName: userMap.get(l.userId) ?? null,
        amount: l.amount,
        orderIndex: i + 1,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  }

  // ============ 普通用户树可视化 ============

  /** 获取以指定用户为中心的普通树上下文 */
  async getNormalTreeContext(userId: string, descendantDepth = 1) {
    if (userId === NORMAL_TREE_ROOT_VIEW_ID) {
      return this.getNormalPlatformRootContext(descendantDepth);
    }

    const node = await this.prisma.normalTreeNode.findUnique({
      where: { userId },
    });
    if (!node) throw new NotFoundException('该用户不在普通树中');

    // 面包屑
    const breadcrumb: Array<{ userId: string | null; nickname: string | null; level: number }> = [];
    let cur = node;
    const visitedNodeIds = new Set<string>([node.id]);
    let hops = 0;
    while (cur.parentId && hops < 64) {
      if (visitedNodeIds.has(cur.parentId)) break;
      visitedNodeIds.add(cur.parentId);
      hops++;

      const parent = await this.prisma.normalTreeNode.findUnique({ where: { id: cur.parentId } });
      if (!parent) break;
      // 系统根节点（userId=null）
      if (!parent.userId) {
        breadcrumb.unshift({ userId: null, nickname: '系统根节点', level: parent.level });
        break;
      }
      const parentUser = await this.prisma.user.findUnique({
        where: { id: parent.userId },
        select: { profile: { select: { nickname: true } } },
      });
      breadcrumb.unshift({
        userId: parent.userId,
        nickname: parentUser?.profile?.nickname ?? parent.userId,
        level: parent.level,
      });
      cur = parent;
    }

    // 当前节点
    const currentView = await this.buildNormalNodeView(node.userId!);

    // 父节点
    let parentView = null;
    if (node.parentId) {
      const parentNode = await this.prisma.normalTreeNode.findUnique({ where: { id: node.parentId } });
      if (parentNode?.userId) parentView = await this.buildNormalNodeView(parentNode.userId);
    }

    // Clamp descendantDepth to 1-5
    const safeDepth = Math.max(1, Math.min(5, descendantDepth));
    const nodeCount = { count: 0 };
    const MAX_NODES = 100;

    // 递归加载子树
    const subtree = await this.buildNormalSubtree(node.id, safeDepth, nodeCount, MAX_NODES);

    return { breadcrumb, parent: parentView, current: currentView, children: subtree.nodes, truncated: subtree.truncated };
  }

  /** 懒加载普通树子节点 */
  async getNormalTreeChildren(nodeUserId: string) {
    if (nodeUserId === NORMAL_TREE_ROOT_VIEW_ID) {
      const rootNode = await this.prisma.normalTreeNode.findFirst({
        where: { userId: null },
        orderBy: { createdAt: 'asc' },
      });
      if (!rootNode) throw new NotFoundException('普通树平台根节点不存在');

      const childNodes = await this.prisma.normalTreeNode.findMany({
        where: { parentId: rootNode.id },
        orderBy: { position: 'asc' },
      });
      return {
        children: await Promise.all(
          childNodes.filter((c) => c.userId).map((c) => this.buildNormalNodeView(c.userId!)),
        ),
      };
    }

    const node = await this.prisma.normalTreeNode.findUnique({ where: { userId: nodeUserId } });
    if (!node) throw new NotFoundException('节点不存在');

    const childNodes = await this.prisma.normalTreeNode.findMany({
      where: { parentId: node.id },
      orderBy: { position: 'asc' },
    });
    return {
      children: await Promise.all(
        childNodes.filter((c) => c.userId).map((c) => this.buildNormalNodeView(c.userId!)),
      ),
    };
  }

  /** 构建普通树平台根视图 */
  private async getNormalPlatformRootContext(descendantDepth = 1) {
    const rootNode = await this.prisma.normalTreeNode.findFirst({
      where: { userId: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!rootNode) throw new NotFoundException('普通树平台根节点不存在');

    const childCount = await this.prisma.normalTreeNode.count({
      where: { parentId: rootNode.id },
    });

    const safeDepth = Math.max(1, Math.min(5, descendantDepth));
    const nodeCount = { count: 0 };
    const MAX_NODES = 100;
    const subtree = await this.buildNormalSubtree(rootNode.id, safeDepth, nodeCount, MAX_NODES);

    return {
      breadcrumb: [],
      parent: null,
      current: {
        userId: NORMAL_TREE_ROOT_VIEW_ID,
        nickname: '平台根节点',
        phone: null,
        tier: 'NORMAL' as const,
        selfPurchaseCount: 0,
        totalEarned: 0,
        frozenAmount: 0,
        balance: 0,
        childCount,
        level: rootNode.level,
        status: 'active' as const,
        isSystemNode: true,
        joinedTreeAt: rootNode.createdAt.toISOString(),
        position: rootNode.position,
        unlockedLevel: 0,
        normalRewardEligible: false,
        upgradedToVipAt: null,
        stoppedReason: null,
      },
      children: subtree.nodes,
      truncated: subtree.truncated,
    };
  }

  /** 构建普通树节点视图 */
  private async buildNormalNodeView(userId: string) {
    const [node, user, progress, account, memberProfile] = await Promise.all([
      this.prisma.normalTreeNode.findUnique({ where: { userId } }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          profile: { select: { nickname: true } },
          authIdentities: { where: { provider: 'PHONE' }, select: { identifier: true }, take: 1 },
        },
      }),
      this.prisma.normalProgress.findUnique({ where: { userId } }),
      this.prisma.rewardAccount.findUnique({
        where: { userId_type: { userId, type: 'NORMAL_REWARD' } },
      }),
      this.prisma.memberProfile.findUnique({
        where: { userId },
        select: { tier: true, vipPurchasedAt: true, normalJoinedAt: true, normalEligible: true },
      }),
    ]);

    const earned = await this.prisma.rewardLedger.aggregate({
      where: {
        userId,
        account: { type: 'NORMAL_REWARD' },
        status: { in: ['AVAILABLE', 'WITHDRAWN'] },
      },
      _sum: { amount: true },
    });

    const childCount = node
      ? await this.prisma.normalTreeNode.count({ where: { parentId: node.id } })
      : 0;

    const phone = user?.authIdentities?.[0]?.identifier ?? null;

    // 计算状态
    const status = memberProfile?.tier === 'VIP' ? 'frozen' as const
      : progress?.frozenAt ? 'frozen' as const
      : progress?.selfPurchaseCount === 0 ? 'silent' as const
      : 'active' as const;

    // 停止原因
    // UPGRADED_VIP = 用户升级为 VIP，停止接收普通奖励
    // FROZEN = 账户被冻结（可能原因：超时未消费/管理员操作/系统规则触发）
    const stoppedReason = memberProfile?.tier === 'VIP' ? 'UPGRADED_VIP' as const
      : progress?.frozenAt ? 'FROZEN' as const
      : null;

    return {
      userId,
      nickname: user?.profile?.nickname ?? null,
      phone: maskPhone(phone),
      selfPurchaseCount: progress?.selfPurchaseCount ?? 0,
      totalEarned: earned._sum?.amount ?? 0,
      frozenAmount: account?.frozen ?? 0,
      balance: account?.balance ?? 0,
      childCount,
      level: node?.level ?? 0,
      frozenAt: progress?.frozenAt?.toISOString() ?? null,
      tier: memberProfile?.tier ?? 'NORMAL',
      status,
      isSystemNode: !node?.userId,
      joinedTreeAt: memberProfile?.normalJoinedAt?.toISOString() ?? node?.createdAt?.toISOString() ?? null,
      position: node?.position ?? 0,
      unlockedLevel: progress?.selfPurchaseCount ?? 0,
      normalRewardEligible: memberProfile?.tier !== 'VIP' && !progress?.frozenAt,
      upgradedToVipAt: memberProfile?.vipPurchasedAt?.toISOString() ?? null,
      stoppedReason,
    };
  }

  /**
   * 递归构建普通用户子树
   * @param nodeId - NormalTreeNode.id (not userId)
   * @param remainingDepth - 剩余递归深度
   * @param nodeCount - 引用计数器，用于限制总节点数
   * @param maxNodes - 最大节点数限制
   */
  private async buildNormalSubtree(
    nodeId: string,
    remainingDepth: number,
    nodeCount: { count: number },
    maxNodes: number,
  ): Promise<{ nodes: any[]; truncated: boolean }> {
    if (remainingDepth <= 0) return { nodes: [], truncated: false };

    const childTreeNodes = await this.prisma.normalTreeNode.findMany({
      where: { parentId: nodeId },
      orderBy: { position: 'asc' },
    });

    const nodes: any[] = [];
    let truncated = false;

    for (const child of childTreeNodes.filter(c => c.userId)) {
      if (nodeCount.count >= maxNodes) {
        truncated = true;
        break;
      }
      nodeCount.count++;
      const view = await this.buildNormalNodeView(child.userId!);

      // 递归加载更深层级
      if (remainingDepth > 1) {
        const sub = await this.buildNormalSubtree(child.id, remainingDepth - 1, nodeCount, maxNodes);
        if (sub.truncated) truncated = true;
        (view as any).children = sub.nodes;
      }

      nodes.push(view);
    }

    return { nodes, truncated };
  }

  /** 获取用户的树奖励记录 */
  async getTreeRewardRecords(
    userId: string,
    accountType: 'VIP_REWARD' | 'NORMAL_REWARD',
    page = 1,
    pageSize = 20,
  ) {
    const skip = (page - 1) * pageSize;

    // Find the user's reward account
    const account = await this.prisma.rewardAccount.findUnique({
      where: { userId_type: { userId, type: accountType } },
    });

    if (!account) {
      return { items: [], total: 0, page, pageSize };
    }

    // Query ledger entries
    const where = { accountId: account.id };

    const [ledgers, total] = await Promise.all([
      this.prisma.rewardLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          entryType: true,
          amount: true,
          status: true,
          refType: true,
          refId: true,
          meta: true,
          createdAt: true,
        },
      }),
      this.prisma.rewardLedger.count({ where }),
    ]);

    // Extract sourceUserId from meta and batch-lookup nicknames
    const sourceUserIds = new Set<string>();
    for (const l of ledgers) {
      const meta = l.meta as any;
      if (meta?.sourceUserId) sourceUserIds.add(meta.sourceUserId);
    }

    const sourceUsers = sourceUserIds.size > 0
      ? await this.prisma.user.findMany({
          where: { id: { in: [...sourceUserIds] } },
          select: { id: true, profile: { select: { nickname: true } } },
        })
      : [];
    const nicknameMap = new Map(sourceUsers.map((u) => [u.id, u.profile?.nickname ?? null]));

    const items = ledgers.map((l) => {
      const meta = l.meta as any;
      return {
        id: l.id,
        entryType: l.entryType,
        amount: l.amount,
        status: l.status,
        refType: l.refType,
        refId: l.refId,
        sourceUserId: meta?.sourceUserId ?? null,
        sourceNickname: meta?.sourceUserId ? (nicknameMap.get(meta.sourceUserId) ?? null) : null,
        layer: meta?.layer ?? meta?.level ?? null,
        createdAt: l.createdAt.toISOString(),
      };
    });

    return { items, total, page, pageSize };
  }

  async getTreeRelatedOrders(
    userId: string,
    accountType: 'VIP_REWARD' | 'NORMAL_REWARD',
    page = 1,
    pageSize = 20,
  ) {
    const account = await this.prisma.rewardAccount.findUnique({
      where: { userId_type: { userId, type: accountType } },
    });
    if (!account) {
      return { items: [], total: 0, page, pageSize };
    }

    const where = {
      accountId: account.id,
      refType: 'ORDER' as const,
      refId: { not: null },
    };
    const ledgers = await this.prisma.rewardLedger.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        entryType: true,
        amount: true,
        status: true,
        refType: true,
        refId: true,
        meta: true,
        createdAt: true,
      },
    });

    const sourceUserIds = new Set<string>();
    for (const ledger of ledgers) {
      const meta = ledger.meta as any;
      if (meta?.sourceUserId) sourceUserIds.add(meta.sourceUserId);
    }
    const sourceUsers = sourceUserIds.size > 0
      ? await this.prisma.user.findMany({
          where: { id: { in: [...sourceUserIds] } },
          select: { id: true, profile: { select: { nickname: true } } },
        })
      : [];
    const nicknameMap = new Map(sourceUsers.map((u) => [u.id, u.profile?.nickname ?? null]));

    const grouped = new Map<string, {
      orderId: string;
      sourceUserId: string | null;
      sourceNickname: string | null;
      totalReward: number;
      entryCount: number;
      latestStatus: string;
      latestEntryType: string;
      latestLayer: number | null;
      latestCreatedAt: string;
    }>();

    for (const ledger of ledgers) {
      if (!ledger.refId) continue;
      const meta = ledger.meta as any;
      const current = grouped.get(ledger.refId);
      if (!current) {
        grouped.set(ledger.refId, {
          orderId: ledger.refId,
          sourceUserId: meta?.sourceUserId ?? null,
          sourceNickname: meta?.sourceUserId ? (nicknameMap.get(meta.sourceUserId) ?? null) : null,
          totalReward: ledger.amount,
          entryCount: 1,
          latestStatus: ledger.status,
          latestEntryType: ledger.entryType,
          latestLayer: meta?.layer ?? meta?.level ?? null,
          latestCreatedAt: ledger.createdAt.toISOString(),
        });
        continue;
      }
      current.totalReward += ledger.amount;
      current.entryCount += 1;
    }

    const aggregated = [...grouped.values()];
    const total = aggregated.length;
    const skip = (page - 1) * pageSize;
    const items = aggregated.slice(skip, skip + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  /** 奖励路径解释：追溯一笔奖励从消费到分配的完整路径 */
  async getPathExplain(
    userId: string,
    ledgerId: string,
    accountType: 'VIP_REWARD' | 'NORMAL_REWARD',
  ) {
    // 1. Find the ledger entry（校验归属）
    const ledger = await this.prisma.rewardLedger.findFirst({
      where: { id: ledgerId, userId },
    });
    if (!ledger) throw new NotFoundException('奖励记录不存在');

    // 2. Extract meta
    const meta = ledger.meta as any;
    const sourceUserId: string | null = meta?.sourceUserId ?? null;
    const layer: number | null = meta?.layer ?? meta?.level ?? null;

    // 3. Look up source user nickname
    let sourceNickname: string | null = null;
    if (sourceUserId) {
      const sourceUser = await this.prisma.user.findUnique({
        where: { id: sourceUserId },
        select: { profile: { select: { nickname: true } } },
      });
      sourceNickname = sourceUser?.profile?.nickname ?? null;
    }

    // 4. Look up recipient nickname
    const recipientUser = await this.prisma.user.findUnique({
      where: { id: ledger.userId },
      select: { profile: { select: { nickname: true } } },
    });
    const recipientNickname = recipientUser?.profile?.nickname ?? null;

    // 5. Build path from source to recipient by traversing the tree
    const path: Array<{
      userId: string;
      nickname: string | null;
      level: number;
      isSource: boolean;
      isTarget: boolean;
    }> = [];

    if (sourceUserId) {
      const isVip = accountType === 'VIP_REWARD';
      const TreeModel = isVip ? this.prisma.vipTreeNode : this.prisma.normalTreeNode;

      const sourceNode = await (TreeModel as any).findUnique({ where: { userId: sourceUserId } });
      if (sourceNode) {
        // Add source node to path
        path.push({
          userId: sourceUserId,
          nickname: sourceNickname,
          level: sourceNode.level,
          isSource: true,
          isTarget: sourceUserId === ledger.userId,
        });

        // Walk up the tree from source to find the recipient
        let current = sourceNode;
        const maxHops = Math.min(layer ?? 15, 15);
        const visited = new Set<string>([sourceNode.id]);

        for (let i = 0; i < maxHops; i++) {
          if (!current.parentId) break;
          if (visited.has(current.parentId)) break;
          visited.add(current.parentId);

          const parent = await (TreeModel as any).findUnique({ where: { id: current.parentId } });
          if (!parent) break;

          // Skip system root nodes (userId is null for normal tree root)
          if (!parent.userId) break;

          const parentUser = await this.prisma.user.findUnique({
            where: { id: parent.userId },
            select: { profile: { select: { nickname: true } } },
          });

          const isTarget = parent.userId === ledger.userId;
          path.push({
            userId: parent.userId,
            nickname: parentUser?.profile?.nickname ?? null,
            level: parent.level,
            isSource: false,
            isTarget,
          });

          if (isTarget) break; // Found the recipient, stop traversal
          current = parent;
        }
      }
    }

    // 6. Determine hit result
    let hitResult = '命中';
    if (ledger.status === 'RETURN_FROZEN') {
      hitResult = '售后保护冻结中';
    } else if (ledger.status === 'FROZEN') {
      hitResult = '已冻结（等待解冻）';
    } else if (ledger.status === 'VOIDED') {
      hitResult = '已作废';
    } else if (ledger.status === 'AVAILABLE') {
      hitResult = '已到账';
    } else if (ledger.status === 'WITHDRAWN') {
      hitResult = '已提现';
    } else if (ledger.status === 'RESERVED') {
      hitResult = '已预留';
    }

    // Check if recipient was found in path
    const recipientInPath = path.some(p => p.isTarget);
    if (!recipientInPath && sourceUserId) {
      hitResult = '路径外分配（可能经过跳层处理）';
    }

    return {
      sourceUserId,
      sourceNickname,
      consumptionIndex: layer,
      rewardAmount: ledger.amount,
      rewardStatus: ledger.status,
      entryType: ledger.entryType,
      recipientUserId: ledger.userId,
      recipientNickname,
      path,
      hitResult,
    };
  }

  /** 拒绝提现：解冻金额退回可用余额 */
  async rejectWithdraw(id: string, adminUserId: string, reason?: string) {
    const withdraw = await this.prisma.withdrawRequest.findUnique({
      where: { id },
    });
    if (!withdraw) throw new NotFoundException('提现申请不存在');
    if (withdraw.status !== 'REQUESTED') {
      throw new BadRequestException('仅待审核的提现可拒绝');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 状态 CAS：仅允许 REQUESTED -> REJECTED
      const cas = await tx.withdrawRequest.updateMany({
        where: { id, status: 'REQUESTED' },
        data: {
          status: 'REJECTED',
          reviewerAdminId: adminUserId,
          ...(reason ? { rejectReason: reason } : {}),
        },
      });
      if (cas.count === 0) {
        throw new BadRequestException('该提现申请已被处理，请刷新后重试');
      }

      const updated = await tx.withdrawRequest.findUnique({
        where: { id },
      });
      if (!updated) {
        throw new NotFoundException('提现申请不存在');
      }

      // 解冻：frozen → balance（CAS 守卫，防止并发操作导致 frozen 变负数）
      // 使用 withdraw.accountType 动态确定账户类型，支持 VIP_REWARD 和 NORMAL_REWARD
      // 注意：updateMany 不支持同时 decrement+increment，需分两步操作
      const frozenCas = await tx.rewardAccount.updateMany({
        where: {
          userId: withdraw.userId,
          type: withdraw.accountType as any,
          frozen: { gte: withdraw.amount },
        },
        data: { frozen: { decrement: withdraw.amount } },
      });
      if (frozenCas.count === 0) {
        throw new BadRequestException('冻结余额不足，可能存在并发操作');
      }
      // frozen 扣减成功后，将金额退回可用余额
      await tx.rewardAccount.updateMany({
        where: {
          userId: withdraw.userId,
          type: withdraw.accountType as any,
        },
        data: { balance: { increment: withdraw.amount } },
      });

      // P0-4: 作废提现流水
      await tx.rewardLedger.updateMany({
        where: { refType: 'WITHDRAW', refId: id, status: 'FROZEN' },
        data: { status: 'VOIDED', entryType: 'VOID' },
      });

      return updated;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    // C12: 提现拒绝通知
    this.inboxService.send({
      userId: withdraw.userId,
      category: 'transaction',
      type: 'withdraw_rejected',
      title: '提现申请被驳回',
      content: `您的 ${withdraw.amount.toFixed(2)} 元提现申请被驳回${reason ? `，原因：${reason}` : ''}。金额已退回可用余额。`,
      target: { route: '/me/wallet' },
    }).catch((err) => this.logger.warn(`提现拒绝通知发送失败: ${err?.message}`));

    return result;
  }
}
