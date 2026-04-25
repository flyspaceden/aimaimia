import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UseInterceptors,
  UseGuards,
  UploadedFile,
  UploadedFiles,
  Query,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { UploadService } from './upload.service';
import { UploadQueryDto } from './dto/upload-query.dto';
import { UPLOAD_ALLOWED_MIME_TYPES, UPLOAD_MAX_FILE_SIZE } from './upload.constants';
import { Public } from '../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../admin/common/guards/admin-auth.guard';
import { AnyAuthGuard } from '../../common/guards/any-auth.guard';

const uploadMulterOptions = {
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

@Controller('upload')
export class UploadController {
  constructor(private uploadService: UploadService) {}

  /**
   * 上传单个文件
   * POST /api/v1/upload
   * Content-Type: multipart/form-data
   * Body: file (文件), folder (可选，存储子目录)
  */
  @Public()
  @UseGuards(AnyAuthGuard)
  @Post()
  @UseInterceptors(FileInterceptor('file', uploadMulterOptions))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Query() query: UploadQueryDto,
  ) {
    if (!file) {
      throw new BadRequestException('请选择要上传的文件');
    }
    return this.uploadService.uploadFile(file, query.folder || 'general');
  }

  /**
   * 批量上传文件（最多 9 张）
   * POST /api/v1/upload/batch
   * Content-Type: multipart/form-data
   * Body: files (多个文件), folder (可选)
  */
  @Public()
  @UseGuards(AnyAuthGuard)
  @Post('batch')
  @UseInterceptors(FilesInterceptor('files', 9, { ...uploadMulterOptions, limits: { ...uploadMulterOptions.limits, files: 9 } }))
  async uploadFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @Query() query: UploadQueryDto,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('请选择要上传的文件');
    }
    return this.uploadService.uploadFiles(files, query.folder || 'general');
  }

  /**
   * 获取文件访问 URL（本地私有模式下返回签名 URL）
   * GET /api/v1/upload/access-url?key=...&expiresSec=...
   */
  @Public()
  @UseGuards(AnyAuthGuard)
  @Get('access-url')
  async getAccessUrl(
    @Query('key') key: string,
    @Query('expiresSec') expiresSec?: string,
  ) {
    if (!key) throw new BadRequestException('请提供文件 key');
    const ttl = expiresSec ? Number.parseInt(expiresSec, 10) : undefined;
    return this.uploadService.createAccessUrl(key, ttl);
  }

  /**
   * 本地私有文件访问（签名 URL）
   * GET /api/v1/upload/private/:key?expires=...&sig=...
   */
  @Public()
  @Get('private/*key')
  async getPrivateFile(
    @Param('key') key: string,
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    const file = this.uploadService.getSignedLocalFile(key, expires, sig);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.sendFile(file.filePath);
  }

  /**
   * 强制下载文件（前端无法直接 fetch + blob 时的兜底通道）
   * GET /api/v1/upload/download?key=products/abc.jpg&filename=mypic.jpg
   *
   * 走 /api/v1 路径已有 enableCors 覆盖，且显式设
   * Content-Disposition: attachment 触发浏览器原生保存。
   */
  @Public()
  @UseGuards(AnyAuthGuard)
  @Get('download')
  async downloadFile(
    @Query('key') key: string,
    @Query('filename') filename: string | undefined,
    @Res() res: Response,
  ) {
    if (!key) throw new BadRequestException('请提供文件 key');
    const file = this.uploadService.getLocalFileForDownload(key);
    // RFC 5987 兼容写法：filename* 用 UTF-8 编码支持中文文件名
    const safeName = (filename || file.basename).replace(/[\r\n"\\]/g, '_');
    const encoded = encodeURIComponent(safeName);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName}"; filename*=UTF-8''${encoded}`,
    );
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.sendFile(file.filePath);
  }

  /**
   * 删除文件（H5修复：无 Upload 模型无法追踪文件归属，限制仅管理员可删除）
   * DELETE /api/v1/upload/:key
   */
  @Public()
  @UseGuards(AdminAuthGuard)
  @Delete('*key')
  async deleteFile(@Param('key') key: string) {
    await this.uploadService.deleteFile(key);
    return { ok: true };
  }
}
