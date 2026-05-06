import {
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ShipmentController } from './shipment.controller';

const VALID_TOKEN = '84a7d77ac0ec13252cdb5fc4e244be7b';
const SF_OK_XML = '<Response><Head>OK</Head></Response>';
const SF_ERR_XML = '<Response><Head>ERR</Head></Response>';

const VALID_PUSH_BODY = {
  Body: {
    WaybillRoute: [
      {
        mailno: 'SF1234567890',
        acceptTime: '2026-01-25 06:00:00',
        remark: '正在派送中',
        acceptAddress: '云南省昆明市盘龙区',
        opCode: '50',
        id: '1',
        orderid: 'O1',
      },
    ],
  },
};

const PARSED_PAYLOAD = {
  trackingNo: 'SF1234567890',
  status: 'DELIVERED' as const,
  events: [
    {
      time: '2026-01-25 06:00:00',
      message: '正在派送中',
      location: '云南省昆明市盘龙区',
      opCode: '50',
    },
  ],
};

function createController() {
  const shipmentService = {
    handleSfCallback: jest.fn(),
    getByOrderId: jest.fn(),
    queryTracking: jest.fn(),
    handleCallback: jest.fn(),
  };
  const sfExpress = {
    parsePushPayload: jest.fn(),
    verifyPushToken: jest.fn(),
  };
  const controller = new ShipmentController(shipmentService as any, sfExpress as any);
  return { controller, shipmentService, sfExpress };
}

