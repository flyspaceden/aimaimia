import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  VirtualCallProvider,
  VIRTUAL_CALL_PROVIDER,
} from './virtual-call-provider.interface';
import { CallKeywordDetectorService } from './call-keyword-detector.service';
import { encryptText } from '../../../common/security/encryption';
import { SellerRiskControlService } from '../risk-control/seller-risk-control.service';

/** 每个订单/换货单最多绑定虚拟号次数 */
const MAX_BINDINGS_PER_TARGET = 3;

/** 虚拟号默认有效时长（分钟），24 小时 */
const DEFAULT_EXPIRE_MINUTES = 24 * 60;

@Injectable()
export class VirtualCallService {
  private readonly logger = new Logger(VirtualCallService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(VIRTUAL_CALL_PROVIDER)
    private readonly callProvider: VirtualCallProvider,
    private readonly keywordDetector: CallKeywordDetectorService,
    private readonly sellerRiskControl: SellerRiskControlService,
  ) {}

  private assertStrictOrderOwnership(
    companyId: string,
    items: Array<{ companyId: string | null }>,
  ) {
    const hasMyItems = items.some((item) => item.companyId === companyId);
    if (!hasMyItems) {
      throw new ForbiddenException('无权操作该订单');
    }

    const hasForeignItems = items.some((item) => item.companyId !== companyId);
    if (hasForeignItems) {
      throw new ForbiddenException('该订单包含其他企业商品，请联系平台处理');
    }
  }

  private encryptBuyerPhone(phone: string): string {
    const encrypted = encryptText(phone);
    if (!encrypted) {
      this.logger.error('买家手机号加密结果为空，拒绝创建虚拟号绑定');
      throw new InternalServerErrorException('买家联系方式处理失败');
    }
    return encrypted;
  }

  private requireBuyerPhone(phone?: string | null): string {
    const normalized = phone?.trim();
    if (!normalized) {
      throw new BadRequestException('买家未绑定手机号，无法联系');
    }
    return normalized;
  }

  private requireSellerPhone(phone?: string | null): string {
    const normalized = phone?.trim();
    if (!normalized) {
      throw new BadRequestException('企业未配置客服电话，无法联系买家');
    }
    return normalized;
  }

