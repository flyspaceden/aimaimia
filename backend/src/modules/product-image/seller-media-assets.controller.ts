import { BadRequestException, Controller, Get, Param, Post, ServiceUnavailableException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentSeller } from '../seller/common/decorators/current-seller.decorator';
import { SellerAudit } from '../seller/common/decorators/seller-audit.decorator';
import { SellerAuthGuard } from '../seller/common/guards/seller-auth.guard';
import { SellerRoleGuard, SellerRoles } from '../seller/common/guards/seller-role.guard';
import { SellerAuditInterceptor } from '../seller/common/interceptors/seller-audit.interceptor';
import { UPLOAD_MAX_FILE_SIZE } from '../upload/upload.constants';
import { SellerMediaAssetsService } from './seller-media-assets.service';

@Public()
@UseGuards(SellerAuthGuard, SellerRoleGuard)
@UseInterceptors(SellerAuditInterceptor)
@Controller('seller/media-assets')
export class SellerMediaAssetsController {
  constructor(private readonly assets: SellerMediaAssetsService) {}

  @Post('product-images')
  @SellerRoles('OWNER', 'MANAGER')
  @SellerAudit({ action: 'CREATE_PRODUCT_MEDIA_ASSET', module: 'product-images', targetType: 'SellerMediaAsset' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: UPLOAD_MAX_FILE_SIZE } }))
  async create(
    @CurrentSeller('companyId') companyId: string,
    // Seller JWT exposes CompanyStaff.id as `sub`; unlike buyer contexts it
    // does not carry a `staffId` field.
    @CurrentSeller('sub') staffId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('请选择商品图片');
    return this.assets.createProductImageAsset(companyId, staffId, file);
  }

  @Get(':id')
  async get(@CurrentSeller('companyId') companyId: string, @Param('id') id: string) {
    return this.assets.getProductImageAsset(companyId, id);
  }

  @Post(':id/compose-white')
  @SellerRoles('OWNER', 'MANAGER')
  @SellerAudit({ action: 'COMPOSE_PRODUCT_WHITE_BACKGROUND', module: 'product-images', targetType: 'SellerMediaAsset', targetIdParam: 'params.id' })
  composeWhite() {
    // A renderer candidate cannot enter ordinary product media until the
    // explicit candidate/adoption state machine is present.
    throw new ServiceUnavailableException('保真白底候选将在采用审核链路完成后开放');
  }
}
