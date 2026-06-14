import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DigitalAssetQueryDto } from './dto/digital-asset-query.dto';
import { DigitalAssetService } from './digital-asset.service';

@Controller('me/digital-assets')
export class DigitalAssetController {
  constructor(private readonly digitalAssetService: DigitalAssetService) {}

  @Get('summary')
  getSummary(@CurrentUser('sub') userId: string) {
    return this.digitalAssetService.getSummary(userId);
  }

  @Get('ledgers')
  listLedgers(
    @CurrentUser('sub') userId: string,
    @Query() query: DigitalAssetQueryDto,
  ) {
    return this.digitalAssetService.listLedgers(userId, query);
  }
}
