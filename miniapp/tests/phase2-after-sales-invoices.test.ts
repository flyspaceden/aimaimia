import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MiniAfterSaleRepo } from "@/packages/after-sales/repo";
import type { AfterSaleRequest } from "@/packages/after-sales/types";
import {
  canArbitrate,
  canCancel,
  canConfirmReplacement,
  canCreateWaybill,
  returnPaymentStatus,
  sortedTracking,
} from "@/packages/after-sales/utils";
import { MiniInvoiceRepo } from "@/packages/invoices/repo";
import { isHttpUrl, normalizeInvoiceReturnUrl, validateInvoiceProfile } from "@/packages/invoices/utils";

const getMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
const putMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());
const uploadMock = vi.hoisted(() => vi.fn());
vi.mock("@/api/client", () => ({
  ApiClient: {
    get: getMock,
    post: postMock,
    put: putMock,
    delete: deleteMock,
    uploadFile: uploadMock,
  },
}));

const afterSale: AfterSaleRequest = {
  id: "as-1",
  orderId: "o-1",
  orderItemId: "oi-1",
  afterSaleType: "QUALITY_RETURN",
  photos: ["https://example.test/a.jpg"],
  status: "REQUESTED",
  requiresReturn: true,
  isPostReplacement: false,
  createdAt: "2026-08-02T10:00:00.000Z",
  updatedAt: "2026-08-02T10:00:00.000Z",
};

