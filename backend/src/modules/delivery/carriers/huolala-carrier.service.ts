import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { DeliveryPickupBatchStatus } from '../../../generated/delivery-client';
import {
  DeliveryCarrierCancelResult,
  DeliveryCarrierDetailResult,
  DeliveryCarrierOrderResult,
  DeliveryCarrierQuoteRequest,
  DeliveryCarrierQuoteResult,
} from './delivery-carrier.types';

type HuolalaConfig = {
  appKey: string;
  appSecret: string;
  accessToken: string;
  payType: string;
  monthlyAccountId: string;
};

type JsonRecord = Record<string, unknown>;

const HUOLALA_BASE_URL = 'https://openapi.huolala.cn';

@Injectable()
export class HuolalaCarrierService {
  constructor(private readonly configService: ConfigService) {}

  isAvailable(): boolean {
    return (
      this.readBoolean(this.getConfigValue('DELIVERY_HUOLALA_ENABLED')) &&
      Boolean(this.getConfigValue('DELIVERY_HUOLALA_APP_KEY')) &&
      Boolean(this.getConfigValue('DELIVERY_HUOLALA_APP_SECRET')) &&
      Boolean(this.getConfigValue('DELIVERY_HUOLALA_ACCESS_TOKEN')) &&
      Boolean(this.getConfigValue('DELIVERY_HUOLALA_PAY_TYPE')) &&
      Boolean(this.getConfigValue('DELIVERY_HUOLALA_MONTHLY_ACCOUNT_ID'))
    );
  }

  async quote(request: DeliveryCarrierQuoteRequest): Promise<DeliveryCarrierQuoteResult> {
    const payload = await this.requestJson('/v1/order/quote', {
      outside_order_id: request.outsideOrderId,
      city_id: request.cityId,
      vehicle_id: request.vehicleId,
      sender: this.serializeParty(request.sender),
      receiver: this.serializeParty(request.receiver),
      cargo: this.serializeCargo(request.cargo),
      planned_pickup_at: request.plannedPickupAt?.toISOString(),
    });

    return {
      provider: 'HUOLALA',
      priceCalculateId: this.pickString(payload, [
        ['data', 'price_calculate_id'],
        ['data', 'priceCalculateId'],
        ['price_calculate_id'],
        ['priceCalculateId'],
      ]),
      estimatedFeeCents: this.pickNumber(payload, [
        ['data', 'fee_cent'],
        ['data', 'estimated_fee_cent'],
        ['data', 'estimatedFeeCents'],
        ['fee_cent'],
        ['estimated_fee_cent'],
      ]),
      rawPayload: payload,
    };
  }

  async requestOrder(
    request: DeliveryCarrierQuoteRequest & { priceCalculateId: string },
  ): Promise<DeliveryCarrierOrderResult> {
    const config = this.getRequiredConfig();
    const payload = await this.requestJson('/v1/order/create', {
      outside_order_id: request.outsideOrderId,
      city_id: request.cityId,
      vehicle_id: request.vehicleId,
      sender: this.serializeParty(request.sender),
      receiver: this.serializeParty(request.receiver),
      cargo: this.serializeCargo(request.cargo),
      planned_pickup_at: request.plannedPickupAt?.toISOString(),
      price_calculate_id: request.priceCalculateId,
      pay_type: config.payType,
      monthly_account_id: config.monthlyAccountId,
    });

    return {
      provider: 'HUOLALA',
      outsideOrderId: request.outsideOrderId,
      carrierOrderNo: this.pickString(payload, [
        ['data', 'order_no'],
        ['data', 'orderNo'],
        ['data', 'carrier_order_no'],
        ['order_no'],
        ['orderNo'],
      ]),
      status: this.pickOptionalString(payload, [
        ['data', 'status'],
        ['status'],
      ]) ?? 'UNKNOWN',
      rawPayload: payload,
    };
  }

