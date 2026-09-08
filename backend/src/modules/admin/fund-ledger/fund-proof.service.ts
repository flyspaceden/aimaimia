import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';

/** 银行凭证独立私有存储，不经过公开商品图片上传或静态目录。 */
@Injectable()
export class FundProofService {
  constructor(private readonly prisma: PrismaService) {}

  async upload(file: Express.Multer.File | undefined, adminId: string) {
    if (!file?.buffer?.length || file.buffer.length > 5 * 1024 * 1024) {
      throw new BadRequestException('请上传不超过 5MB 的 PDF、PNG 或 JPEG 凭证');
    }
    const b = file.buffer;
    const mimeType = b.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf'
      : b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
      : b[0] === 255 && b[1] === 216 && b[2] === 255 ? 'image/jpeg' : null;
    if (!mimeType || mimeType !== file.mimetype) throw new BadRequestException('凭证文件类型与内容不符');
    const id = randomUUID();
    await this.prisma.$executeRaw`
      INSERT INTO "FundPrivateProof" (id, "adminId", "mimeType", content, "createdAt")
      VALUES (${id}, ${adminId}, ${mimeType}, ${b}, NOW())`;
    return { id };
  }

  async requireProof(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('凭证编号无效');
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "FundPrivateProof" WHERE id = ${id}`;
    if (!rows.length) throw new BadRequestException('请先上传有效的私有付款凭证');
  }

  async download(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('凭证不存在');
    const rows = await this.prisma.$queryRaw<Array<{ content: Uint8Array; mimeType: string }>>`
      SELECT content, "mimeType" FROM "FundPrivateProof" WHERE id = ${id}`;
    if (!rows.length) throw new NotFoundException('凭证不存在');
    return { buffer: Buffer.from(rows[0].content), mimeType: rows[0].mimeType };
  }
}
