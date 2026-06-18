import { Module } from '@nestjs/common';
import { AdminAppUsersController } from './admin-app-users.controller';
import { AdminAppUsersService } from './admin-app-users.service';
import { GuestCleanupService } from '../../auth/guest-cleanup.service';
import { DigitalAssetModule } from '../../digital-asset/digital-asset.module';

@Module({
  imports: [DigitalAssetModule],
  controllers: [AdminAppUsersController],
  providers: [AdminAppUsersService, GuestCleanupService],
})
export class AdminAppUsersModule {}
