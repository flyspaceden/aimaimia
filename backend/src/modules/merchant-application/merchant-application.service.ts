import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { createId } from '@paralleldrive/cuid2';
import { PrismaService } from '../../prisma/prisma.service';
import { CaptchaService } from '../captcha/captcha.service';
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
  ) {}

  async create(dto: CreateMerchantApplicationDto, file: Express.Multer.File) {
    // 1. 验证码校验
    const captchaValid = await this.captchaService.verify(dto.captchaId, dto.captchaCode);
    if (!captchaValid) {
      throw new BadRequestException('验证码错误或已过期');
    }

    // 2. 文件校验
    this.validateFile(file);

    // 3. 保存文件
    const fileUrl = await this.saveFile(file);

    // 4. 检查是否已有 PENDING 申请（静默返回，不暴露状态）
    const existing = await this.prisma.merchantApplication.findFirst({
      where: { phone: dto.phone, status: 'PENDING' },
    });
    if (existing) {
      return { message: '申请已提交，请等待审核' };
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

  private async saveFile(file: Express.Multer.File): Promise<string> {
    const ext = file.originalname.split('.').pop() || 'bin';
    const filename = `${createId()}.${ext}`;
    const dir = 'uploads/merchant-applications';

    const fs = await import('fs/promises');
    const path = await import('path');
    const fullDir = path.join(process.cwd(), dir);
    await fs.mkdir(fullDir, { recursive: true });

    const fullPath = path.join(fullDir, filename);
    await fs.writeFile(fullPath, file.buffer);

    return `/${dir}/${filename}`;
  }
}
