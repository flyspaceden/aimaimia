import { BadRequestException } from '@nestjs/common';
import { DeliveryAdminCustomerServiceController } from './delivery-admin-customer-service.controller';

describe('DeliveryAdminCustomerServiceController', () => {
  let customerService: { listAdminConversations: jest.Mock };
  let configService: { list: jest.Mock; update: jest.Mock };
  let controller: DeliveryAdminCustomerServiceController;

  beforeEach(() => {
    customerService = {
      listAdminConversations: jest.fn(),
    };
    configService = {
      list: jest.fn(),
      update: jest.fn(),
    };
    controller = new DeliveryAdminCustomerServiceController(
      customerService as any,
      configService as any,
    );
  });

  it('reads only customer-service scoped configuration', () => {
    configService.list.mockReturnValue([{ key: 'CUSTOMER_SERVICE_DEFAULTS' }]);

    expect(controller.getCustomerServiceConfig()).toEqual([
      { key: 'CUSTOMER_SERVICE_DEFAULTS' },
    ]);
    expect(configService.list).toHaveBeenCalledWith('CUSTOMER_SERVICE');
  });

  it('forces customer-service scope when updating defaults', () => {
    const result = [{ key: 'CUSTOMER_SERVICE_DEFAULTS' }];
    configService.update.mockReturnValue(result);

    expect(controller.updateCustomerServiceConfig('admin_1', {
      items: [{
        key: 'CUSTOMER_SERVICE_DEFAULTS',
        value: { faq: [] },
        scope: 'SYSTEM',
      }],
    })).toBe(result);
    expect(configService.update).toHaveBeenCalledWith([
      {
        key: 'CUSTOMER_SERVICE_DEFAULTS',
        value: { faq: [] },
        scope: 'CUSTOMER_SERVICE',
      },
    ], 'admin_1');
  });

  it('rejects unrelated configuration keys', () => {
    expect(() => controller.updateCustomerServiceConfig('admin_1', {
      items: [{ key: 'LOW_STOCK_DISPLAY_THRESHOLD', value: { value: 10 } }],
    })).toThrow(BadRequestException);
    expect(configService.update).not.toHaveBeenCalled();
  });
});
