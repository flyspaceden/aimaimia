import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BonusConfigService } from '../../bonus/engine/bonus-config.service';
import { PaymentService } from '../../payment/payment.service';
import { SfExpressService } from '../../shipment/sf-express.service';
import { UploadService } from '../../upload/upload.service';
import { AdminShipDto, AdminOrderQueryDto } from './dto/admin-order.dto';
import {
  maskAddressSnapshot,
  maskPhone,
  maskTrackingNo,
} from '../../../common/security/privacy-mask';
import { decryptJsonValue } from '../../../common/security/encryption';
import { fetchBinaryWithLimit } from '../../../common/utils/remote-binary-fetch.util';
import { parseChineseAddress } from '../../../common/utils/parse-region';

@Injectable()
export class AdminOrdersService {
  private readonly logger = new Logger(AdminOrdersService.name);

  constructor(
    private prisma: PrismaService,
    private bonusConfig: BonusConfigService,
    private sfExpress: SfExpressService,
    private uploadService: UploadService,
    private paymentService: PaymentService,
  ) {}

  private normalizeTrackingNo(value?: string | null): string {
    return String(value ?? '').trim();
  }

  private assertManualTrackingNoValid(trackingNo: string) {
    if (trackingNo.length < 8) {
      throw new BadRequestException(
        '手填运单号长度过短；如果要创建顺丰沙箱订单，请开启“顺丰自动取号”。',
      );
    }
    if (!/^[A-Za-z0-9-]+$/.test(trackingNo)) {
      throw new BadRequestException('手填运单号只能包含字母、数字或短横线');
    }
  }

  private mapRefundSummary(refund?: any) {
    if (!refund) return null;
    return {
      id: refund.id,
      orderId: refund.orderId,
      amount: refund.amount,
      status: refund.status,
      reason: refund.reason,
      merchantRefundNo: refund.merchantRefundNo,
      providerRefundId: refund.providerRefundId ?? null,
      createdAt: refund.createdAt?.toISOString?.() ?? refund.createdAt ?? null,
      updatedAt: refund.updatedAt?.toISOString?.() ?? refund.updatedAt ?? null,
    };
  }

