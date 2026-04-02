import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { AddressService } from './address.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Controller('addresses')
export class AddressController {
  constructor(private addressService: AddressService) {}

  @Get()
  list(@CurrentUser('sub') userId: string) {
    return this.addressService.list(userId);
  }

  @Post()
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateAddressDto,
  ) {
    return this.addressService.create(userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addressService.update(userId, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.addressService.remove(userId, id);
  }

  @Patch(':id/default')
  setDefault(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.addressService.setDefault(userId, id);
  }
}
