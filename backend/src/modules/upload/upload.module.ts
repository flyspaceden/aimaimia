import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { ImageContentScannerService } from './image-content-scanner.service';
import { AnyAuthGuard } from '../../common/guards/any-auth.guard';

@Module({
  imports: [
    MulterModule.register({
      storage: memoryStorage(), // 内存存储，由 service 层决定最终存储位置
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
        files: 9,
      },
    }),
  ],
  controllers: [UploadController],
  providers: [UploadService, ImageContentScannerService, AnyAuthGuard],
  exports: [UploadService, ImageContentScannerService],
})
export class UploadModule {}