  async getOrderDetail(input: {
    carrierOrderNo?: string;
    outsideOrderId?: string;
  }): Promise<DeliveryCarrierDetailResult> {
    const payload = await this.requestJson('/v1/order/detail', {
      carrier_order_no: input.carrierOrderNo,
      outside_order_id: input.outsideOrderId,
    });
    const status =
      this.pickOptionalString(payload, [['data', 'status'], ['status']]) ?? 'UNKNOWN';

    return {
      provider: 'HUOLALA',
      outsideOrderId:
        input.outsideOrderId ??
        this.pickOptionalString(payload, [['data', 'outside_order_id'], ['outside_order_id']]),
      carrierOrderNo: this.pickString(payload, [
        ['data', 'order_no'],
        ['data', 'orderNo'],
        ['data', 'carrier_order_no'],
        ['order_no'],
        ['orderNo'],
      ]),
      status,
      mappedStatus: this.mapHuolalaStatus(status),
      estimatedFeeCents: this.pickOptionalNumber(payload, [
        ['data', 'estimated_fee_cent'],
        ['data', 'estimatedFeeCents'],
      ]),
      actualFeeCents: this.pickOptionalNumber(payload, [
        ['data', 'fee_cent'],
        ['data', 'actual_fee_cent'],
        ['data', 'actualFeeCents'],
      ]),
      driverSnapshot: this.pickOptionalValue(payload, [['data', 'driver']]),
      vehicleSnapshot: this.pickOptionalValue(payload, [['data', 'vehicle']]),
      rawPayload: payload,
    };
  }

  async cancelOrder(input: {
    carrierOrderNo: string;
    reason: string;
  }): Promise<DeliveryCarrierCancelResult> {
    const payload = await this.requestJson('/v1/order/cancel', {
      carrier_order_no: input.carrierOrderNo,
      cancel_reason: input.reason,
    });

    return {
      provider: 'HUOLALA',
      carrierOrderNo:
        this.pickOptionalString(payload, [
          ['data', 'order_no'],
          ['data', 'orderNo'],
          ['order_no'],
          ['orderNo'],
        ]) ?? input.carrierOrderNo,
      status: this.pickOptionalString(payload, [
        ['data', 'status'],
        ['status'],
      ]) ?? 'UNKNOWN',
      rawPayload: payload,
    };
  }

  mapHuolalaStatus(rawStatus: string): DeliveryPickupBatchStatus {
    const normalized = rawStatus.trim().toUpperCase().replace(/[\s-]+/g, '_');

    switch (normalized) {
      case 'PLANNED':
      case 'READY':
      case 'READY_TO_CALL':
        return DeliveryPickupBatchStatus.READY_TO_CALL;
      case 'CALLING_CARRIER':
      case 'CALLING':
      case 'DISPATCHING':
      case 'PUSHING':
      case 'UNKNOWN':
        return DeliveryPickupBatchStatus.CALLING_CARRIER;
      case 'WAITING_DRIVER':
      case 'WAIT_DRIVER':
      case 'DRIVER_SEARCHING':
        return DeliveryPickupBatchStatus.WAITING_DRIVER;
      case 'DRIVER_ASSIGNED':
      case 'DRIVER_ACCEPTED':
      case 'ACCEPTED':
      case 'TAKEN':
        return DeliveryPickupBatchStatus.DRIVER_ASSIGNED;
      case 'ARRIVED':
      case 'DRIVER_ARRIVED':
      case 'ARRIVE_AT_SENDER':
        return DeliveryPickupBatchStatus.ARRIVED;
      case 'LOADED':
      case 'PICKED_UP':
      case 'LOAD_FINISHED':
        return DeliveryPickupBatchStatus.LOADED;
      case 'DELIVERING':
      case 'IN_TRANSIT':
      case 'ON_THE_WAY':
        return DeliveryPickupBatchStatus.DELIVERING;
      case 'COMPLETED':
      case 'FINISHED':
      case 'SIGNED':
        return DeliveryPickupBatchStatus.COMPLETED;
      case 'CANCELED':
      case 'CANCELLED':
      case 'USER_CANCELLED':
      case 'SYSTEM_CANCELLED':
        return DeliveryPickupBatchStatus.CANCELED;
      case 'EXCEPTION':
      case 'FAILED':
      case 'ABNORMAL':
        return DeliveryPickupBatchStatus.EXCEPTION;
      default:
        // Keep unknown provider states non-terminal until upstream confirms exact mapping.
        return DeliveryPickupBatchStatus.CALLING_CARRIER;
    }
  }

