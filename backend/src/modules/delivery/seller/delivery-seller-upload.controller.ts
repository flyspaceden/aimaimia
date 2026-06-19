import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { UploadQueryDto } from '../../upload/dto/upload-query.dto';
import { UPLOAD_ALLOWED_MIME_TYPES, UPLOAD_MAX_FILE_SIZE } from '../../upload/upload.constants';
import { UploadService } from '../../upload/upload.service';
import { DeliverySellerAuthGuard } from '../auth/guards/delivery-seller-auth.guard';

const deliveryUploadMulterOptions = {
  storage: memoryStorage(),
  limits: {
    fileSize: UPLOAD_MAX_FILE_SIZE,
  },
  fileFilter: (_req: any, file: Express.Multer.File, cb: (error: Error | null, acceptFile: boolean) => void) => {
    if (!UPLOAD_ALLOWED_MIME_TYPES.includes(file.mimetype as any)) {
      cb(new BadRequestException(`不支持的文件类型：${file.mimetype}`) as any, false);
      return;
    }
    cb(null, true);
  },
};

function buildContentDisposition(filename: string): string {
  const safeName = filename.replace(/[\r\n"\\]/g, '_') || 'download';
  const fallbackName = safeName.replace(/[^\x20-\x7E]/g, '_') || 'download';
  const encoded = encodeURIComponent(safeName);
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encoded}`;
}

@Public()
@UseGuards(DeliverySellerAuthGuard)
@Controller('delivery-seller')
export class DeliverySellerUploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', deliveryUploadMulterOptions))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Query() query: UploadQueryDto,
  ) {
    if (!file) {
      throw new BadRequestException('请选择要上传的文件');
    }

    return this.uploadService.uploadFile(file, this.resolveFolder(query.folder));
  }

  @Get('upload/private/*key')
  getPrivateFile(
    @Param('key') key: string,
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Query('download') download: string | undefined,
    @Query('filename') filename: string | undefined,
    @Res() res: Response,
  ) {
    const normalizedKey = this.requireDeliveryKey(key);
    const file = this.uploadService.getSignedLocalFile(normalizedKey, expires, sig);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    if (download === '1' || download === 'true') {
      const basename = normalizedKey.split('/').pop() || 'download';
      res.setHeader('Content-Disposition', buildContentDisposition(filename || basename));
    }
    return res.sendFile(file.filePath);
  }

  @Get('upload/download')
  async downloadFile(
    @Query('key') key: string,
    @Query('filename') filename: string | undefined,
    @Res() res: Response,
  ) {
    if (!key) throw new BadRequestException('请提供文件 key');
    const normalizedKey = this.requireDeliveryKey(key);
    const file = await this.uploadService.getFileForDownload(normalizedKey);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', buildContentDisposition(filename || file.basename));
    res.setHeader('Cache-Control', 'private, max-age=60');
    if ('filePath' in file) {
      return res.sendFile(file.filePath);
    }
    return file.stream.pipe(res);
  }

  private resolveFolder(folder?: string) {
    const normalized = folder?.trim().replace(/^delivery\//, '') || 'products';
    return `delivery/${normalized}`;
  }

  private requireDeliveryKey(key: string) {
    const normalized = key.trim().replace(/^\/+/, '');
    if (!normalized.startsWith('delivery/')) {
      throw new BadRequestException('仅支持 delivery/ 命名空间文件');
    }
    return normalized;
  }
}
