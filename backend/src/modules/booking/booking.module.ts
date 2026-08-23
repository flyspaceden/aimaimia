import { Module } from '@nestjs/common';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { GroupModule } from '../group/group.module';

@Module({
  imports: [GroupModule],
  controllers: [BookingController],
  providers: [BookingService],
})
export class BookingModule {}
