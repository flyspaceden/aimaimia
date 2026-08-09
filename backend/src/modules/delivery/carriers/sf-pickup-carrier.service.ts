import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DeliveryPickupBatchStatus } from '../../../generated/delivery-client';
import { fetchBinaryWithLimit } from '../../../common/utils/remote-binary-fetch.util';
import { SfExpressService } from '../../shipment/sf-express.service';
import { UploadService } from '../../upload/upload.service';
import {
  DeliverySfCancelResult,
  DeliverySfCreateShipmentRequest,
  DeliverySfCreateShipmentResult,
  DeliverySfSyncResult,
} from './delivery-carrier.types';

@Injectable()
export class SfPickupCarrierService {
  private readonly logger = new Logger(SfPickupCarrierService.name);

  constructor(
    private readonly sfExpress: SfExpressService,
    private readonly uploadService: UploadService,
  ) {}

  isAvailable() {
    return this.sfExpress.isConfigured();
  }

  async createShipment(
    request: DeliverySfCreateShipmentRequest,
  ): Promise<DeliverySfCreateShipmentResult> {
    this.assertRequest(request);
    const result = await this.sfExpress.createOrder({
      orderId: request.outsideOrderId,
      sender: this.toSfParty(request.sender),
      receiver: this.toSfParty(request.receiver),
      cargo: request.cargo.name,
      totalWeight: request.totalWeightKg,
      packageCount: request.packageCount,
      expressTypeId: request.expressTypeId,
      payMethod: 1,
      isDocall: 1,
    });

    const waybillNos = result.waybillNos?.length
      ? result.waybillNos
      : [result.waybillNo].filter(Boolean);
    if (waybillNos.length === 0) {
      throw new BadRequestException('顺丰下单成功但未返回运单号');
    }

    return {
      provider: 'SF',
      outsideOrderId: request.outsideOrderId,
      sfOrderId: result.sfOrderId,
      primaryWaybillNo: waybillNos[0],
      waybillNos,
      waybillUrl: await this.persistWaybillPdf(waybillNos),
      status: DeliveryPickupBatchStatus.WAITING_DRIVER,
      rawPayload: {
        sfOrderId: result.sfOrderId,
        waybillNos,
        originCode: result.originCode,
        destCode: result.destCode,
        filterResult: result.filterResult,
        expressTypeId: request.expressTypeId,
        expressTypeName: request.expressTypeName,
        packageCount: request.packageCount,
        totalWeightKg: request.totalWeightKg,
      },
    };
  }

  async syncWaybills(waybillNos: string[]): Promise<DeliverySfSyncResult> {
    const normalized = Array.from(
      new Set(waybillNos.map((item) => item.trim()).filter(Boolean)),
    );
    if (normalized.length === 0) {
      throw new BadRequestException('顺丰运单号缺失，无法同步物流');
    }

    const waybills = [];
    for (const trackingNo of normalized) {
      const detail = await this.sfExpress.queryRoutes(trackingNo);
      const rawStatus = detail?.status ?? 'WAITING_PICKUP';
      waybills.push({
        trackingNo,
        status: rawStatus,
        mappedStatus: detail
          ? this.mapSfStatus(detail.status)
          : DeliveryPickupBatchStatus.WAITING_DRIVER,
        events: detail?.events ?? [],
      });
    }

    return {
      provider: 'SF',
      status: this.resolveAggregateStatus(waybills.map((item) => item.mappedStatus)),
      waybills,
      rawPayload: { waybills },
    };
  }

  async cancelShipment(input: {
    outsideOrderId: string;
    primaryWaybillNo: string;
  }): Promise<DeliverySfCancelResult> {
    const result = await this.sfExpress.cancelOrder(
      input.outsideOrderId,
      input.primaryWaybillNo,
    );
    if (!result.success) {
      throw new BadRequestException('顺丰运单取消失败，请稍后重试或联系顺丰处理');
    }
    return {
      provider: 'SF',
      success: true,
      status: 'CANCELED',
      rawPayload: result,
    };
  }

  async reprintWaybill(waybillNos: string[]): Promise<string> {
    const normalized = Array.from(new Set(waybillNos.map((item) => item.trim()).filter(Boolean)));
    if (normalized.length === 0) {
      throw new BadRequestException('顺丰运单号缺失，无法打印面单');
    }
    const url = await this.persistWaybillPdf(normalized, true);
    if (!url) {
      throw new BadRequestException('顺丰面单生成失败，请稍后重试');
    }
    return url;
  }

  mapSfStatus(status: string): DeliveryPickupBatchStatus {
    switch (status) {
      case 'SHIPPED':
        return DeliveryPickupBatchStatus.LOADED;
      case 'IN_TRANSIT':
        return DeliveryPickupBatchStatus.DELIVERING;
      case 'DELIVERED':
        return DeliveryPickupBatchStatus.COMPLETED;
      case 'EXCEPTION':
        return DeliveryPickupBatchStatus.EXCEPTION;
      default:
        return DeliveryPickupBatchStatus.WAITING_DRIVER;
    }
  }

  private resolveAggregateStatus(
    statuses: DeliveryPickupBatchStatus[],
  ): DeliveryPickupBatchStatus {
    if (statuses.every((status) => status === DeliveryPickupBatchStatus.COMPLETED)) {
      return DeliveryPickupBatchStatus.COMPLETED;
    }
    if (statuses.some((status) => status === DeliveryPickupBatchStatus.EXCEPTION)) {
      return DeliveryPickupBatchStatus.EXCEPTION;
    }
    if (statuses.some((status) => status === DeliveryPickupBatchStatus.DELIVERING)) {
      return DeliveryPickupBatchStatus.DELIVERING;
    }
    if (statuses.some((status) => status === DeliveryPickupBatchStatus.LOADED)) {
      return DeliveryPickupBatchStatus.LOADED;
    }
    return DeliveryPickupBatchStatus.WAITING_DRIVER;
  }

  private async persistWaybillPdf(waybillNo: string | string[], strict = false) {
    try {
      const printResult = await this.sfExpress.printWaybill(waybillNo);
      const fetched = await fetchBinaryWithLimit(printResult.pdfUrl, {
        maxBytes: 20 * 1024 * 1024,
        timeoutMs: 15000,
        allowedContentTypes: ['application/pdf', 'application/octet-stream'],
      });
      const uploaded = await this.uploadService.uploadBuffer(
        fetched.buffer,
        'delivery/pickup-waybills',
        '.pdf',
        'application/pdf',
      );
      return uploaded.url;
    } catch (error: unknown) {
      if (strict) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`配送批次顺丰面单暂未持久化: ${message}`);
      return null;
    }
  }

  private assertRequest(request: DeliverySfCreateShipmentRequest) {
    if (!this.isAvailable()) {
      throw new BadRequestException('顺丰丰桥服务未配置');
    }
    if (!Number.isSafeInteger(request.expressTypeId) || request.expressTypeId <= 0) {
      throw new BadRequestException('顺丰产品代码无效');
    }
    if (!Number.isSafeInteger(request.packageCount) || request.packageCount < 1 || request.packageCount > 999) {
      throw new BadRequestException('包裹数量必须是 1 到 999 的整数');
    }
    if (!Number.isFinite(request.totalWeightKg) || request.totalWeightKg <= 0) {
      throw new BadRequestException('实际重量必须大于 0kg');
    }
  }

  private toSfParty(party: DeliverySfCreateShipmentRequest['sender']) {
    return {
      name: party.name,
      tel: party.phone,
      province: party.province,
      city: party.city,
      district: party.district,
      detail: party.detail,
    };
  }
}