  /**
   * 为订单绑定虚拟号
   *
   * 业务规则：
   * 1. 订单必须存在且属于当前企业
   * 2. 订单状态必须为 PAID 或 SHIPPED
   * 3. 每个订单最多绑定 3 次
   * 4. 使用 Serializable 隔离级别防止并发超限绑定
   */
  async bindForOrder(companyId: string, staffId: string, orderId: string) {
    await this.sellerRiskControl.assertFeatureAllowed(companyId, 'VIRTUAL_CALL');

    // 验证订单存在且属于本企业
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { select: { companyId: true } },
        user: {
          include: {
            authIdentities: {
              where: { provider: 'PHONE' },
              select: { identifier: true },
              take: 1,
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    this.assertStrictOrderOwnership(companyId, order.items);

    // 验证订单状态：只有 PAID 或 SHIPPED 的订单才允许联系买家
    if (order.status !== 'PAID' && order.status !== 'SHIPPED') {
      throw new BadRequestException('只有已付款或已发货的订单才能联系买家');
    }

    // 获取买家手机号（从 AuthIdentity PHONE 类型获取）
    const buyerPhone = this.requireBuyerPhone(
      order.user?.authIdentities?.[0]?.identifier,
    );

    // 获取企业客服电话
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { servicePhone: true },
    });
    const sellerPhone = this.requireSellerPhone(company?.servicePhone);

    // 使用 Serializable 事务防止并发超限绑定
    return this.prisma.$transaction(
      async (tx) => {
        // 事务内计数已有绑定次数
        const existingCount = await tx.virtualCallBinding.count({
          where: {
            orderId,
            companyId,
            expireAt: { gt: new Date() },
          },
        });

        if (existingCount >= MAX_BINDINGS_PER_TARGET) {
          throw new BadRequestException(
            `该订单已达到最大联系次数（${MAX_BINDINGS_PER_TARGET}次）`,
          );
        }

        // 调用虚拟号服务绑定
        const { virtualNo, expireAt } = await this.callProvider.bindNumber({
          sellerPhone,
          buyerPhone,
          expireMinutes: DEFAULT_EXPIRE_MINUTES,
        });

        // 创建绑定记录
        await tx.virtualCallBinding.create({
          data: {
            orderId,
            companyId,
            sellerPhone,
            buyerPhone: this.encryptBuyerPhone(buyerPhone),
            virtualNo,
            expireAt,
            staffId,
          },
        });

        const remainingCalls = MAX_BINDINGS_PER_TARGET - existingCount - 1;

        return {
          virtualNumber: virtualNo,
          expireAt: expireAt.toISOString(),
          remainingCalls,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * 为售后申请绑定虚拟号
   *
   * 业务规则：
   * 1. 售后申请必须存在且关联订单属于当前企业
   * 2. 售后状态必须为 REQUESTED、UNDER_REVIEW 或 APPROVED
   * 3. 每个售后申请最多绑定 3 次
   * 4. 使用 Serializable 隔离级别防止并发超限绑定
   */
  async bindForReplacement(
    companyId: string,
    staffId: string,
    replacementId: string,
  ) {
    await this.sellerRiskControl.assertFeatureAllowed(companyId, 'VIRTUAL_CALL');

    // 验证售后申请存在
    const replacement = await this.prisma.afterSaleRequest.findUnique({
      where: { id: replacementId },
      include: {
        order: {
          include: {
            items: { select: { companyId: true } },
          },
        },
        orderItem: {
          select: { companyId: true },
        },
        user: {
          include: {
            authIdentities: {
              where: { provider: 'PHONE' },
              select: { identifier: true },
              take: 1,
            },
          },
        },
      },
    });

    if (!replacement) {
      throw new NotFoundException('换货申请不存在');
    }

    if (replacement.orderItemId) {
      if (replacement.orderItem?.companyId !== companyId) {
        throw new ForbiddenException('无权操作该换货申请');
      }
    } else {
      this.assertStrictOrderOwnership(companyId, replacement.order.items);
    }

    // 验证换货状态：只有处理中的换货申请才允许联系买家
    const allowedStatuses = ['REQUESTED', 'UNDER_REVIEW', 'APPROVED'];
    if (!allowedStatuses.includes(replacement.status)) {
      throw new BadRequestException(
        '只有待处理、审核中或已批准的换货申请才能联系买家',
      );
    }

    // 获取买家手机号
    const buyerPhone = this.requireBuyerPhone(
      replacement.user?.authIdentities?.[0]?.identifier,
    );

    // 获取企业客服电话
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { servicePhone: true },
    });
    const sellerPhone = this.requireSellerPhone(company?.servicePhone);

    // 使用 Serializable 事务防止并发超限绑定
    return this.prisma.$transaction(
      async (tx) => {
        // 事务内计数已有绑定次数
        const existingCount = await tx.virtualCallBinding.count({
          where: {
            replacementId,
            companyId,
            expireAt: { gt: new Date() },
          },
        });

        if (existingCount >= MAX_BINDINGS_PER_TARGET) {
          throw new BadRequestException(
            `该换货申请已达到最大联系次数（${MAX_BINDINGS_PER_TARGET}次）`,
          );
        }

        // 调用虚拟号服务绑定
        const { virtualNo, expireAt } = await this.callProvider.bindNumber({
          sellerPhone,
          buyerPhone,
          expireMinutes: DEFAULT_EXPIRE_MINUTES,
        });

        // 创建绑定记录
        await tx.virtualCallBinding.create({
          data: {
            replacementId,
            companyId,
            sellerPhone,
            buyerPhone: this.encryptBuyerPhone(buyerPhone),
            virtualNo,
            expireAt,
            staffId,
          },
        });

        const remainingCalls = MAX_BINDINGS_PER_TARGET - existingCount - 1;

        return {
          virtualNumber: virtualNo,
          expireAt: expireAt.toISOString(),
          remainingCalls,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * 清理过期的虚拟号绑定记录
   *
   * 定时任务：每小时执行一次
   * 1. 查询所有过期的绑定记录
   * 2. 调用 provider 解绑虚拟号
   * 3. 删除绑定记录
   */
  @Cron('0 * * * *')
  async cleanExpiredBindings() {
    this.logger.log('开始清理过期虚拟号绑定...');

    try {
      const expiredBindings = await this.prisma.virtualCallBinding.findMany({
        where: { expireAt: { lt: new Date() } },
      });

      if (expiredBindings.length === 0) {
        this.logger.log('没有过期的虚拟号绑定需要清理');
        return;
      }

      // 逐条解绑并删除
      for (const binding of expiredBindings) {
        try {
          await this.callProvider.unbindNumber(binding.virtualNo);
        } catch (err) {
          // 解绑失败不影响清理流程，继续处理下一条
          this.logger.warn(
            `解绑虚拟号失败: ${binding.virtualNo}, 错误: ${(err as Error).message}`,
          );
        }
      }

      // 批量删除过期记录
      const { count } = await this.prisma.virtualCallBinding.deleteMany({
        where: { expireAt: { lt: new Date() } },
      });

      this.logger.log(`清理完成，删除 ${count} 条过期虚拟号绑定`);
    } catch (err) {
      this.logger.error(`清理过期虚拟号绑定失败: ${(err as Error).message}`);
    }
  }

  /**
   * 处理通话录音：拉取录音 → 关键词检测 → 违规记录
   *
   * 业务流程：
   * 1. 从 Provider 获取通话录音信息
   * 2. TODO: 调用 ASR 服务将录音转为文本（当前跳过，需要 ASR 集成后启用）
   * 3. 对转写文本运行关键词检测
   * 4. 记录违规结果（当前仅日志，TODO: 持久化到数据库）
   *
   * TODO: 此方法目前为基础设施，实际触发将来自运营商/云通信的通话结束 Webhook
   *       Webhook 回调中应携带 bindingId，触发录音获取与分析流程
   *
   * @param bindingId 虚拟号绑定记录 ID
   * @param transcript 通话转写文本（可选，传入则跳过 ASR 步骤；不传则尝试从录音获取）
   */
  async processCallRecording(
    bindingId: string,
    transcript?: string,
  ): Promise<void> {
    this.logger.log(`开始处理通话录音: bindingId=${bindingId}`);

    // 验证绑定记录存在
    const binding = await this.prisma.virtualCallBinding.findUnique({
      where: { id: bindingId },
    });

    if (!binding) {
      this.logger.warn(`通话录音处理失败: 绑定记录不存在 bindingId=${bindingId}`);
      return;
    }

    // 步骤 1: 获取通话录音
    let recordingUrl: string | null = null;
    let duration: number | null = null;

    if (this.callProvider.getCallRecording) {
      try {
        const recording =
          await this.callProvider.getCallRecording(bindingId);
        if (recording) {
          recordingUrl = recording.recordingUrl;
          duration = recording.duration;
          this.logger.log(
            `获取到通话录音: url=${recordingUrl}, 时长=${duration}秒`,
          );
        } else {
          this.logger.log(
            `绑定 ${bindingId} 暂无通话录音（可能通话未结束或 Provider 不支持）`,
          );
        }
      } catch (err) {
        this.logger.error(
          `获取通话录音失败: bindingId=${bindingId}, 错误: ${(err as Error).message}`,
        );
      }
    }

    // 步骤 2: 获取转写文本
    // TODO: 集成 ASR 服务（讯飞/阿里云语音识别），将 recordingUrl 转为文本
    //       示例伪代码:
    //       if (!transcript && recordingUrl) {
    //         transcript = await this.asrService.transcribe(recordingUrl);
    //       }
    if (!transcript) {
      this.logger.log(
        `绑定 ${bindingId} 无转写文本且 ASR 未集成，跳过关键词检测`,
      );
      return;
    }

    // 步骤 3: 运行关键词检测
    const result = this.keywordDetector.analyzeTranscript(transcript);

    // 步骤 4: 记录检测结果
    if (result.violations.length === 0) {
      this.logger.log(
        `绑定 ${bindingId} 通话内容检测通过，未发现违规关键词`,
      );
      return;
    }

    // 存在违规，记录详细信息
    this.logger.warn(
      `绑定 ${bindingId} 通话内容检测到 ${result.violations.length} 条违规:`,
    );
    for (const v of result.violations) {
      this.logger.warn(
        `  - [${v.category}] 关键词: "${v.keyword}" | 企业=${binding.companyId} | 虚拟号=${binding.virtualNo}`,
      );
    }

    try {
      await this.sellerRiskControl.recordPrivacyViolation(binding.companyId, {
        reason: '虚拟号通话检测到索要/泄露联系方式风险',
        sourceType: 'VIRTUAL_CALL',
        sourceRefId: bindingId,
        metadata: {
          bindingId,
          virtualNo: binding.virtualNo,
          violations: result.violations.map((v) => ({
            category: v.category,
            keyword: v.keyword,
          })),
        },
      });
    } catch (err) {
      this.logger.error(
        `企业信用分处罚落地失败: bindingId=${bindingId}, error=${(err as Error).message}`,
      );
    }

    // TODO: 将违规记录持久化到数据库（需新增 CallViolationRecord 模型）
    // TODO: 达到阈值时自动触发告警通知（站内信/短信通知管理员）
    // TODO: 严重违规可自动暂停卖家虚拟号权限
  }
}