describe("Phase 2 after-sale and invoice contracts", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    putMock.mockReset();
    deleteMock.mockReset();
    uploadMock.mockReset();
  });

  it("uses server-authoritative paginated after-sale and invoice endpoints", async () => {
    getMock.mockResolvedValueOnce({
      ok: true,
      data: { items: [afterSale], total: 21, page: 2, pageSize: 20 },
    });
    await expect(MiniAfterSaleRepo.list(2, 20)).resolves.toMatchObject({
      ok: true,
      data: { nextPage: undefined },
    });
    expect(getMock).toHaveBeenLastCalledWith("/after-sale", {
      page: 2,
      pageSize: 20,
    });

    getMock.mockResolvedValueOnce({
      ok: true,
      data: { items: [], total: 41, page: 2, pageSize: 20 },
    });
    await expect(MiniInvoiceRepo.list(2, 20)).resolves.toMatchObject({
      ok: true,
      data: { nextPage: 3 },
    });
    expect(getMock).toHaveBeenLastCalledWith("/invoices", {
      page: 2,
      pageSize: 20,
    });
  });

  it("wires after-sale eligibility, evidence upload and state actions to live routes", async () => {
    getMock.mockResolvedValue({ ok: true, data: {} });
    postMock.mockResolvedValue({ ok: true, data: afterSale });
    uploadMock.mockResolvedValue({
      ok: true,
      data: { url: "https://example.test/a.jpg", key: "a" },
    });
    await MiniAfterSaleRepo.getEligibility("o-1");
    expect(getMock).toHaveBeenCalledWith("/after-sale/orders/o-1/eligibility");
    await MiniAfterSaleRepo.apply("o-1", {
      orderItemId: "oi-1",
      afterSaleType: "QUALITY_RETURN",
      reasonType: "DAMAGED",
      photos: ["https://example.test/a.jpg"],
    });
    expect(postMock).toHaveBeenCalledWith(
      "/after-sale/orders/o-1",
      expect.objectContaining({ reasonType: "DAMAGED" }),
    );
    await MiniAfterSaleRepo.uploadEvidence("/tmp/a.jpg");
    expect(uploadMock).toHaveBeenCalledWith("/upload", {
      filePath: "/tmp/a.jpg",
      name: "file",
      params: { folder: "after-sale" },
    });
    await MiniAfterSaleRepo.createReturnWaybill("as-1");
    expect(postMock).toHaveBeenLastCalledWith(
      "/after-sale/as-1/return-waybill",
      {},
    );
    await MiniAfterSaleRepo.createReturnShippingPayment("as-1");
    expect(postMock).toHaveBeenLastCalledWith(
      "/after-sale/as-1/return-shipping-payment/mini-program",
      {},
    );
  });

  it("uses a dedicated, validated contract for return-shipping active queries", async () => {
    postMock.mockResolvedValueOnce({
      ok: true,
      data: { status: "REFUNDING", orderIds: [], expectedTotal: 12, confirmedBy: "active-query-success" },
    });
    await expect(MiniAfterSaleRepo.activeQueryReturnShippingPayment("AS_SHIP_PAY_1")).resolves.toMatchObject({
      ok: true,
      data: { status: "REFUNDING", expectedTotal: 12 },
    });
    expect(postMock).toHaveBeenLastCalledWith(
      "/orders/checkout/AS_SHIP_PAY_1/active-query",
    );

    postMock.mockResolvedValueOnce({
      ok: true,
      data: { status: "COMPLETED", orderIds: ["order-1"], expectedTotal: 12 },
    });
    await expect(MiniAfterSaleRepo.activeQueryReturnShippingPayment("AS_SHIP_PAY_1")).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_CONTRACT" },
    });
  });

  it("gates after-sale state actions and return waybill generation", () => {
    expect(canCancel("REQUESTED")).toBe(true);
    expect(canCancel("APPROVED")).toBe(false);
    expect(canArbitrate("REJECTED")).toBe(true);
    expect(canArbitrate("SELLER_REJECTED_RETURN")).toBe(true);
    expect(canConfirmReplacement("REPLACEMENT_SHIPPED")).toBe(true);
    const buyerPayment = {
      ...afterSale,
      status: "APPROVED" as const,
      returnShippingPayer: "BUYER" as const,
      requiresBuyerShippingPayment: true,
      returnShippingPaymentStatus: "UNPAID" as const,
    };
    expect(returnPaymentStatus(buyerPayment)).toBe("UNPAID");
    expect(canCreateWaybill(buyerPayment)).toBe(false);
    expect(
      canCreateWaybill({
        ...buyerPayment,
        returnShippingPaidAt: "2026-08-02T10:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      canCreateWaybill({ ...buyerPayment, returnShippingPayer: "SELLER" }),
    ).toBe(true);
    expect(
      returnPaymentStatus({
        ...afterSale,
        status: "APPROVED",
        afterSaleType: "NO_REASON_RETURN",
        returnShippingPayer: undefined,
      }),
    ).toBe("UNPAID");
  });

  it("sorts logistics events newest-first without mutating the response", () => {
    const events = [
      { time: "2026-08-01T10:00:00.000Z", message: "已揽收" },
      { time: "2026-08-02T10:00:00.000Z", message: "运输中" },
    ];
    const sorted = sortedTracking({
      status: "IN_TRANSIT",
      rawOpCode: "",
      events,
    });
    expect(sorted[0].message).toBe("运输中");
    expect(events[0].message).toBe("已揽收");
  });

  it("wires invoice profile, request, detail and cancellation routes exactly", async () => {
    getMock.mockResolvedValue({ ok: true, data: [] });
    postMock.mockResolvedValue({ ok: true, data: {} });
    putMock.mockResolvedValue({ ok: true, data: {} });
    deleteMock.mockResolvedValue({ ok: true, data: { ok: true } });
    await MiniInvoiceRepo.getProfiles();
    expect(getMock).toHaveBeenLastCalledWith("/invoices/profiles");
    await MiniInvoiceRepo.createProfile({ type: "PERSONAL", title: "张三" });
    expect(postMock).toHaveBeenLastCalledWith("/invoices/profiles", {
      type: "PERSONAL",
      title: "张三",
    });
    await MiniInvoiceRepo.updateProfile("p-1", { title: "李四" });
    expect(putMock).toHaveBeenLastCalledWith("/invoices/profiles/p-1", {
      title: "李四",
    });
    await MiniInvoiceRepo.deleteProfile("p-1");
    expect(deleteMock).toHaveBeenLastCalledWith("/invoices/profiles/p-1");
    await MiniInvoiceRepo.requestInvoice({ orderId: "o-1", profileId: "p-2" });
    expect(postMock).toHaveBeenLastCalledWith("/invoices", {
      orderId: "o-1",
      profileId: "p-2",
    });
    await MiniInvoiceRepo.cancel("i-1");
    expect(postMock).toHaveBeenLastCalledWith("/invoices/i-1/cancel");
  });

  it("validates invoice DTO fields to the backend rules", () => {
    expect(
      validateInvoiceProfile({
        type: "PERSONAL",
        title: "张三",
        email: "buyer@example.com",
        phone: "13800138000",
      }),
    ).toBeUndefined();
    expect(
      validateInvoiceProfile({
        type: "COMPANY",
        title: "爱买买农业有限公司",
        taxNo: "bad",
      }),
    ).toContain("税号");
    expect(
      validateInvoiceProfile({
        type: "COMPANY",
        title: "爱买买农业有限公司",
        taxNo: "91330100MA2EXAMPLE",
        bankInfo: { bankName: "农行", accountNo: "" },
      }),
    ).toContain("同时填写");
    expect(isHttpUrl("https://example.test/invoice.pdf")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
  });

  it("only returns to the invoice request page after editing a profile", () => {
    expect(normalizeInvoiceReturnUrl(encodeURIComponent("/packages/invoices/invoice-request/index?orderId=order-1")))
      .toBe("/packages/invoices/invoice-request/index?orderId=order-1");
    expect(normalizeInvoiceReturnUrl("/pages/me/index")).toBe("");
    expect(normalizeInvoiceReturnUrl("/packages/account/account-login/index")).toBe("");
    expect(normalizeInvoiceReturnUrl("/packages/invoices/invoice-request/index?orderId=../admin")).toBe("");
  });

  it("does not expose a forbidden payment or delivery path in Phase 2 pages", () => {
    const sourceRoot = path.resolve(process.cwd(), "src/packages");
    const files = ["after-sales", "invoices"]
      .flatMap((domain) =>
        fs
          .readdirSync(path.join(sourceRoot, domain), {
            recursive: true,
            encoding: "utf8",
          })
          .filter((entry) => entry.endsWith(".tsx"))
          .map((entry) =>
            fs.readFileSync(path.join(sourceRoot, domain, entry), "utf8"),
          ),
      )
      .join("\n");
    expect(files).not.toMatch(/支付宝|alipay|\/delivery|DeliveryRepo/i);
    const afterSaleSource = fs.readFileSync(
      path.join(sourceRoot, "after-sales/after-sale-detail/index.tsx"),
      "utf8",
    );
    expect(afterSaleSource).toContain("requestMiniProgramPayment");
    expect(afterSaleSource).not.toMatch(/支付宝|alipay|App 完成退货运费/i);
  });
});
