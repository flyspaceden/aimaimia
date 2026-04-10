import {
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ShipmentController } from './shipment.controller';

// 有效的快递100回调负载种子数据
const VALID_CALLBACK_PAYLOAD = {
  status: '200',
  billstatus: 'got',
  message: '',
  lastResult: {
    message: 'ok',
    nu: 'SF1234567890',
    ischeck: '0',
    com: 'shunfeng',
    status: '200',
    state: '0',
    data: [
      {
        time: '2026-01-25T06:00:00',
        context: '正在派送中',
        ftime: '2026-01-25 06:00:00',
        areaName: '云南省昆明市盘龙区',
      },
      {
        time: '2026-01-24T12:00:00',
        context: '已到达昆明转运中心',
        ftime: '2026-01-24 12:00:00',
        areaName: '云南省昆明市',
      },
    ],
  },
};

// 解析后的标准化物流数据
const PARSED_PAYLOAD = {
  trackingNo: 'SF1234567890',
  status: 'IN_TRANSIT' as const,
  events: [
    {
      time: '2026-01-25T06:00:00',
      message: '正在派送中',
      location: '云南省昆明市盘龙区',
    },
    {
      time: '2026-01-24T12:00:00',
      message: '已到达昆明转运中心',
      location: '云南省昆明市',
    },
  ],
};

// 工厂函数：创建带 mock 依赖的控制器实例
function createController() {
  const shipmentService = {
    handleKuaidi100Callback: jest.fn(),
    getByOrderId: jest.fn(),
    queryTrackingFromKuaidi100: jest.fn(),
    handleCallback: jest.fn(),
  };
  const kuaidi100Service = {
    parseCallbackPayload: jest.fn(),
  };
  const controller = new ShipmentController(shipmentService as any, kuaidi100Service as any);
  return { controller, shipmentService, kuaidi100Service };
}

describe('ShipmentController', () => {
  describe('handleKuaidi100Callback — 回调异常区分', () => {
    it('正常回调：解析成功 → 调用 handleKuaidi100Callback → 返回成功响应', async () => {
      const { controller, shipmentService, kuaidi100Service } = createController();

      kuaidi100Service.parseCallbackPayload.mockReturnValue(PARSED_PAYLOAD);
      shipmentService.handleKuaidi100Callback.mockResolvedValue(undefined);

      const result = await controller.handleKuaidi100Callback(VALID_CALLBACK_PAYLOAD, 'test-token');

      expect(kuaidi100Service.parseCallbackPayload).toHaveBeenCalledWith(VALID_CALLBACK_PAYLOAD);
      expect(shipmentService.handleKuaidi100Callback).toHaveBeenCalledWith(
        PARSED_PAYLOAD.trackingNo,
        PARSED_PAYLOAD.status,
        PARSED_PAYLOAD.events,
        VALID_CALLBACK_PAYLOAD,
        'test-token',
      );
      expect(result).toEqual({ result: true, returnCode: '200', message: '成功' });
    });

    it('解析失败（parseCallbackPayload 返回 null）→ 返回 200 停止重试', async () => {
      const { controller, shipmentService, kuaidi100Service } = createController();

      kuaidi100Service.parseCallbackPayload.mockReturnValue(null);

      const result = await controller.handleKuaidi100Callback(VALID_CALLBACK_PAYLOAD);

      expect(shipmentService.handleKuaidi100Callback).not.toHaveBeenCalled();
      expect(result).toEqual({ result: true, returnCode: '200', message: '成功' });
    });

    it('认证失败（UnauthorizedException）→ 抛出异常，HTTP 401', async () => {
      const { controller, shipmentService, kuaidi100Service } = createController();

      kuaidi100Service.parseCallbackPayload.mockReturnValue(PARSED_PAYLOAD);
      shipmentService.handleKuaidi100Callback.mockRejectedValue(
        new UnauthorizedException('缺少回调令牌'),
      );

      await expect(
        controller.handleKuaidi100Callback(VALID_CALLBACK_PAYLOAD, undefined),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('权限拒绝（ForbiddenException）→ 抛出异常，HTTP 403', async () => {
      const { controller, shipmentService, kuaidi100Service } = createController();

      kuaidi100Service.parseCallbackPayload.mockReturnValue(PARSED_PAYLOAD);
      shipmentService.handleKuaidi100Callback.mockRejectedValue(
        new ForbiddenException('回调令牌无效'),
      );

      await expect(
        controller.handleKuaidi100Callback(VALID_CALLBACK_PAYLOAD, 'wrong-token'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('业务错误（NotFoundException：单号不存在）→ 返回 200 停止无意义重试', async () => {
      const { controller, shipmentService, kuaidi100Service } = createController();

      kuaidi100Service.parseCallbackPayload.mockReturnValue(PARSED_PAYLOAD);
      shipmentService.handleKuaidi100Callback.mockRejectedValue(
        new NotFoundException('物流单号 SF1234567890 不存在'),
      );

      const result = await controller.handleKuaidi100Callback(VALID_CALLBACK_PAYLOAD, 'valid-token');

      expect(result).toEqual({ result: true, returnCode: '200', message: '成功' });
    });

    it('业务错误（BadRequestException）→ 返回 200 停止无意义重试', async () => {
      const { controller, shipmentService, kuaidi100Service } = createController();

      kuaidi100Service.parseCallbackPayload.mockReturnValue(PARSED_PAYLOAD);
      shipmentService.handleKuaidi100Callback.mockRejectedValue(
        new BadRequestException('回调数据格式不正确'),
      );

      const result = await controller.handleKuaidi100Callback(VALID_CALLBACK_PAYLOAD, 'valid-token');

      expect(result).toEqual({ result: true, returnCode: '200', message: '成功' });
    });

    it('瞬态错误（Error：数据库超时）→ 返回 500 让快递100重推', async () => {
      const { controller, shipmentService, kuaidi100Service } = createController();

      kuaidi100Service.parseCallbackPayload.mockReturnValue(PARSED_PAYLOAD);
      shipmentService.handleKuaidi100Callback.mockRejectedValue(
        new Error('数据库连接超时'),
      );

      const result = await controller.handleKuaidi100Callback(VALID_CALLBACK_PAYLOAD, 'valid-token');

      expect(result).toEqual({
        result: false,
        returnCode: '500',
        message: '服务暂时不可用，请稍后重试',
      });
    });

    it('瞬态错误（序列化冲突 P2034）→ 返回 500 让快递100重推', async () => {
      const { controller, shipmentService, kuaidi100Service } = createController();

      kuaidi100Service.parseCallbackPayload.mockReturnValue(PARSED_PAYLOAD);
      const serializationError = new Error(
        'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
      );
      (serializationError as any).code = 'P2034';
      shipmentService.handleKuaidi100Callback.mockRejectedValue(serializationError);

      const result = await controller.handleKuaidi100Callback(VALID_CALLBACK_PAYLOAD, 'valid-token');

      expect(result).toEqual({
        result: false,
        returnCode: '500',
        message: '服务暂时不可用，请稍后重试',
      });
    });
  });
});
