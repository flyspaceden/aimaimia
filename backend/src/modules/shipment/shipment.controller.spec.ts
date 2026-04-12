import {
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ShipmentController } from './shipment.controller';

// 有效的顺丰推送负载种子数据
const VALID_PUSH_BODY = {
  msgType: 'ROUTE',
  msgData: JSON.stringify({
    mailNo: 'SF1234567890',
    routeResps: [
      {
        mailNo: 'SF1234567890',
        routes: [
          {
            acceptTime: '2026-01-25 06:00:00',
            remark: '正在派送中',
            acceptAddress: '云南省昆明市盘龙区',
            opCode: '50',
          },
          {
            acceptTime: '2026-01-24 12:00:00',
            remark: '已到达昆明转运中心',
            acceptAddress: '云南省昆明市',
            opCode: '30',
          },
        ],
      },
    ],
  }),
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
    handleSfCallback: jest.fn(),
    getByOrderId: jest.fn(),
    queryTracking: jest.fn(),
    handleCallback: jest.fn(),
  };
  const sfExpress = {
    parsePushPayload: jest.fn(),
  };
  const controller = new ShipmentController(shipmentService as any, sfExpress as any);
  return { controller, shipmentService, sfExpress };
}

describe('ShipmentController', () => {
  describe('handleSfCallback — 顺丰回调异常区分', () => {
    it('正常回调：解析成功 → 调用 handleSfCallback → 返回成功响应', async () => {
      const { controller, shipmentService, sfExpress } = createController();

      sfExpress.parsePushPayload.mockReturnValue(PARSED_PAYLOAD);
      shipmentService.handleSfCallback.mockResolvedValue(undefined);

      const mockReq = { rawBody: Buffer.from(JSON.stringify(VALID_PUSH_BODY)), headers: {} };
      const result = await controller.handleSfCallback(VALID_PUSH_BODY, mockReq);

      expect(sfExpress.parsePushPayload).toHaveBeenCalledWith(VALID_PUSH_BODY);
      expect(shipmentService.handleSfCallback).toHaveBeenCalledWith(
        PARSED_PAYLOAD.trackingNo,
        PARSED_PAYLOAD.status,
        PARSED_PAYLOAD.events,
        VALID_PUSH_BODY,
        expect.any(String),
        undefined,
      );
      expect(result).toEqual({ apiResultCode: 'A1000', apiErrorMsg: '' });
    });

    it('解析失败（parsePushPayload 返回 null）→ 返回成功停止重试', async () => {
      const { controller, shipmentService, sfExpress } = createController();

      sfExpress.parsePushPayload.mockReturnValue(null);

      const mockReq = { rawBody: Buffer.from(JSON.stringify(VALID_PUSH_BODY)), headers: {} };
      const result = await controller.handleSfCallback(VALID_PUSH_BODY, mockReq);

      expect(shipmentService.handleSfCallback).not.toHaveBeenCalled();
      expect(result).toEqual({ apiResultCode: 'A1000', apiErrorMsg: '' });
    });

    it('认证失败（UnauthorizedException）→ 抛出异常，HTTP 401', async () => {
      const { controller, shipmentService, sfExpress } = createController();

      sfExpress.parsePushPayload.mockReturnValue(PARSED_PAYLOAD);
      shipmentService.handleSfCallback.mockRejectedValue(
        new UnauthorizedException('签名验证失败'),
      );

      const mockReq = { rawBody: Buffer.from(JSON.stringify(VALID_PUSH_BODY)), headers: {} };
      await expect(
        controller.handleSfCallback(VALID_PUSH_BODY, mockReq),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('权限拒绝（ForbiddenException）→ 抛出异常，HTTP 403', async () => {
      const { controller, shipmentService, sfExpress } = createController();

      sfExpress.parsePushPayload.mockReturnValue(PARSED_PAYLOAD);
      shipmentService.handleSfCallback.mockRejectedValue(
        new ForbiddenException('回调验证失败'),
      );

      const mockReq = { rawBody: Buffer.from(JSON.stringify(VALID_PUSH_BODY)), headers: {} };
      await expect(
        controller.handleSfCallback(VALID_PUSH_BODY, mockReq),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('业务错误（NotFoundException：单号不存在）→ 返回成功停止无意义重试', async () => {
      const { controller, shipmentService, sfExpress } = createController();

      sfExpress.parsePushPayload.mockReturnValue(PARSED_PAYLOAD);
      shipmentService.handleSfCallback.mockRejectedValue(
        new NotFoundException('物流单号 SF1234567890 不存在'),
      );

      const mockReq = { rawBody: Buffer.from(JSON.stringify(VALID_PUSH_BODY)), headers: {} };
      const result = await controller.handleSfCallback(VALID_PUSH_BODY, mockReq);

      expect(result).toEqual({ apiResultCode: 'A1000', apiErrorMsg: '' });
    });

    it('业务错误（BadRequestException）→ 返回成功停止无意义重试', async () => {
      const { controller, shipmentService, sfExpress } = createController();

      sfExpress.parsePushPayload.mockReturnValue(PARSED_PAYLOAD);
      shipmentService.handleSfCallback.mockRejectedValue(
        new BadRequestException('回调数据格式不正确'),
      );

      const mockReq = { rawBody: Buffer.from(JSON.stringify(VALID_PUSH_BODY)), headers: {} };
      const result = await controller.handleSfCallback(VALID_PUSH_BODY, mockReq);

      expect(result).toEqual({ apiResultCode: 'A1000', apiErrorMsg: '' });
    });

    it('瞬态错误（Error：数据库超时）→ 返回重试响应', async () => {
      const { controller, shipmentService, sfExpress } = createController();

      sfExpress.parsePushPayload.mockReturnValue(PARSED_PAYLOAD);
      shipmentService.handleSfCallback.mockRejectedValue(
        new Error('数据库连接超时'),
      );

      const mockReq = { rawBody: Buffer.from(JSON.stringify(VALID_PUSH_BODY)), headers: {} };
      const result = await controller.handleSfCallback(VALID_PUSH_BODY, mockReq);

      expect(result).toEqual({
        apiResultCode: 'A1001',
        apiErrorMsg: expect.any(String),
      });
    });

    it('瞬态错误（序列化冲突 P2034）→ 返回重试响应', async () => {
      const { controller, shipmentService, sfExpress } = createController();

      sfExpress.parsePushPayload.mockReturnValue(PARSED_PAYLOAD);
      const serializationError = new Error(
        'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
      );
      (serializationError as any).code = 'P2034';
      shipmentService.handleSfCallback.mockRejectedValue(serializationError);

      const mockReq = { rawBody: Buffer.from(JSON.stringify(VALID_PUSH_BODY)), headers: {} };
      const result = await controller.handleSfCallback(VALID_PUSH_BODY, mockReq);

      expect(result).toEqual({
        apiResultCode: 'A1001',
        apiErrorMsg: expect.any(String),
      });
    });
  });
});
