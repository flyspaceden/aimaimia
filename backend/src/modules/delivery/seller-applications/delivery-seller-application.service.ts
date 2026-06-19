import { Injectable } from '@nestjs/common';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { CreateDeliverySellerApplicationDto } from './dto/create-delivery-seller-application.dto';

@Injectable()
export class DeliverySellerApplicationService {
  constructor(private readonly deliveryPrisma: DeliveryPrismaService) {}

  async create(dto: CreateDeliverySellerApplicationDto) {
    const application = await this.deliveryPrisma.deliveryMerchantApplication.create({
      data: {
        companyName: dto.companyName.trim(),
        contactName: dto.contactName.trim(),
        contactPhone: dto.contactPhone.trim(),
        email: dto.email?.trim() || null,
        note: dto.note?.trim() || null,
        licenseFileUrl: dto.licenseFileUrl?.trim() || null,
      },
    });

    return {
      message: '申请已提交，请等待审核',
      application,
    };
  }
}