// Bug 36: 控制器返回 XML，需 mock express Response
function makeRes() {
  const res: any = {
    setHeader: jest.fn(),
    status: jest.fn(),
    send: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.send.mockReturnValue(res);
  return res;
}

describe('ShipmentController.handleSfCallback', () => {
  describe('Bug 87 — URL secret token 校验', () => {
    it('token 校验失败返 401 + ERR XML', async () => {
      const { controller, sfExpress, shipmentService } = createController();
      sfExpress.verifyPushToken.mockReturnValue(false);
      const res = makeRes();

      await controller.handleSfCallback('wrong_token', VALID_PUSH_BODY, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/xml; charset=utf-8');
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.send).toHaveBeenCalledWith(SF_ERR_XML);
      expect(sfExpress.parsePushPayload).not.toHaveBeenCalled();
      expect(shipmentService.handleSfCallback).not.toHaveBeenCalled();
    });

    it('token 校验通过则继续解析推送', async () => {
      const { controller, sfExpress, shipmentService } = createController();
      sfExpress.verifyPushToken.mockReturnValue(true);
      sfExpress.parsePushPayload.mockReturnValue([PARSED_PAYLOAD]);
      shipmentService.handleSfCallback.mockResolvedValue(undefined);
      const res = makeRes();

      await controller.handleSfCallback(VALID_TOKEN, VALID_PUSH_BODY, res);

      expect(sfExpress.verifyPushToken).toHaveBeenCalledWith(VALID_TOKEN);
      expect(sfExpress.parsePushPayload).toHaveBeenCalledWith(VALID_PUSH_BODY);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(SF_OK_XML);
    });
  });

  describe('Bug 36 — 返回 SF V1 文档要求的 XML', () => {
    it('解析为空（Body.WaybillRoute 不在）返 200 OK XML', async () => {
      const { controller, sfExpress, shipmentService } = createController();
      sfExpress.verifyPushToken.mockReturnValue(true);
      sfExpress.parsePushPayload.mockReturnValue([]);
      const res = makeRes();

      await controller.handleSfCallback(VALID_TOKEN, {}, res);

      expect(shipmentService.handleSfCallback).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(SF_OK_XML);
    });

    it('单条 trackingNo 不在 DB（NotFoundException）跳过 + 返 200 OK', async () => {
      const { controller, sfExpress, shipmentService } = createController();
      sfExpress.verifyPushToken.mockReturnValue(true);
      sfExpress.parsePushPayload.mockReturnValue([PARSED_PAYLOAD]);
      shipmentService.handleSfCallback.mockRejectedValue(
        new NotFoundException('物流单号 SF1234567890 不存在'),
      );
      const res = makeRes();

      await controller.handleSfCallback(VALID_TOKEN, VALID_PUSH_BODY, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(SF_OK_XML);
    });

    it('BadRequestException 跳过 + 返 200 OK', async () => {
      const { controller, sfExpress, shipmentService } = createController();
      sfExpress.verifyPushToken.mockReturnValue(true);
      sfExpress.parsePushPayload.mockReturnValue([PARSED_PAYLOAD]);
      shipmentService.handleSfCallback.mockRejectedValue(
        new BadRequestException('数据格式错'),
      );
      const res = makeRes();

      await controller.handleSfCallback(VALID_TOKEN, VALID_PUSH_BODY, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(SF_OK_XML);
    });

    it('系统异常返 500 + ERR XML（让 SF 重推）', async () => {
      const { controller, sfExpress, shipmentService } = createController();
      sfExpress.verifyPushToken.mockReturnValue(true);
      sfExpress.parsePushPayload.mockReturnValue([PARSED_PAYLOAD]);
      shipmentService.handleSfCallback.mockRejectedValue(new Error('DB 连接超时'));
      const res = makeRes();

      await controller.handleSfCallback(VALID_TOKEN, VALID_PUSH_BODY, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith(SF_ERR_XML);
    });

    it('返回的 Content-Type 是 text/xml', async () => {
      const { controller, sfExpress } = createController();
      sfExpress.verifyPushToken.mockReturnValue(true);
      sfExpress.parsePushPayload.mockReturnValue([]);
      const res = makeRes();

      await controller.handleSfCallback(VALID_TOKEN, {}, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/xml; charset=utf-8');
    });
  });

  describe('Bug 70-补丁 — 批量推送多 mailno 逐个处理', () => {
    it('单条全成功', async () => {
      const { controller, sfExpress, shipmentService } = createController();
      sfExpress.verifyPushToken.mockReturnValue(true);
      sfExpress.parsePushPayload.mockReturnValue([PARSED_PAYLOAD]);
      shipmentService.handleSfCallback.mockResolvedValue(undefined);
      const res = makeRes();

      await controller.handleSfCallback(VALID_TOKEN, VALID_PUSH_BODY, res);

      expect(shipmentService.handleSfCallback).toHaveBeenCalledTimes(1);
      expect(shipmentService.handleSfCallback).toHaveBeenCalledWith(
        PARSED_PAYLOAD.trackingNo,
        PARSED_PAYLOAD.status,
        PARSED_PAYLOAD.events,
        VALID_PUSH_BODY,
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('多条逐个调用，单条 NotFound 不影响其他', async () => {
      const { controller, sfExpress, shipmentService } = createController();
      const p1 = { ...PARSED_PAYLOAD, trackingNo: 'SF1' };
      const p2 = { ...PARSED_PAYLOAD, trackingNo: 'SF2' };
      const p3 = { ...PARSED_PAYLOAD, trackingNo: 'SF3' };

      sfExpress.verifyPushToken.mockReturnValue(true);
      sfExpress.parsePushPayload.mockReturnValue([p1, p2, p3]);
      shipmentService.handleSfCallback
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new NotFoundException('SF2 不存在'))
        .mockResolvedValueOnce(undefined);
      const res = makeRes();

      await controller.handleSfCallback(VALID_TOKEN, VALID_PUSH_BODY, res);

      expect(shipmentService.handleSfCallback).toHaveBeenCalledTimes(3);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(SF_OK_XML);
    });

    it('多条中某条系统异常立即返 500（让 SF 重推整批）', async () => {
      const { controller, sfExpress, shipmentService } = createController();
      const p1 = { ...PARSED_PAYLOAD, trackingNo: 'SF1' };
      const p2 = { ...PARSED_PAYLOAD, trackingNo: 'SF2' };

      sfExpress.verifyPushToken.mockReturnValue(true);
      sfExpress.parsePushPayload.mockReturnValue([p1, p2]);
      shipmentService.handleSfCallback
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('DB 连接断开'));
      const res = makeRes();

      await controller.handleSfCallback(VALID_TOKEN, VALID_PUSH_BODY, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith(SF_ERR_XML);
    });
  });
});
