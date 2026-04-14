import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Dysmsapi20170525, * as $Dysmsapi20170525 from '@alicloud/dysmsapi20170525';
import * as $OpenApi from '@alicloud/openapi-client';
import * as $Util from '@alicloud/tea-util';

/**
 * 阿里云短信服务封装
 *
 * 使用 @alicloud/dysmsapi20170525 SDK 发送短信验证码。
 * 需要配置以下环境变量：
 * - SMS_ACCESS_KEY_ID: 阿里云 AccessKey ID
 * - SMS_ACCESS_KEY_SECRET: 阿里云 AccessKey Secret
 * - SMS_SIGN_NAME: 短信签名（例如"爱买买"）
 * - SMS_TEMPLATE_CODE: 短信模板编号（例如"SMS_123456"）
 */
@Injectable()
export class AliyunSmsService {
  private readonly logger = new Logger(AliyunSmsService.name);
  private client: Dysmsapi20170525 | null = null;

  constructor(private readonly config: ConfigService) {
    this.initClient();
  }

  /** 初始化阿里云 SMS 客户端（缺少配置时跳过，运行时调用会报错并记录日志） */
  private initClient() {
    const accessKeyId = this.config.get<string>('SMS_ACCESS_KEY_ID');
    const accessKeySecret = this.config.get<string>('SMS_ACCESS_KEY_SECRET');

    if (!accessKeyId || !accessKeySecret) {
      this.logger.warn(
        '[AliyunSMS] SMS_ACCESS_KEY_ID 或 SMS_ACCESS_KEY_SECRET 未配置，真实短信通道不可用',
      );
      return;
    }

    try {
      const apiConfig = new $OpenApi.Config({
        accessKeyId,
        accessKeySecret,
      });
      apiConfig.endpoint = 'dysmsapi.aliyuncs.com';
      this.client = new Dysmsapi20170525(apiConfig);
      this.logger.log('[AliyunSMS] 客户端初始化成功');
    } catch (err) {
      this.logger.error(
        `[AliyunSMS] 客户端初始化失败: ${(err as Error)?.message}`,
        (err as Error)?.stack,
      );
    }
  }

  /**
   * 发送短信验证码
   * @param phone 手机号
   * @param code 验证码（纯数字字符串）
   * @throws 当客户端未初始化或阿里云 API 返回非 OK 时抛出错误
   */
  async sendVerificationCode(phone: string, code: string): Promise<void> {
    if (!this.client) {
      throw new Error('阿里云 SMS 客户端未初始化，请检查 SMS_ACCESS_KEY_ID / SMS_ACCESS_KEY_SECRET 配置');
    }

    const signName = this.config.get<string>('SMS_SIGN_NAME');
    const templateCode = this.config.get<string>('SMS_TEMPLATE_CODE');

    if (!signName || !templateCode) {
      throw new Error('SMS_SIGN_NAME 或 SMS_TEMPLATE_CODE 未配置');
    }

    const sendSmsRequest = new $Dysmsapi20170525.SendSmsRequest({
      phoneNumbers: phone,
      signName,
      templateCode,
      templateParam: JSON.stringify({ code }),
    });

    const runtime = new $Util.RuntimeOptions({});

    const result = await this.client.sendSmsWithOptions(sendSmsRequest, runtime);

    if (result.body?.code !== 'OK') {
      const errCode = result.body?.code ?? 'UNKNOWN';
      const errMsg = result.body?.message ?? '未知错误';
      throw new Error(`阿里云短信发送失败: code=${errCode}, message=${errMsg}`);
    }

    this.logger.log(`[AliyunSMS] 短信发送成功（手机号尾号=${phone.slice(-4)}）`);
  }
}
