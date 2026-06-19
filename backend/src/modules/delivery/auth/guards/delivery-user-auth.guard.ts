import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class DeliveryUserAuthGuard extends AuthGuard('delivery-user-jwt') {}
