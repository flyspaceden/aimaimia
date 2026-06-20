import {
  BadRequestException,
  Controller,
  ForbiddenException,
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
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { UploadQueryDto } from '../../upload/dto/upload-query.dto';
import { UPLOAD_ALLOWED_MIME_TYPES, UPLOAD_MAX_FILE_SIZE } from '../../upload/upload.constants';
import { UploadService } from '../../upload/upload.service';
import { RequireDeliverySellerPermission } from '../auth/decorators/require-delivery-seller-permission.decorator';
import { DeliverySellerAuthGuard } from '../auth/guards/delivery-seller-auth.guard';
import { DeliverySellerPermissionGuard } from '../auth/guards/delivery-seller-permission.guard';

type DeliverySellerCurrentUser = {
  merchantId: string;
  role: string;
  permissionCodes?: string[];
};

type DeliverySellerFileScope = 'products' | 'orders' | 'finance' | 'company';

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
@UseGuards(DeliverySellerAuthGuard, DeliverySellerPermissionGuard)
@Controller('delivery-seller')
export class DeliverySellerUploadController {
  constructor(
    private readonly uploadService: UploadService,
    private readonly deliveryPrisma: DeliveryPrismaService,
  ) {}

  @Post('upload')
  @RequireDeliverySellerPermission('products:write')
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
  async getPrivateFile(
    @CurrentUser() currentUser: DeliverySellerCurrentUser,
    @Param('key') key: string,
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Query('download') download: string | undefined,
    @Query('filename') filename: string | undefined,
    @Res() res: Response,
  ) {
    const normalizedKey = this.requireDeliveryKey(key);
    const scope = await this.assertMerchantOwnsDeliveryKey(currentUser.merchantId, normalizedKey);
    this.assertSellerFilePermission(currentUser, scope);
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
    @CurrentUser() currentUser: DeliverySellerCurrentUser,
    @Query('key') key: string,
    @Query('filename') filename: string | undefined,
    @Res() res: Response,
  ) {
    if (!key) throw new BadRequestException('请提供文件 key');
    const normalizedKey = this.requireDeliveryKey(key);
    const scope = await this.assertMerchantOwnsDeliveryKey(currentUser.merchantId, normalizedKey);
    this.assertSellerFilePermission(currentUser, scope);
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

  private async assertMerchantOwnsDeliveryKey(merchantId: string, key: string): Promise<DeliverySellerFileScope> {
    const [
      skuImageCount,
      productMediaRows,
      manifest,
      shipmentCount,
      settlementCount,
      applicationCount,
    ] = await Promise.all([
      this.deliveryPrisma.deliveryProductSku.count({
        where: {
          product: { merchantId },
          imageUrl: { contains: key },
        },
      }),
      this.deliveryPrisma.deliveryProduct.findMany({
        where: { merchantId },
        select: { media: true },
      }),
      this.deliveryPrisma.deliveryManifest.findFirst({
        where: {
          merchantId,
          OR: [
            { storageKey: key },
            { fileUrl: { contains: key } },
          ],
        },
        select: { type: true },
      }),
      this.deliveryPrisma.deliveryShipment.count({
        where: {
          merchantId,
          waybillUrl: { contains: key },
        },
      }),
      this.deliveryPrisma.deliverySettlement.count({
        where: {
          merchantId,
          exportFileUrl: { contains: key },
        },
      }),
      this.deliveryPrisma.deliveryMerchantApplication.count({
        where: {
          merchantId,
          licenseFileUrl: { contains: key },
        },
      }),
    ]);
    const productMediaCount = productMediaRows.some((row) => this.jsonContainsKey(row.media, key)) ? 1 : 0;

    if (skuImageCount + productMediaCount > 0) return 'products';
    if (manifest) return manifest.type === 'SELLER_SETTLEMENT' ? 'finance' : 'orders';
    if (shipmentCount > 0) return 'orders';
    if (settlementCount > 0) return 'finance';
    if (applicationCount > 0) return 'company';

    throw new ForbiddenException('无权下载该配送文件');
  }

  private assertSellerFilePermission(currentUser: DeliverySellerCurrentUser, scope: DeliverySellerFileScope) {
    if (currentUser.role === 'OWNER') {
      return;
    }
    const required = {
      products: 'products:read',
      orders: 'orders:read',
      finance: 'finance:read',
      company: 'company:read',
    }[scope];
    if (!this.hasSellerPermission(currentUser.permissionCodes ?? [], required)) {
      throw new ForbiddenException('无配送中心文件下载权限');
    }
  }

  private hasSellerPermission(permissionCodes: string[], required: string) {
    const unprefixed = required.replace(/^delivery:/, '');
    const [moduleName, action] = unprefixed.split(':');
    const candidates = new Set([required, unprefixed, `delivery:${unprefixed}`]);
    if (action === 'read') {
      candidates.add(`${moduleName}:write`);
      candidates.add(`${moduleName}:manage`);
      candidates.add(`delivery:${moduleName}:write`);
      candidates.add(`delivery:${moduleName}:manage`);
    }

    for (const candidate of candidates) {
      if (permissionCodes.includes(candidate)) return true;
    }
    return (
      permissionCodes.includes(`${moduleName}:*`) ||
      permissionCodes.includes(`delivery:${moduleName}:*`) ||
      permissionCodes.includes('delivery:*') ||
      permissionCodes.includes('*')
    );
  }

  private jsonContainsKey(value: unknown, key: string): boolean {
    if (typeof value === 'string') {
      return value.includes(key);
    }
    if (Array.isArray(value)) {
      return value.some((item) => this.jsonContainsKey(item, key));
    }
    if (value && typeof value === 'object') {
      return Object.values(value).some((item) => this.jsonContainsKey(item, key));
    }
    return false;
  }
}
