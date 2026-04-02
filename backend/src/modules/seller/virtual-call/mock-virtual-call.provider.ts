import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VirtualCallProvider } from './virtual-call-provider.interface';

/**
 * 虚拟号服务 Mock 实现（占位实现）
 *
 * 占位实现：返回 170 开头的模拟虚拟号，有效期由调用方指定。
 * 生产环境需对接阿里云隐私号（AXB 中间号）或腾讯云小号服务。
 *
 * TODO: 对接阿里云隐私号 AXB 服务
 *
 * 真实对接步骤（以阿里云隐私号为例）：
 * 1. 在阿里云开通「号码隐私保护」服务，创建号码池
 * 2. 调用 BindAxb 接口绑定三元组（A=买家, X=虚拟号, B=卖家）
 * 3. 绑定成功后，买家拨打 X 号码会自动转接到卖家 B，反之亦然
 * 4. 绑定到期或手动调用 UnbindSubscription 解绑释放号码资源
 * 5. 可选：配置录音、话单推送回调 URL
 *
 * 阿里云 API 文档: https://help.aliyun.com/document_detail/400044.html
 * 腾讯云 API 文档: https://cloud.tencent.com/document/product/610
 *
 * 所需环境变量：
 * - VIRTUAL_CALL_API_KEY: 阿里云 AccessKeyId / 腾讯云 SecretId
 * - VIRTUAL_CALL_API_SECRET: 阿里云 AccessKeySecret / 腾讯云 SecretKey
 * - VIRTUAL_CALL_POOL_KEY: 号码池 Key（阿里云 PoolKey / 腾讯云 AppId）
 * - VIRTUAL_CALL_PROVIDER_TYPE: 服务商类型（aliyun / tencent），默认 aliyun
 */
@Injectable()
export class MockVirtualCallProvider implements VirtualCallProvider {
  private readonly logger = new Logger(MockVirtualCallProvider.name);

  /** 虚拟号服务 API 密钥（占位：未配置时为 undefined） */
  private readonly apiKey?: string;
  /** 虚拟号服务 API 密钥（占位：未配置时为 undefined） */
  private readonly apiSecret?: string;
  /** 号码池标识 */
  private readonly poolKey?: string;
  /** 服务商类型 */
  private readonly providerType: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('VIRTUAL_CALL_API_KEY');
    this.apiSecret = this.configService.get<string>('VIRTUAL_CALL_API_SECRET');
    this.poolKey = this.configService.get<string>('VIRTUAL_CALL_POOL_KEY');
    this.providerType = this.configService.get<string>(
      'VIRTUAL_CALL_PROVIDER_TYPE',
      'aliyun',
    );

    if (!this.apiKey || !this.apiSecret) {
      this.logger.warn(
        '虚拟号服务 API 密钥未配置（VIRTUAL_CALL_API_KEY / VIRTUAL_CALL_API_SECRET），当前使用 Mock 实现',
      );
    }
  }

  /**
   * 绑定虚拟号
   *
   * TODO: 真实实现需调用阿里云 BindAxb / 腾讯云 CreateCallBack 接口
   *
   * 阿里云 BindAxb 参数说明：
   * - PhoneNoA: 买家真实号码
   * - PhoneNoB: 卖家真实号码
   * - PoolKey: 号码池标识
   * - Expiration: 绑定过期时间（ISO 8601 格式）
   * - IsRecordingEnabled: 是否开启录音（可选）
   *
   * 返回值中 SecretBindDTO.SecretNo 即为虚拟中间号 X
   */
  async bindNumber(params: {
    sellerPhone: string;
    buyerPhone: string;
    expireMinutes: number;
  }): Promise<{ virtualNo: string; expireAt: Date }> {
    // TODO: 对接阿里云隐私号 / 腾讯云小号，替换以下 Mock 逻辑
    const randomDigits = Math.floor(10000000 + Math.random() * 90000000).toString();
    const virtualNo = `170${randomDigits}`;

    const expireAt = new Date();
    expireAt.setMinutes(expireAt.getMinutes() + params.expireMinutes);

    this.logger.log(
      `[Mock] 绑定虚拟号: ${virtualNo}, 卖家=${params.sellerPhone}, 买家=${params.buyerPhone}, ` +
      `有效期=${params.expireMinutes}分钟, 过期时间=${expireAt.toISOString()}`,
    );

    // TODO: 替换为真实 API 调用
    // if (this.providerType === 'aliyun') {
    //   const response = await aliyunClient.bindAxb({
    //     PhoneNoA: params.buyerPhone,
    //     PhoneNoB: params.sellerPhone,
    //     PoolKey: this.poolKey,
    //     Expiration: expireAt.toISOString(),
    //   });
    //   return {
    //     virtualNo: response.SecretBindDTO.SecretNo,
    //     expireAt,
    //   };
    // }

    return { virtualNo, expireAt };
  }

  /**
   * 解绑虚拟号
   *
   * TODO: 真实实现需调用阿里云 UnbindSubscription / 腾讯云 DeleteCallBack 接口
   *
   * 阿里云 UnbindSubscription 参数说明：
   * - PoolKey: 号码池标识
   * - SecretNo: 需要释放的虚拟号
   * - SubsId: 绑定关系 ID（BindAxb 返回）
   */
  async unbindNumber(virtualNo: string): Promise<void> {
    // TODO: 对接阿里云隐私号 / 腾讯云小号，替换以下 Mock 逻辑
    this.logger.log(`[Mock] 解绑虚拟号: ${virtualNo}`);

    // TODO: 替换为真实 API 调用
    // if (this.providerType === 'aliyun') {
    //   await aliyunClient.unbindSubscription({
    //     PoolKey: this.poolKey,
    //     SecretNo: virtualNo,
    //     SubsId: subscriptionId, // 需要从数据库中查询绑定关系 ID
    //   });
    // }
  }

  /**
   * 获取通话录音（Mock 占位实现）
   *
   * TODO: 对接阿里云隐私号录音下载 / 腾讯云小号录音接口
   *
   * 阿里云 GetSecretAsrDetail 参数说明：
   * - CallId: 通话记录 ID（话单推送中获取）
   * - CallTime: 通话时间
   *
   * 真实实现应根据 bindingId 查询运营商侧录音文件，返回可下载的 URL
   */
  async getCallRecording(
    bindingId: string,
  ): Promise<{ recordingUrl: string; duration: number } | null> {
    this.logger.log(`[Mock] 获取通话录音: bindingId=${bindingId}, 返回 null（占位实现）`);

    // TODO: 替换为真实 API 调用
    // if (this.providerType === 'aliyun') {
    //   const detail = await aliyunClient.getSecretAsrDetail({ CallId: bindingId });
    //   if (detail?.RecordingUrl) {
    //     return { recordingUrl: detail.RecordingUrl, duration: detail.Duration };
    //   }
    // }

    return null;
  }
}
