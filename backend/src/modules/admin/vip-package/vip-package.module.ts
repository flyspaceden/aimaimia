import { Module } from '@nestjs/common';
import { VipPackageController } from './vip-package.controller';
import { VipPackageService } from './vip-package.service';

@Module({
  controllers: [VipPackageController],
  providers: [VipPackageService],
  exports: [VipPackageService],
})
export class VipPackageModule {}
