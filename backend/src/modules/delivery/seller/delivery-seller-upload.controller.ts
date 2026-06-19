import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
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

  private resolveFolder(folder?: string) {
    const normalized = folder?.trim().replace(/^delivery\//, '') || 'products';
    return `delivery/${normalized}`;
  }
}
