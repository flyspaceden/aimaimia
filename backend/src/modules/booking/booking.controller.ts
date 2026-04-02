import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { BookingService } from './booking.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SellerAuthGuard } from '../seller/common/guards/seller-auth.guard';
import { SellerRoleGuard } from '../seller/common/guards/seller-role.guard';
import { CurrentSeller } from '../seller/common/decorators/current-seller.decorator';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ReviewBookingDto } from './dto/review-booking.dto';
import { InviteBookingDto } from './dto/invite-booking.dto';
import { JoinGroupDto } from './dto/join-group.dto';

@Controller('bookings')
export class BookingController {
  constructor(private bookingService: BookingService) {}

  @Get()
  list(@CurrentUser('sub') userId: string) {
    return this.bookingService.list(userId);
  }

  @Get('company/:companyId')
  listByCompany(@Param('companyId') companyId: string) {
    return this.bookingService.listByCompany(companyId);
  }

  @Post()
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateBookingDto,
  ) {
    return this.bookingService.create(userId, dto);
  }

  // H3修复：审核预约是卖家操作，需 SellerAuthGuard 并校验 booking 归属
  @Public()
  @UseGuards(SellerAuthGuard, SellerRoleGuard)
  @Post(':id/review')
  review(
    @CurrentSeller('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: ReviewBookingDto,
  ) {
    return this.bookingService.review(id, dto, companyId);
  }

  // H4修复：发起成团邀请是卖家操作，需 SellerAuthGuard 并校验 booking 归属
  @Public()
  @UseGuards(SellerAuthGuard, SellerRoleGuard)
  @Post(':id/invite')
  invite(
    @CurrentSeller('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: InviteBookingDto,
  ) {
    return this.bookingService.inviteToGroup(id, dto, companyId);
  }

  @Post(':id/confirm')
  confirmJoin(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.bookingService.confirmJoin(id, userId);
  }

  @Post('join-group')
  joinGroup(
    @CurrentUser('sub') userId: string,
    @Body() dto: JoinGroupDto,
  ) {
    return this.bookingService.joinGroup(userId, dto);
  }

  @Post(':id/paid')
  markPaid(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.bookingService.markPaid(id, userId);
  }
}
