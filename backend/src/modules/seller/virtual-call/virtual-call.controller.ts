import {
  Controller,
  Post,
  Param,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { VirtualCallService } from './virtual-call.service';
import { Public } from '../../../common/decorators/public.decorator';
import { SellerAuthGuard } from '../common/guards/seller-auth.guard';
import { SellerRoleGuard, SellerRoles } from '../common/guards/seller-role.guard';
import { CurrentSeller } from '../common/decorators/current-seller.decorator';
import { SellerAudit } from '../common/decorators/seller-audit.decorator';
import { SellerAuditInterceptor } from '../common/interceptors/seller-audit.interceptor';

/**
 * 虚拟号通话控制器
 *
 * 卖家通过虚拟号联系买家，保护双方隐私。
 * 仅 OWNER 和 MANAGER 角色可发起。
 */
@Public()
@UseGuards(SellerAuthGuard, SellerRoleGuard)
@UseInterceptors(SellerAuditInterceptor)
@Controller('seller')
export class VirtualCallController {
  constructor(private readonly virtualCallService: VirtualCallService) {}

  /** 为订单绑定虚拟号 */
  @SellerAudit({
    action: 'BIND_VIRTUAL_CALL_ORDER',
    module: 'virtual-call',
    targetType: 'Order',
    targetIdParam: 'params.id',
  })
  @SellerRoles('OWNER', 'MANAGER')
  @Post('orders/:id/virtual-call')
  bindForOrder(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Param('id') orderId: string,
  ) {
    return this.virtualCallService.bindForOrder(companyId, staffId, orderId);
  }

  /** 为售后申请绑定虚拟号 */
  @SellerAudit({
    action: 'BIND_VIRTUAL_CALL_AFTER_SALE',
    module: 'virtual-call',
    targetType: 'AfterSaleRequest',
    targetIdParam: 'params.id',
  })
  @SellerRoles('OWNER', 'MANAGER')
  @Post('replacements/:id/virtual-call')
  bindForReplacement(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Param('id') replacementId: string,
  ) {
    return this.virtualCallService.bindForReplacement(
      companyId,
      staffId,
      replacementId,
    );
  }
}
