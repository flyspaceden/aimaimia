import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { DeliveryCheckoutController } from './delivery-checkout.controller';
import { DeliveryCheckoutService } from './delivery-checkout.service';
import { DeliveryUserAuthGuard } from '../auth/guards/delivery-user-auth.guard';

@Injectable()
class TestDeliveryUserAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers.authorization;
    if (authHeader !== 'Bearer delivery-user') {
      return false;
    }
    req.user = { deliveryUserId: 'delivery_user_1' };
    return true;
  }
}

describe('DeliveryCheckoutController', () => {
  let service: {
    createCheckout: jest.Mock;
    getCheckout: jest.Mock;
    createPaymentParams: jest.Mock;
    activeQueryPayment: jest.Mock;
  };
  let controller: DeliveryCheckoutController;

  beforeEach(() => {
    service = {
      createCheckout: jest.fn(),
      getCheckout: jest.fn(),
      createPaymentParams: jest.fn(),
      activeQueryPayment: jest.fn(),
    };
    controller = new DeliveryCheckoutController(service as any);
  });

  it('delegates delivery checkout routes with the authenticated delivery user id', async () => {
    const dto = { cartItemIds: ['cart_1'], addressId: 'addr_1', note: '尽快送达' };

    await controller.createCheckout('user_1', dto as any);
    await controller.getCheckout('user_1', 'checkout_1');
    await controller.createPaymentParams('user_1', 'checkout_1');
    await (controller as any).activeQueryPayment('user_1', 'checkout_1');

    expect(service.createCheckout).toHaveBeenCalledWith('user_1', dto);
    expect(service.getCheckout).toHaveBeenCalledWith('user_1', 'checkout_1');
    expect(service.createPaymentParams).toHaveBeenCalledWith('user_1', 'checkout_1');
    expect(service.activeQueryPayment).toHaveBeenCalledWith('user_1', 'checkout_1');
  });

  it('rejects anonymous delivery checkout pay requests before reaching the service', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DeliveryCheckoutController],
      providers: [{ provide: DeliveryCheckoutService, useValue: service }],
    })
      .overrideGuard(DeliveryUserAuthGuard)
      .useClass(TestDeliveryUserAuthGuard)
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      await request(app.getHttpServer())
        .post('/delivery/checkout/checkout_1/pay')
        .expect(403);
    } finally {
      await app.close();
    }

    expect(service.createPaymentParams).not.toHaveBeenCalled();
  });

  it('rejects wrong-auth delivery checkout pay requests before reaching the service', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DeliveryCheckoutController],
      providers: [{ provide: DeliveryCheckoutService, useValue: service }],
    })
      .overrideGuard(DeliveryUserAuthGuard)
      .useClass(TestDeliveryUserAuthGuard)
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      await request(app.getHttpServer())
        .post('/delivery/checkout/checkout_1/pay')
        .set('authorization', 'Bearer wrong-user')
        .expect(403);
    } finally {
      await app.close();
    }

    expect(service.createPaymentParams).not.toHaveBeenCalled();
  });
});