  /** 订单列表 */
  async findAll(query: AdminOrderQueryDto, page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.keyword) {
      // 同时搜索订单号和用户手机号
      where.OR = [
        { id: query.keyword },
        {
          user: {
            authIdentities: {
              some: {
                provider: 'PHONE',
                identifier: { contains: query.keyword },
              },
            },
          },
        },
      ];
    }
    if (query.userId) {
      where.userId = query.userId;
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }
    // 按公司筛选（通过订单项的冗余 companyId）
    if (query.companyId) {
      where.items = { some: { companyId: query.companyId } };
    }
    // 按支付渠道筛选
    if (query.paymentChannel) {
      where.checkoutSession = { paymentChannel: query.paymentChannel };
    }

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              profile: { select: { nickname: true } },
              authIdentities: {
                where: { provider: 'PHONE' },
                select: { identifier: true },
                take: 1,
              },
            },
          },
          checkoutSession: {
            select: { paymentChannel: true },
          },
          items: {
            include: {
              sku: {
                select: {
                  title: true,
                  product: {
                    select: {
                      title: true,
                      company: { select: { id: true, name: true } },
                    },
                  },
                },
              },
            },
          },
          refunds: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              orderId: true,
              amount: true,
              status: true,
              reason: true,
              merchantRefundNo: true,
              providerRefundId: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      items: items.map((o) => {
        // 从第一个订单项提取公司信息
        const firstItem = o.items[0];
        const company = firstItem?.sku?.product?.company || null;
        // 商品概要：第一个商品名 + 总件数
        const totalQty = o.items.reduce((sum, item) => sum + item.quantity, 0);
        const firstProductTitle =
          (firstItem?.productSnapshot as any)?.title ||
          firstItem?.sku?.product?.title ||
          '未知商品';
        const itemsSummary =
          o.items.length > 1
            ? `${firstProductTitle} 等${o.items.length}种`
            : firstProductTitle;

        return {
          ...o,
          orderNo: o.id,
          paymentMethod: o.checkoutSession?.paymentChannel || null,
          paymentAmount: o.totalAmount - (o.discountAmount ?? 0),
          company,
          itemsSummary,
          itemCount: totalQty,
          refundSummary: this.mapRefundSummary((o as any).refunds?.[0]),
          user: {
            ...o.user,
            authIdentities: (o.user?.authIdentities || []).map((identity) => ({
              ...identity,
              identifierMasked: maskPhone(identity.identifier || null),
            })),
            phone: maskPhone(o.user?.authIdentities?.[0]?.identifier || null),
          },
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  /** 订单状态统计 */
  async getStats() {
    const counts = await this.prisma.order.groupBy({
      by: ['status'],
      _count: true,
    });
    const stats: Record<string, number> = {};
    let total = 0;
    for (const c of counts) {
      stats[c.status] = c._count;
      total += c._count;
    }
    stats.ALL = total;
    return stats;
  }

  /** 订单详情 */
  async findById(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            profile: { select: { nickname: true, avatarUrl: true } },
            authIdentities: {
              where: { provider: 'PHONE' },
              select: { identifier: true },
              take: 1,
            },
          },
        },
        items: {
          include: {
            sku: {
              include: {
                product: {
                  include: {
                    media: {
                      where: { type: 'IMAGE' },
                      orderBy: { sortOrder: 'asc' },
                      take: 1,
                      select: { url: true },
                    },
                  },
                },
              },
            },
          },
        },
        statusHistory: { orderBy: { createdAt: 'desc' } },
        payments: true,
        refunds: {
          orderBy: { createdAt: 'desc' },
          include: { statusHistory: { orderBy: { createdAt: 'desc' } } },
        },
        shipments: { include: { trackingEvents: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');
    const userPhone = order.user?.authIdentities?.[0]?.identifier || null;
    const addressSnapshot = decryptJsonValue(order.addressSnapshot);
    const shipments = (order.shipments || []).map((shipment) => ({
      ...shipment,
      trackingNoMasked: maskTrackingNo(shipment.trackingNo),
      waybillNoMasked: maskTrackingNo(shipment.waybillNo),
    }));

    // 映射字段以匹配前端 Order 类型
    return {
      ...order,
      orderNo: order.id,
      paymentAmount: order.totalAmount - (order.discountAmount ?? 0),
      address: addressSnapshot,
      addressSnapshot,
      addressMasked: maskAddressSnapshot(addressSnapshot),
      user: {
        ...order.user,
        authIdentities: (order.user?.authIdentities || []).map((identity) => ({
          ...identity,
          identifierMasked: maskPhone(identity.identifier || null),
        })),
        phone: userPhone,
        phoneMasked: maskPhone(userPhone),
        nickname: order.user?.profile?.nickname || null,
      },
      shipments,
      shipment: shipments[0] ?? null,
      refundSummary: this.mapRefundSummary(order.refunds?.[0]),
      items: order.items.map((item) => {
        const snapshot = item.productSnapshot as any;
        // 商品图片优先从快照取，回退到 SKU 图片或商品主图
        const productImage =
          snapshot?.image ||
          (item.sku?.product?.media as any)?.[0]?.url ||
          null;
        return {
          ...item,
          productTitle: snapshot?.title || item.sku?.product?.title || '未知商品',
          productImage,
          skuName: item.sku?.title || null,
          productId: item.sku?.product?.id || null,
        };
      }),
    };
  }

  async retryRefund(orderId: string, refundId: string, adminUserId: string) {
    const refund = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (!refund || refund.orderId !== orderId) throw new NotFoundException('退款单不存在');
    if (!['FAILED', 'REFUNDING'].includes(refund.status)) {
      throw new BadRequestException('当前退款状态不需要重试');
    }

    const lease = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext('refund-retry'),
          hashtext(${refundId})
        )
      `;

      const fresh = await tx.refund.findUnique({ where: { id: refundId } });
      if (!fresh || fresh.orderId !== orderId) throw new NotFoundException('退款单不存在');
      if (!['FAILED', 'REFUNDING'].includes(fresh.status)) {
        return { acquired: false as const, reason: '状态已变更，无需重试' };
      }

      const recent = await tx.refundStatusHistory.findFirst({
        where: {
          refundId,
          remark: { contains: '重试开始' },
          createdAt: { gte: new Date(Date.now() - 30_000) },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (recent) {
        return { acquired: false as const, reason: '请勿频繁重试，请 30 秒后再试' };
      }

      await tx.refundStatusHistory.create({
        data: {
          refundId,
          fromStatus: fresh.status,
          toStatus: fresh.status,
          remark: '管理员手动重试开始',
          operatorId: adminUserId,
        },
      });
      return { acquired: true as const, fromStatus: fresh.status };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (!lease.acquired) {
      throw new BadRequestException(lease.reason);
    }

    let result: { success: boolean; message?: string; providerRefundId?: string };
    try {
      result = await this.paymentService.initiateRefund(
        refund.orderId,
        refund.amount,
        refund.merchantRefundNo,
      );
    } catch (err) {
      await this.prisma.refundStatusHistory.create({
        data: {
          refundId,
          fromStatus: lease.fromStatus,
          toStatus: lease.fromStatus,
          remark: `管理员手动重试异常: ${(err as Error).message}`,
          operatorId: adminUserId,
        },
      });
      throw new BadRequestException('退款通道异常，请稍后再试或查看日志');
    }

    const toStatus = result.success ? 'REFUNDED' : 'FAILED';
    const providerRefundId = result.providerRefundId ?? refund.providerRefundId ?? null;

    try {
      const writeBack = await this.prisma.$transaction(async (tx) => {
        if (providerRefundId) {
          const conflict = await tx.refund.findFirst({
            where: {
              providerRefundId,
              id: { not: refundId },
            },
            select: { id: true },
          });
          if (conflict) {
            await tx.refundStatusHistory.create({
              data: {
                refundId,
                fromStatus: lease.fromStatus,
                toStatus: lease.fromStatus,
                remark: `providerRefundId 冲突，跳过覆盖: ${providerRefundId}`,
                operatorId: adminUserId,
              },
            });
            return { status: 'providerRefundIdConflict' as const };
          }
        }

        const updated = await tx.refund.updateMany({
          where: { id: refundId, status: lease.fromStatus },
          data: {
            status: toStatus,
            providerRefundId: providerRefundId ?? undefined,
          },
        });
        if (updated.count === 0) {
          await tx.refundStatusHistory.create({
            data: {
              refundId,
              fromStatus: lease.fromStatus,
              toStatus: lease.fromStatus,
              remark: `管理员手动重试时状态已被并发更新，跳过覆盖（外部结果: ${result.success ? '成功' : '失败'}）`,
              operatorId: adminUserId,
            },
          });
          return { status: 'concurrentSkip' as const };
        }

        await tx.refundStatusHistory.create({
          data: {
            refundId,
            fromStatus: lease.fromStatus,
            toStatus,
            remark: result.success ? '管理员手动重试成功' : `管理员手动重试失败: ${result.message ?? ''}`,
            operatorId: adminUserId,
          },
        });
        return { status: 'written' as const };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      if (writeBack.status === 'providerRefundIdConflict') {
        throw new ConflictException('退款渠道流水号已被其他退款单占用，请人工核对');
      }
    } catch (err) {
      const isProviderRefundIdP2002 =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        String(err.meta?.target ?? '').includes('providerRefundId');

      if (!isProviderRefundIdP2002) throw err;

      await this.prisma.$transaction(async (tx) => {
        await tx.refundStatusHistory.create({
          data: {
            refundId,
            fromStatus: lease.fromStatus,
            toStatus: lease.fromStatus,
            remark: `providerRefundId P2002 冲突，跳过覆盖: ${providerRefundId ?? '(empty)'}`,
            operatorId: adminUserId,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      throw new ConflictException('退款渠道流水号已被其他退款单占用，请人工核对');
    }

    return { ok: result.success, message: result.message };
  }

  /**
   * 发货
   * C3修复：Serializable 隔离级别 + CAS 防并发，状态检查移到事务内
   * Bug 86: 新增 useCarrierAuto 路径 — 调顺丰 SF API 自动取号 + OSS 持久化电子面单
   */
  async ship(orderId: string, dto: AdminShipDto) {
    // ─── 校验 + 公司归属（事务外，与事务内 CAS 互补）─────
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { select: { companyId: true } },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'PAID') throw new BadRequestException('仅已支付订单可发货');
    const companyIds = [...new Set(order.items.map((i) => i.companyId).filter(Boolean))];
    if (companyIds.length !== 1) {
      throw new BadRequestException('混合订单需由各卖家公司分别发货，管理员不可整单手动发货');
    }
    const companyId = companyIds[0]!;

    // ─── 自动取号路径：调 SF API 拿 waybillNo + 上传 PDF 到 OSS（事务前完成）───
    // Phase 2 hotfix-3: resolvedWaybillNo 必须 init 为 null
    // 之前 init = dto.trackingNo || null 导致手填路径把 trackingNo 同时写入 waybillNo
    // 而 waybillNo 语义专属 SF 自动取号；trackingNo 才是任意承运商运单号 — 两个字段不能交叉
    let resolvedCarrierCode = dto.carrierCode || 'SF';
    let resolvedCarrierName = dto.carrierName || '';
    let resolvedWaybillNo: string | null = null;
    let resolvedTrackingNo: string | null = null;
    let resolvedSfOrderId: string | null = null;
    let resolvedWaybillUrl: string | null = null;

    if (dto.useCarrierAuto) {
      // 自动取号只支持顺丰，避免误传 carrierCode 与实际承运商不一致
      if (dto.carrierCode && dto.carrierCode !== 'SF') {
        throw new BadRequestException(
          '自动取号目前只支持顺丰（SF），其他承运商请关闭自动模式手填运单号',
        );
      }
      // Phase 2 hotfix: 防孤儿单 — 已有 waybillNo 拒绝重复取号
      // 卖家可能已经在商家中心生成过面单；此时再取一次会留下旧 SF 单号且不取消
      // ⚠️ TOCTOU race（事务外 check + 事务外调 SF + 事务内 upsert）：
      //   admin 与 seller 同时操作同一订单时存在小概率窗口造成双单
      //   缓解：admin 路径低频 + seller-shipping 已有 advisory lock
      //   彻底修复：Phase 3 把 admin 也用同一把 advisory lock（PG_TRY_ADVISORY_XACT_LOCK）
      const existing = await this.prisma.shipment.findUnique({
        where: { orderId_companyId: { orderId, companyId } },
      });
      if (existing?.waybillNo) {
        throw new BadRequestException(
          `该订单已生成面单（${existing.waybillNo.slice(0, 4)}****），请先在商家中心取消旧面单再重新发货`,
        );
      }
      const auto = await this.createSfWaybillForAdminShip(orderId, companyId, order);
      resolvedCarrierCode = 'SF';
      resolvedCarrierName = '顺丰速运';
      resolvedWaybillNo = auto.waybillNo;
      resolvedSfOrderId = auto.sfOrderId;
      resolvedWaybillUrl = auto.waybillUrl;
    } else {
      // 手填路径：carrierCode + carrierName + trackingNo 三者必传
      const manualTrackingNo = this.normalizeTrackingNo(dto.trackingNo);
      if (!dto.carrierCode || !dto.carrierName || !manualTrackingNo) {
        throw new BadRequestException('手填发货必须提供 carrierCode / carrierName / trackingNo');
      }
      this.assertManualTrackingNoValid(manualTrackingNo);
      resolvedTrackingNo = manualTrackingNo;
    }

    // ─── 事务内：写 Shipment + 推订单状态 ───
    // 若事务最终失败 + 自动取号路径已拿到 SF 单号 → 补偿 cancelOrder 防孤儿运单
    let txCommitted = false;
    const MAX_RETRIES = 3;
    try {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          // 复查订单状态（防并发）
          const fresh = await tx.order.findUnique({ where: { id: orderId } });
          if (!fresh) throw new NotFoundException('订单不存在');
          if (fresh.status !== 'PAID') {
            throw new ConflictException('订单状态已变更，请刷新后重试');
          }

          // Phase 2 hotfix-3: in-tx existing-shipment 二次校验（TOCTOU race 缓解）
          // 自动取号场景的 race 窗口：
          //   1) admin 在事务外查 shipment（无 waybillNo） → 调 SF API（慢）
          //   2) 与此同时 seller 在自己后台完成发货（写入 shipment.waybillNo）
          //   3) admin 事务内 upsert 会 update 把 waybillNo 改成 admin 这次取的号，
          //      seller 那次的 SF 单号成孤儿
          // 在事务内（Serializable）再查一次，发现已存在不同 waybillNo 就 abort
          // 由 try/finally 块负责取消 admin 这次创建的 SF 单
          // Phase 3 backlog: PG advisory lock 彻底防 race
          if (dto.useCarrierAuto && resolvedWaybillNo) {
            const existingInTx = await tx.shipment.findUnique({
              where: { orderId_companyId: { orderId, companyId } },
              select: { waybillNo: true },
            });
            if (existingInTx?.waybillNo && existingInTx.waybillNo !== resolvedWaybillNo) {
              throw new ConflictException(
                `该订单已被另一路径生成面单（${existingInTx.waybillNo.slice(0, 4)}****），本次操作已取消`,
              );
            }
          }

          const { autoConfirmDays } = await this.bonusConfig.getSystemConfig();

          // upsert Shipment（与 seller-shipping 兼容，避免唯一键冲突）
          // update 路径用 ?? undefined 让 Prisma 不覆盖已有非空值
          // 例：手填发货后又调自动取号 → waybillNo 写 SFxxx，trackingNo 保持原值不被清空
          const shippedAt = new Date();
          const upsertedShipment = await tx.shipment.upsert({
            where: { orderId_companyId: { orderId, companyId } },
            create: {
              orderId,
              companyId,
              carrierCode: resolvedCarrierCode,
              carrierName: resolvedCarrierName,
              waybillNo: resolvedWaybillNo,
              trackingNo: resolvedTrackingNo,
              waybillUrl: resolvedWaybillUrl,
              sfOrderId: resolvedSfOrderId,
              status: 'SHIPPED',
              shippedAt,
            },
            update: {
              carrierCode: resolvedCarrierCode,
              carrierName: resolvedCarrierName,
              waybillNo: resolvedWaybillNo ?? undefined,
              trackingNo: resolvedTrackingNo ?? undefined,
              waybillUrl: resolvedWaybillUrl ?? undefined,
              sfOrderId: resolvedSfOrderId ?? undefined,
              status: 'SHIPPED',
              shippedAt,
            },
          });

          // 写入初始物流轨迹事件——确保 App 物流页第一时间有可见节点
          // 顺丰 SF 真实揽件推送 opCode=50 晚几小时甚至几天才到，
          // 中间这段空白由"卖家已发货，等待快递员揽件"占位
          // 已有同 message 事件则跳过（防 admin/seller 双路径重复发货时 createMany 唯一约束失败）
          const existingShippedEvent = await tx.shipmentTrackingEvent.findFirst({
            where: { shipmentId: upsertedShipment.id, statusCode: 'SHIPPED' },
            select: { id: true },
          });
          if (!existingShippedEvent) {
            await tx.shipmentTrackingEvent.create({
              data: {
                shipmentId: upsertedShipment.id,
                occurredAt: shippedAt,
                message: '卖家已发货，等待快递员揽件',
                location: null,
                statusCode: 'SHIPPED',
              },
            });
          }

          const autoReceiveAt = new Date();
          autoReceiveAt.setDate(autoReceiveAt.getDate() + autoConfirmDays);

          // CAS：用 updateMany + where 条件隐式校验状态未被并发修改
          const result = await tx.order.updateMany({
            where: { id: orderId, status: 'PAID' },
            data: { status: 'SHIPPED', autoReceiveAt },
          });
          if (result.count === 0) {
            throw new ConflictException('订单状态已变更，请刷新后重试');
          }

          const reasonNo = resolvedWaybillNo || resolvedTrackingNo || 'N/A';
          await tx.orderStatusHistory.create({
            data: {
              orderId,
              fromStatus: 'PAID',
              toStatus: 'SHIPPED',
              reason: `发货 ${resolvedCarrierName} ${reasonNo}${dto.useCarrierAuto ? '（自动取号）' : ''}`,
            },
          });

          return { ok: true, waybillNo: resolvedWaybillNo, waybillUrl: resolvedWaybillUrl };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        txCommitted = true;
        return result;
      } catch (e: any) {
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) continue;
        throw e;
      }
    }
    } finally {
      // 自动取号已拿到 SF 单号但事务未 commit → 取消 SF 单防孤儿
      if (!txCommitted && dto.useCarrierAuto && resolvedWaybillNo && resolvedSfOrderId) {
        try {
          await this.sfExpress.cancelOrder(resolvedSfOrderId, resolvedWaybillNo);
          this.logger.warn(
            `[admin] 事务失败，已补偿取消 SF 孤儿运单: orderId=${orderId}, waybillNo=${resolvedWaybillNo}`,
          );
        } catch (cancelErr: any) {
          this.logger.error(
            `[admin] SF 孤儿运单取消失败需人工处理: orderId=${orderId}, waybillNo=${resolvedWaybillNo}, err=${cancelErr.message}`,
          );
        }
      }
    }
  }

  /**
   * Bug 86: 管理员代理某商家调顺丰自动取号 + 生成电子面单 PDF + OSS 持久化
   *
   * 与 seller-shipping.service.ts:generateWaybill 业务对齐，但简化为不带 SellerStaff 审计/锁的版本
   * （admin 操作有独立 AdminAuditLog 在 controller 层）
   */
  private async createSfWaybillForAdminShip(
    orderId: string,
    companyId: string,
    order: { addressSnapshot: Prisma.JsonValue | null },
  ): Promise<{ waybillNo: string; sfOrderId: string; waybillUrl: string | null }> {
    // 1. 发件人信息（来自 Company）
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, servicePhone: true, address: true, contact: true },
    });
    if (!company) throw new NotFoundException('企业信息不存在');
    const cAddr = company.address as Record<string, any> | null;
    const cContact = company.contact as Record<string, any> | null;
    if (!cAddr?.province || !cAddr?.city || !cAddr?.detail) {
      throw new BadRequestException(
        `企业发货地址不完整（省/市/详细任一为空），请该商家在卖家后台「公司信息」补完地址后再发货。Company=${company.name}`,
      );
    }

    // 2. 收件人信息（解密订单地址快照；兼容明文/加密 envelope）
    // checkout.service.ts:377 写入字段：recipientName / phone / regionText / regionCode /
    //                                    province / city / district / detail
    const decryptedAddress = decryptJsonValue(order.addressSnapshot);
    if (
      !decryptedAddress ||
      typeof decryptedAddress !== 'object' ||
      Array.isArray(decryptedAddress)
    ) {
      throw new BadRequestException('订单收件地址格式错误，请检查数据完整性');
    }
    const addr = decryptedAddress as Record<string, any>;
    const recipientName = String(addr.recipientName ?? addr.name ?? '').trim();
    const recipientPhone = String(addr.phone ?? addr.tel ?? '').trim();
    if (!recipientName || !recipientPhone) {
      throw new BadRequestException('订单收件人姓名/电话缺失，请检查数据完整性');
    }
    // 优先用结构化字段；不存在则解析 regionText
    let recvProvince = String(addr.province ?? '').trim();
    let recvCity = String(addr.city ?? '').trim();
    let recvDistrict = String(addr.district ?? '').trim();
    if (!recvProvince || !recvCity) {
      const parsed = parseChineseAddress(String(addr.regionText ?? ''));
      recvProvince = recvProvince || parsed.province || '';
      recvCity = recvCity || parsed.city || '';
      recvDistrict = recvDistrict || parsed.district || '';
    }
    const recvDetail = String(addr.detail ?? '').trim();
    if (!recvProvince || !recvCity || !recvDetail) {
      throw new BadRequestException('订单收件地址不完整（省/市/详细）');
    }

    // 3. 商品描述（取首件）
    const items = await this.prisma.orderItem.findMany({
      where: { orderId, companyId },
      select: { quantity: true, sku: { select: { product: { select: { title: true } } } } },
    });
    const cargoDesc = items
      .map((i) => i.sku?.product?.title || '商品')
      .slice(0, 3)
      .join(', ');

    // 4. 调 SF createOrder
    const orderResult = await this.sfExpress.createOrder({
      orderId: `${orderId}_${companyId}`,
      sender: {
        name: cContact?.name || company.name,
        tel: cContact?.phone || company.servicePhone || '',
        province: cAddr.province,
        city: cAddr.city,
        district: cAddr.district || '',
        detail: cAddr.detail || '',
      },
      receiver: {
        name: recipientName,
        tel: recipientPhone,
        province: recvProvince,
        city: recvCity,
        district: recvDistrict,
        detail: recvDetail,
      },
      cargo: cargoDesc || '商品',
      packageCount: 1,
    });

    // 5. 云打印 → OSS 持久化（失败不阻塞发货，参考 seller-shipping）
    let waybillUrl: string | null = null;
    try {
      const printResult = await this.sfExpress.printWaybill(orderResult.waybillNo);
      try {
        const fetched = await fetchBinaryWithLimit(printResult.pdfUrl, {
          maxBytes: 10 * 1024 * 1024,
          timeoutMs: 15000,
          allowedContentTypes: ['application/pdf', 'application/octet-stream'],
        });
        const uploaded = await this.uploadService.uploadBuffer(
          fetched.buffer,
          'waybills',
          '.pdf',
          'application/pdf',
        );
        waybillUrl = uploaded.url;
      } catch (persistErr: any) {
        this.logger.error(
          `[admin] 面单 PDF OSS 持久化失败（waybillUrl 留空）: orderId=${orderId}, waybillNo=${orderResult.waybillNo}, err=${persistErr.message}`,
        );
      }
    } catch (err: any) {
      this.logger.warn(`[admin] 面单打印失败（不阻塞发货）: ${err.message}`);
    }

    return {
      waybillNo: orderResult.waybillNo,
      sfOrderId: orderResult.sfOrderId,
      waybillUrl,
    };
  }

  /**
   * 取消订单（含库存恢复）
   * C2修复：Serializable 隔离级别 + CAS 防并发
   */
  async cancel(orderId: string, reason: string) {
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          // 在事务内读取订单，确保 Serializable 一致性
          const order = await tx.order.findUnique({
            where: { id: orderId },
            include: { items: true },
          });
          if (!order) throw new NotFoundException('订单不存在');
          if (order.status !== 'PENDING_PAYMENT') {
            throw new BadRequestException('仅待支付订单可取消');
          }

          // P0-2: 恢复库存 + 写 InventoryLedger
          for (const item of order.items) {
            await tx.productSKU.update({
              where: { id: item.skuId },
              data: { stock: { increment: item.quantity } },
            });
            await tx.inventoryLedger.create({
              data: {
                skuId: item.skuId,
                type: 'RELEASE',
                qty: item.quantity,
                refType: 'ORDER',
                refId: orderId,
              },
            });
          }

          // N12修复：恢复被使用的奖励（与买家端 cancelOrder 一致）
          await tx.rewardLedger.updateMany({
            where: { refType: 'ORDER', refId: orderId, status: 'VOIDED' },
            data: { status: 'AVAILABLE', refType: null, refId: null },
          });

          // CAS：用 updateMany + where 条件隐式校验状态未被并发修改
          const result = await tx.order.updateMany({
            where: { id: orderId, status: 'PENDING_PAYMENT' },
            data: { status: 'CANCELED' },
          });
          if (result.count === 0) {
            throw new ConflictException('订单状态已变更，请刷新后重试');
          }

          await tx.orderStatusHistory.create({
            data: {
              orderId,
              fromStatus: 'PENDING_PAYMENT',
              toStatus: 'CANCELED',
              reason,
            },
          });

          return { ok: true };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (e: any) {
        // P2034: Serializable 事务冲突，重试
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) continue;
        throw e;
      }
    }
  }
}