  private async requestJson(path: string, payload: JsonRecord): Promise<JsonRecord> {
    const config = this.getRequiredConfig();
    const signedPayload = this.buildSignedPayload(payload, config);
    const response = await fetch(`${HUOLALA_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(signedPayload),
    });

    if (!response.ok) {
      throw new ServiceUnavailableException('货拉拉运力服务暂不可用，请稍后重试');
    }

    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ServiceUnavailableException('货拉拉运力返回格式无效');
    }

    return data as JsonRecord;
  }

  private buildSignedPayload(payload: JsonRecord, config: HuolalaConfig): JsonRecord {
    const basePayload: JsonRecord = {
      ...payload,
      app_key: config.appKey,
      access_token: config.accessToken,
      nonce_str: this.generateNonce(),
      timestamp: String(Math.floor(Date.now() / 1000)),
    };

    return {
      ...basePayload,
      signature: this.signPayload(basePayload, config.appSecret),
    };
  }

  private signPayload(payload: JsonRecord, secret: string): string {
    const signSource = Object.keys(payload)
      .filter((key) => payload[key] !== undefined && payload[key] !== null)
      .sort()
      .map((key) => `${key}${this.stringifyForSignature(payload[key])}`)
      .join('');

    return createHash('md5').update(`${signSource}${secret}`).digest('hex');
  }

  private stringifyForSignature(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  private serializeParty(party: DeliveryCarrierQuoteRequest['sender']) {
    return {
      name: party.name,
      phone: party.phone,
      province: party.province,
      city: party.city,
      district: party.district,
      detail: party.detail,
      lat: party.lat,
      lng: party.lng,
    };
  }

  private serializeCargo(cargo: DeliveryCarrierQuoteRequest['cargo']) {
    return {
      name: cargo.name,
      quantity: cargo.quantity,
      weight_kg: cargo.weightKg,
      remark: cargo.remark,
    };
  }

  private getRequiredConfig(): HuolalaConfig {
    if (!this.readBoolean(this.getConfigValue('DELIVERY_HUOLALA_ENABLED'))) {
      throw new ServiceUnavailableException('货拉拉运力未启用');
    }

    const appKey = this.getConfigValue('DELIVERY_HUOLALA_APP_KEY');
    const appSecret = this.getConfigValue('DELIVERY_HUOLALA_APP_SECRET');
    const accessToken = this.getConfigValue('DELIVERY_HUOLALA_ACCESS_TOKEN');
    const payType = this.getConfigValue('DELIVERY_HUOLALA_PAY_TYPE');
    const monthlyAccountId = this.getConfigValue('DELIVERY_HUOLALA_MONTHLY_ACCOUNT_ID');

    if (!appKey || !appSecret || !accessToken || !payType || !monthlyAccountId) {
      throw new ServiceUnavailableException('货拉拉运力配置缺失');
    }

    return {
      appKey,
      appSecret,
      accessToken,
      payType,
      monthlyAccountId,
    };
  }

  private getConfigValue(key: string): string | undefined {
    const value = this.configService.get<string | boolean | number>(key);
    if (value === undefined || value === null) {
      return undefined;
    }
    return String(value).trim();
  }

  private readBoolean(value?: string): boolean {
    return value === 'true' || value === '1';
  }

  private generateNonce(): string {
    return Math.random().toString().slice(2).padEnd(15, '0').slice(0, 15);
  }

  private pickString(payload: JsonRecord, paths: string[][]): string {
    const value = this.pickOptionalString(payload, paths);
    if (!value) {
      throw new ServiceUnavailableException('货拉拉运力返回缺少必要字段');
    }
    return value;
  }

  private pickOptionalString(payload: JsonRecord, paths: string[][]): string | undefined {
    const value = this.pickOptionalValue(payload, paths);
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    return String(value);
  }

  private pickNumber(payload: JsonRecord, paths: string[][]): number {
    const value = this.pickOptionalNumber(payload, paths);
    if (value === undefined) {
      throw new ServiceUnavailableException('货拉拉运力返回缺少必要金额字段');
    }
    return value;
  }

  private pickOptionalNumber(payload: JsonRecord, paths: string[][]): number | undefined {
    const value = this.pickOptionalValue(payload, paths);
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return undefined;
    }
    return Math.round(numeric);
  }

  private pickOptionalValue(payload: JsonRecord, paths: string[][]): unknown {
    for (const path of paths) {
      let current: unknown = payload;
      let matched = true;
      for (const segment of path) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) {
          matched = false;
          break;
        }
        current = (current as JsonRecord)[segment];
      }
      if (matched && current !== undefined) {
        return current;
      }
    }

    return undefined;
  }
}
