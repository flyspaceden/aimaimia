import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CaptchaService } from '../captcha/captcha.service';
import { UploadService } from '../upload/upload.service';
import { CreateMerchantApplicationDto } from './dto/create-merchant-application.dto';

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const MAGIC_BYTES: Record<string, number[][]> = {
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],
  'image/png': [[0x89, 0x50, 0x4E, 0x47]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]],
};

@Injectable()
export class MerchantApplicationService {
  private readonly logger = new Logger(MerchantApplicationService.name);

  constructor(
    private prisma: PrismaService,
    private captchaService: CaptchaService,
    private uploadService: UploadService,
  ) {}

  async create(dto: CreateMerchantApplicationDto, file: Express.Multer.File) {
    // 1. 验证码校验
    const captchaValid = await this.captchaService.verify(dto.captchaId, dto.captchaCode);
    if (!captchaValid) {
      throw new BadRequestException('验证码错误或已过期');
    }

    // 2. 文件校验
    this.validateFile(file);

    // 3. 通过统一上传服务保存文件（自动适配本地/OSS）
    const uploadResult = await this.uploadService.uploadFile(file, 'merchant-applications');
    const fileUrl = uploadResult.url;

    // 4. 检查是否已有 PENDING 申请（静默返回，不暴露状态）
    const existing = await this.prisma.merchantApplication.findFirst({
      where: { phone: dto.phone, status: 'PENDING' },
    });
    if (existing) {
      return { message: '申请已提交，请等待审核' };
    }

    // 4.5 C50 修复：拒绝后 7 天冷却期，防止被拒商户立即刷屏重新提交
    const REJECT_COOLDOWN_DAYS = 7;
    const cooldownStart = new Date(Date.now() - REJECT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    const recentReject = await this.prisma.merchantApplication.findFirst({
      where: {
        phone: dto.phone,
        status: 'REJECTED',
        reviewedAt: { gt: cooldownStart },
      },
      orderBy: { reviewedAt: 'desc' },
    });
    if (recentReject && recentReject.reviewedAt) {
      const remainingMs = recentReject.reviewedAt.getTime() + REJECT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000 - Date.now();
      const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
      throw new BadRequestException(
        `您的前次申请未通过，请 ${remainingDays} 天后再试${recentReject.rejectReason ? `（原因：${recentReject.rejectReason}）` : ''}`,
      );
    }

    // 5. 创建申请
    await this.prisma.merchantApplication.create({
      data: {
        companyName: dto.companyName,
        category: dto.category,
        contactName: dto.contactName,
        phone: dto.phone,
        email: dto.email || null,
        licenseFileUrl: fileUrl,
      },
    });

    return { message: '申请已提交，请等待审核' };
  }

  private validateFile(file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('请上传营业执照');
    }
    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      throw new BadRequestException('仅支持 JPG、PNG、PDF 格式');
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('文件大小不能超过 5MB');
    }
    const expected = MAGIC_BYTES[file.mimetype];
    if (expected) {
      const header = Array.from(new Uint8Array(file.buffer.slice(0, 8)));
      const valid = expected.some((magic) =>
        magic.every((byte, i) => header[i] === byte),
      );
      if (!valid) {
        throw new BadRequestException('文件内容与类型不匹配');
      }
    }
  }

}
