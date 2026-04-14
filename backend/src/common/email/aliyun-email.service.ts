import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * 阿里云邮件推送（DirectMail）SMTP 封装
 *
 * 使用 nodemailer 通过 SMTP 协议发送邮件。
 * 需要配置以下环境变量：
 * - EMAIL_SMTP_HOST: SMTP 服务器地址（默认 smtpdm.aliyun.com）
 * - EMAIL_SMTP_PORT: SMTP 端口（默认 465）
 * - EMAIL_SMTP_USER: 发信地址（如 noreply@mail.ai-maimai.com）
 * - EMAIL_SMTP_PASS: SMTP 密码
 */
@Injectable()
export class AliyunEmailService {
  private readonly logger = new Logger(AliyunEmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    this.initTransporter();
  }

  /** 初始化 SMTP 传输器（缺少配置时跳过） */
  private initTransporter() {
    const host = this.config.get<string>('EMAIL_SMTP_HOST', 'smtpdm.aliyun.com');
    const port = this.config.get<number>('EMAIL_SMTP_PORT', 465);
    const user = this.config.get<string>('EMAIL_SMTP_USER');
    const pass = this.config.get<string>('EMAIL_SMTP_PASS');

    if (!user || !pass) {
      this.logger.warn(
        '[AliyunEmail] EMAIL_SMTP_USER 或 EMAIL_SMTP_PASS 未配置，邮件通道不可用',
      );
      return;
    }

    try {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      this.logger.log('[AliyunEmail] SMTP 传输器初始化成功');
    } catch (err) {
      this.logger.error(
        `[AliyunEmail] SMTP 传输器初始化失败: ${(err as Error)?.message}`,
        (err as Error)?.stack,
      );
    }
  }

  /**
   * 发送邮箱验证码
   * @param to 收件人邮箱
   * @param code 验证码（纯数字字符串）
   */
  async sendVerificationCode(to: string, code: string): Promise<void> {
    if (!this.transporter) {
      throw new Error('邮件 SMTP 传输器未初始化，请检查 EMAIL_SMTP_USER / EMAIL_SMTP_PASS 配置');
    }

    const from = this.config.get<string>('EMAIL_SMTP_USER');

    await this.transporter.sendMail({
      from: `"爱买买" <${from}>`,
      to,
      subject: '【爱买买】您的验证码',
      html: `
        <div style="max-width:400px;margin:0 auto;padding:24px;font-family:sans-serif;">
          <h2 style="color:#2E7D32;margin-bottom:16px;">爱买买</h2>
          <p>您的验证码是：</p>
          <p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#333;margin:16px 0;">${code}</p>
          <p style="color:#999;font-size:14px;">验证码 5 分钟内有效，请勿泄露给他人。</p>
        </div>
      `,
    });

    this.logger.log(`[AliyunEmail] 验证码邮件已发送（目标=${to.replace(/(.{2}).*(@.*)/, '$1***$2')}）`);
  }
}
