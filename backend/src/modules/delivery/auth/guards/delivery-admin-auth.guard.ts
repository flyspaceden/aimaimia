import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class DeliveryAdminAuthGuard extends AuthGuard('delivery-admin-jwt') {}
