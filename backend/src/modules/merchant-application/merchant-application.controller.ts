import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { MerchantApplicationService } from './merchant-application.service';
import { CreateMerchantApplicationDto } from './dto/create-merchant-application.dto';

@Controller('merchant-applications')
export class MerchantApplicationController {
  constructor(private service: MerchantApplicationService) {}

  @Public()
  @Throttle({ default: { ttl: 3600000, limit: 5 } })
  @Post()
  @UseInterceptors(
    FileInterceptor('licenseFile', {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async create(
    @Body() dto: CreateMerchantApplicationDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.create(dto, file);
  }
}
