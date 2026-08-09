import { ApiClient } from "@/api/client";
import { invalidContract, normalizePageResult } from "@/repos/contracts";
import type { PageResult, Result } from "@/types";
import { isMiniProgramPaymentParams } from "@/types";
import type {
  AfterSaleRequest,
  AfterSaleShippingActiveQueryResult,
  AfterSaleShippingPayment,
  ApplyAfterSaleInput,
  EligibilityResponse,
  ReturnPolicy,
  ReturnWaybillResult,
  TimelineResponse,
} from "./types";

export const MiniAfterSaleRepo = {
  list: async (
    page = 1,
    pageSize = 20,
  ): Promise<Result<PageResult<AfterSaleRequest>>> =>
    normalizePageResult<AfterSaleRequest>(
      await ApiClient.get<unknown>("/after-sale", { page, pageSize }),
      "after-sale page",
    ),
  getById: (id: string) => ApiClient.get<AfterSaleRequest>(`/after-sale/${id}`),
  getEligibility: (orderId: string) =>
    ApiClient.get<EligibilityResponse>(
      `/after-sale/orders/${orderId}/eligibility`,
    ),
  apply: (orderId: string, input: ApplyAfterSaleInput) =>
    ApiClient.post<AfterSaleRequest>(`/after-sale/orders/${orderId}`, input),
  getTimeline: (id: string) =>
    ApiClient.get<TimelineResponse>(`/after-sale/${id}/timeline`),
  getReturnPolicy: () =>
    ApiClient.get<ReturnPolicy>("/after-sale/return-policy"),
  agreePolicy: () =>
    ApiClient.post<{ success: boolean }>("/after-sale/agree-policy"),
  cancel: (id: string) =>
    ApiClient.post<AfterSaleRequest>(`/after-sale/${id}/cancel`),
  fillReturnShipping: (
    id: string,
    input: { returnCarrierName: string; returnWaybillNo: string },
  ) =>
    ApiClient.post<AfterSaleRequest>(
      `/after-sale/${id}/return-shipping`,
      input,
    ),
  createReturnWaybill: (id: string) =>
    ApiClient.post<ReturnWaybillResult>(`/after-sale/${id}/return-waybill`, {}),
  createReturnShippingPayment: async (
    id: string,
  ): Promise<Result<AfterSaleShippingPayment>> => {
    const result = await ApiClient.post<unknown>(
      `/after-sale/${id}/return-shipping-payment/mini-program`,
      {},
    );
    if (!result.ok) return result;
    const value = result.data;
    if (!value || typeof value !== "object")
      return invalidContract("after-sale mini-program payment");
    const raw = value as Record<string, unknown>;
    const statuses = [
      "UNPAID",
      "PENDING",
      "PAID",
      "FAILED",
      "REFUNDING",
      "REFUNDED",
      "CLOSED",
    ];
    if (
      typeof raw.id !== "string" ||
      typeof raw.afterSaleId !== "string" ||
      typeof raw.merchantPaymentNo !== "string" ||
      typeof raw.amount !== "number" ||
      !Number.isFinite(raw.amount) ||
      !statuses.includes(String(raw.status)) ||
      raw.paymentScene !== "MINI_PROGRAM"
    ) {
      return invalidContract("after-sale mini-program payment");
    }
    const payable = ["UNPAID", "PENDING", "FAILED"].includes(String(raw.status));
    if (payable && !isMiniProgramPaymentParams(raw.paymentParams)) {
      return invalidContract("after-sale mini-program payment params");
    }
    return {
      ok: true,
      data: {
        id: raw.id,
        afterSaleId: raw.afterSaleId,
        merchantPaymentNo: raw.merchantPaymentNo,
        amount: raw.amount,
        status: raw.status as AfterSaleShippingPayment["status"],
        paymentScene: "MINI_PROGRAM",
        ...(isMiniProgramPaymentParams(raw.paymentParams)
          ? { paymentParams: raw.paymentParams }
          : {}),
      },
    };
  },
  cancelReturnShippingPayment: (id: string) =>
    ApiClient.post<{ ok: boolean; status: "CLOSED" }>(
      `/after-sale/${id}/return-shipping-payment/cancel`,
      {},
    ),
  activeQueryReturnShippingPayment: async (
    merchantPaymentNo: string,
  ): Promise<Result<AfterSaleShippingActiveQueryResult>> => {
    const result = await ApiClient.post<unknown>(
      `/orders/checkout/${encodeURIComponent(merchantPaymentNo)}/active-query`,
    );
    if (!result.ok) return result;
    const raw = result.data;
    const statuses = [
      "UNPAID",
      "PENDING",
      "PAID",
      "FAILED",
      "REFUNDING",
      "REFUNDED",
      "CLOSED",
    ];
    if (!raw || typeof raw !== "object")
      return invalidContract("after-sale shipping active query");
    const value = raw as Record<string, unknown>;
    if (
      !statuses.includes(String(value.status)) ||
      !Array.isArray(value.orderIds) ||
      value.orderIds.length !== 0 ||
      typeof value.expectedTotal !== "number" ||
      !Number.isFinite(value.expectedTotal) ||
      (value.confirmedBy !== undefined && typeof value.confirmedBy !== "string")
    ) {
      return invalidContract("after-sale shipping active query");
    }
    return { ok: true, data: value as AfterSaleShippingActiveQueryResult };
  },
  confirmReceive: (id: string) =>
    ApiClient.post<AfterSaleRequest>(`/after-sale/${id}/confirm`),
  escalate: (id: string) =>
    ApiClient.post<AfterSaleRequest>(`/after-sale/${id}/escalate`),
  acceptClose: (id: string) =>
    ApiClient.post<AfterSaleRequest>(`/after-sale/${id}/accept-close`),
  uploadEvidence: (filePath: string) =>
    ApiClient.uploadFile<{ url: string; key: string }>("/upload", {
      filePath,
      name: "file",
      params: { folder: "after-sale" },
    }),
};
