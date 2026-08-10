import { Button, Image, ScrollView, Text, View } from "@tarojs/components";
import Taro, { useDidShow, useRouter } from "@tarojs/taro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CatalogFeedback } from "@/components/catalog-feedback";
import { isUserCancelledPayment } from "@/components/commerce-utils";
import { requestMiniProgramPayment } from "@/platform/payment";
import { ensureWechatMiniProgramSession } from "@/platform/auth";
import { captureAuthSession, useAuthStore } from "@/store/auth";
import { AfterSaleAuthGate } from "../_components/auth-gate";
import { MiniAfterSaleRepo } from "../repo";
import type { AfterSaleRequest, SfTracking } from "../types";
import {
  AFTER_SALE_STATUS_LABELS,
  AFTER_SALE_TYPE_LABELS,
  QUALITY_REASONS,
  canArbitrate,
  canCancel,
  canConfirmReplacement,
  canCreateWaybill,
  formatMoney,
  formatTime,
  isRefundPolling,
  productSnapshot,
  resolvedReturnPayer,
  returnPaymentStatus,
  sortedTracking,
} from "../utils";
import "../_components/after-sale-shared.scss";
import "./index.scss";

type Action = "cancel" | "waybill" | "confirm" | "escalate" | "close";
const reasonLabels = Object.fromEntries(QUALITY_REASONS);

function InfoRow({
  label,
  value,
  copy,
}: {
  label: string;
  value: string;
  copy?: boolean;
}) {
  return (
    <View className='after-sale-info-row'>
      <Text>{label}</Text>
      <Text
        onClick={() => {
          if (copy) void Taro.setClipboardData({ data: value });
        }}
      >
        {value}
        {copy ? "  复制" : ""}
      </Text>
    </View>
  );
}

function TrackingBlock({
  title,
  tracking,
  waybill,
}: {
  title: string;
  tracking?: SfTracking | null;
  waybill?: string | null;
}) {
  const events = sortedTracking(tracking);
  if (!waybill && !events.length) return null;
  return (
    <View className='after-sale-track'>
      <Text className='after-sale-track__title'>{title}</Text>
      {waybill ? <InfoRow label='运单号' value={waybill} copy /> : null}
      {events.length ? (
        <View className='after-sale-track__timeline'>
          {events.map((event, index) => (
            <View
              className={
                index === 0
                  ? "after-sale-track-event after-sale-track-event--latest"
                  : "after-sale-track-event"
              }
              key={`${event.time}-${index}`}
            >
              <View className='after-sale-track-event__rail'>
                <View />
                <View />
              </View>
              <View className='after-sale-track-event__copy'>
                <Text>{event.message}</Text>
                {event.location ? <Text className='after-sale-track-event__meta'>{event.location}</Text> : null}
                <Text className='after-sale-track-event__meta'>{formatTime(event.time)}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <Text className='after-sale-track__empty'>运输轨迹暂未更新</Text>
      )}
    </View>
  );
}

function nextActionText(request: AfterSaleRequest): string {
  if (canCancel(request.status)) return "等待卖家审核，审核前可撤销申请";
  if (request.status === "APPROVED" && canCreateWaybill(request))
    return "申请已通过，请生成顺丰退货面单";
  if (
    request.status === "APPROVED" &&
    returnPaymentStatus(request) === "UNPAID"
  )
    return "需先完成退货运费支付";
  if (canArbitrate(request.status)) return "可升级平台仲裁，或接受关闭";
  if (canConfirmReplacement(request.status)) return "换货已发出，收到后请确认";
  return AFTER_SALE_STATUS_LABELS[request.status];
}

export default function AfterSaleDetailPage() {
  const router = useRouter();
  const id = typeof router.params.id === "string" ? router.params.id : "";
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ["after-sale", id],
    queryFn: () => MiniAfterSaleRepo.getById(id),
    enabled: loggedIn && Boolean(id),
    refetchInterval: (query) =>
      query.state.data?.ok &&
      (isRefundPolling(query.state.data.data) ||
        returnPaymentStatus(query.state.data.data) === "PENDING")
        ? 10_000
        : false,
  });
  const timelineQuery = useQuery({
    queryKey: ["after-sale", id, "timeline"],
    queryFn: () => MiniAfterSaleRepo.getTimeline(id),
    enabled: loggedIn && Boolean(id),
  });
  useDidShow(() => {
    if (id && useAuthStore.getState().accessToken) {
      void detailQuery.refetch();
      void timelineQuery.refetch();
    }
  });
  const request = detailQuery.data?.ok ? detailQuery.data.data : undefined;
  const refreshAll = async () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["after-sale", id] }),
      queryClient.invalidateQueries({ queryKey: ["after-sales"] }),
      queryClient.invalidateQueries({ queryKey: ["orders"] }),
    ]);
  const actionMutation = useMutation({
    mutationFn: async (action: Action) => {
      if (action === "cancel") return MiniAfterSaleRepo.cancel(id);
      if (action === "confirm") return MiniAfterSaleRepo.confirmReceive(id);
      if (action === "escalate") return MiniAfterSaleRepo.escalate(id);
      if (action === "close") return MiniAfterSaleRepo.acceptClose(id);
      return MiniAfterSaleRepo.createReturnWaybill(id);
    },
    onSuccess: async (result, action) => {
      if (!result.ok) {
        Taro.showToast({
          title: result.error.displayMessage || "操作失败",
          icon: "none",
        });
        return;
      }
      await refreshAll();
      await timelineQuery.refetch();
      const labels: Record<Action, string> = {
        cancel: "售后申请已撤销",
        waybill: "顺丰退货面单已生成",
        confirm: "已确认收到换货商品",
        escalate: "已提交平台仲裁",
        close: "售后已关闭",
      };
      Taro.showToast({ title: labels[action], icon: "success" });
    },
    onError: () => Taro.showToast({ title: "网络开小差了", icon: "none" }),
  });
  const paymentMutation = useMutation({
    mutationFn: async () => {
      const authGuard = captureAuthSession();
      const payment = await MiniAfterSaleRepo.createReturnShippingPayment(id);
      if (!payment.ok) return payment;
      if (payment.data.status === "PAID") {
        const status = await MiniAfterSaleRepo.activeQueryReturnShippingPayment(
          payment.data.merchantPaymentNo,
        );
        return {
          ok: true as const,
          data: { payment: payment.data, status, cancelled: false },
        };
      }
      if (!payment.data.paymentParams) {
        throw new Error("MINI_PROGRAM_PAYMENT_PARAMS_MISSING");
      }
      let cancelled = false;
      let safelyClosed = false;
      try {
        await requestMiniProgramPayment(payment.data.paymentParams);
      } catch (error) {
        cancelled = isUserCancelledPayment(error);
        if (!cancelled) throw error;
        const closed = await MiniAfterSaleRepo.cancelReturnShippingPayment(id);
        safelyClosed = closed.ok && closed.data.status === "CLOSED";
      }
      if (!useAuthStore.getState().isCurrentSessionGeneration(authGuard)) {
        return { ok: false as const, error: { code: "AUTH_SESSION_CHANGED", message: "auth session changed during payment", displayMessage: "登录状态已变更，请切回原账户核对支付结果", retryable: true } };
      }
      const status = await MiniAfterSaleRepo.activeQueryReturnShippingPayment(
        payment.data.merchantPaymentNo,
      );
      return {
        ok: true as const,
        data: { payment: payment.data, status, cancelled, safelyClosed },
      };
    },
    onSuccess: async (result) => {
      if (!result.ok) {
        Taro.showToast({
          title: result.error.displayMessage || "退货运费支付发起失败",
          icon: "none",
        });
        return;
      }
      await refreshAll();
      if (result.data.status.ok && result.data.status.data.status === "PAID") {
        Taro.showToast({
          title: "运费支付完成，现在可生成退货面单",
          icon: "success",
        });
      } else if (result.data.cancelled && result.data.safelyClosed) {
        Taro.showToast({ title: "支付已安全关闭", icon: "none" });
      } else if (result.data.cancelled) {
        Taro.showToast({ title: "正在确认关单，请稍后刷新", icon: "none" });
      } else {
        Taro.showToast({ title: "支付结果确认中，请稍后刷新", icon: "none" });
      }
    },
    onError: () =>
      Taro.showToast({ title: "支付未完成，请稍后重试", icon: "none" }),
  });
  const confirmAction = async (
    action: Action,
    title: string,
    content: string,
  ) => {
    const modal = await Taro.showModal({
      title,
      content,
      confirmColor:
        action === "cancel" || action === "close" ? "#A04B42" : "#2E7D32",
    });
    if (modal.confirm && !actionMutation.isPending)
      actionMutation.mutate(action);
  };
  const returnUrl = `/packages/after-sales/after-sale-detail/index?id=${encodeURIComponent(id)}`;

  return (
    <AfterSaleAuthGate returnUrl={returnUrl}>
      <View className='after-sale-detail-page'>
        {!id ? (
          <CatalogFeedback
            kind='error'
            title='未找到售后服务单'
            description='请从售后列表重新进入'
          />
        ) : detailQuery.isLoading ? (
          <CatalogFeedback kind='loading' />
        ) : !request ? (
          <CatalogFeedback
            kind='error'
            title='售后详情加载失败'
            description={
              detailQuery.data && !detailQuery.data.ok
                ? detailQuery.data.error.displayMessage
                : "请稍后重试"
            }
            onRetry={() => detailQuery.refetch()}
          />
        ) : (
          <AfterSaleDetailBody
            request={request}
            timeline={
              timelineQuery.data?.ok ? timelineQuery.data.data.items : []
            }
            busy={actionMutation.isPending || paymentMutation.isPending}
            onPay={() => { void ensureWechatMiniProgramSession(`/packages/after-sales/after-sale-detail/index?id=${encodeURIComponent(id)}`).then((ready) => { if (ready) paymentMutation.mutate(); }); }}
            onAction={(action) => {
              if (action === "cancel")
                void confirmAction(
                  action,
                  "撤销售后",
                  "确定撤销这个售后申请吗？",
                );
              else if (action === "confirm")
                void confirmAction(
                  action,
                  "确认收货",
                  "请确认已收到换货商品且无异常。",
                );
              else if (action === "escalate")
                void confirmAction(
                  action,
                  "升级仲裁",
                  "平台将根据双方材料进行仲裁。",
                );
              else if (action === "close")
                void confirmAction(
                  action,
                  "接受关闭",
                  "关闭后该售后不可恢复。",
                );
              else actionMutation.mutate("waybill");
            }}
          />
        )}
      </View>
    </AfterSaleAuthGate>
  );
}

function AfterSaleDetailBody({
  request,
  timeline,
  busy,
  onAction,
  onPay,
}: {
  request: AfterSaleRequest;
  timeline: Array<{
    id: string;
    toStatus: keyof typeof AFTER_SALE_STATUS_LABELS;
    reason?: string | null;
    createdAt: string;
  }>;
  busy: boolean;
  onAction: (action: Action) => void;
  onPay: () => void;
}) {
  const snapshot = productSnapshot(request);
  const payer = resolvedReturnPayer(request);
  const paymentBlocked =
    request.status === "APPROVED" &&
    request.requiresReturn &&
    payer === "BUYER" &&
    ["UNPAID", "PENDING", "FAILED"].includes(returnPaymentStatus(request));
  return (
    <>
      <ScrollView className='after-sale-detail-scroll' scrollY enhanced>
        <View className='after-sale-detail-hero'>
          <Text className='after-sale-detail-hero__eyebrow'>售后服务单</Text>
          <Text className='after-sale-detail-hero__status'>
            {AFTER_SALE_STATUS_LABELS[request.status]}
          </Text>
          <Text className='after-sale-detail-hero__hint'>
            {nextActionText(request)}
          </Text>
          <Text className='after-sale-detail-hero__id'>{request.id}</Text>
        </View>
        <View className='after-sale-detail-content'>
          <View className='after-sale-detail-card aim-card'>
            <Text className='after-sale-detail-card__title'>申请商品</Text>
            <View className='after-sale-detail-product'>
              <Image
                src={snapshot?.image || snapshot?.images?.[0] || ""}
                mode='aspectFill'
              />
              <View>
                <Text>{snapshot?.title || "商品"}</Text>
                <Text>
                  {snapshot?.skuTitle || "默认规格"} · ¥
                  {formatMoney(request.orderItem?.unitPrice)} ×{" "}
                  {request.orderItem?.quantity || 1}
                </Text>
              </View>
            </View>
          </View>
          <View className='after-sale-detail-card aim-card'>
            <Text className='after-sale-detail-card__title'>申请内容</Text>
            <InfoRow
              label='售后方式'
              value={AFTER_SALE_TYPE_LABELS[request.afterSaleType]}
            />
            {request.reasonType ? (
              <InfoRow
                label='问题类型'
                value={reasonLabels[request.reasonType] || request.reasonType}
              />
            ) : null}
            {request.reason ? (
              <InfoRow label='补充说明' value={request.reason} />
            ) : null}
            <InfoRow label='申请时间' value={formatTime(request.createdAt)} />
            {request.refundAmount != null &&
            !request.afterSaleType.endsWith("EXCHANGE") ? (
              <InfoRow
                label='退款金额'
                value={`¥${formatMoney(request.refundAmount)}`}
              />
            ) : null}
            <View className='after-sale-detail-photos'>
              {request.photos.map((url) => (
                <Image
                  src={url}
                  key={url}
                  mode='aspectFill'
                  onClick={() =>
                    Taro.previewImage({ current: url, urls: request.photos })
                  }
                />
              ))}
            </View>
          </View>
          {request.requiresReturn ? (
            <View className='after-sale-detail-card aim-card'>
              <Text className='after-sale-detail-card__title'>退货物流</Text>
              <InfoRow
                label='运费承担'
                value={
                  request.returnShippingPayer === "BUYER"
                    ? "买家承担"
                    : request.returnShippingPayer === "SELLER"
                      ? "商家承担"
                      : "平台承担"
                }
              />
              {request.returnShippingFee != null ? (
                <InfoRow
                  label='退货运费'
                  value={`¥${formatMoney(request.returnShippingFee)}`}
                />
              ) : null}
              {request.returnCarrierName ? (
                <InfoRow label='承运商' value={request.returnCarrierName} />
              ) : null}
              {request.returnWaybillNo ? (
                <InfoRow
                  label='退货单号'
                  value={request.returnWaybillNo}
                  copy
                />
              ) : null}
              {paymentBlocked ? (
                <View className='after-sale-payment-boundary'>
                  <Text>需要先支付退货运费</Text>
                  <Text>
                    审核通过后，请先完成退货运费支付，再获取寄回指引。
                  </Text>
                </View>
              ) : null}
              <TrackingBlock
                title='买家寄回'
                tracking={request.returnTracking}
                waybill={request.returnWaybillNo}
              />
              {request.returnWaybillUrl || request.returnLabelUrl ? (
                <Text
                  className='after-sale-link'
                  onClick={() =>
                    Taro.previewImage({
                      urls: [
                        request.returnLabelUrl ||
                          request.returnWaybillUrl ||
                          "",
                      ],
                    })
                  }
                >
                  查看退货面单
                </Text>
              ) : null}
            </View>
          ) : null}
          {request.replacementWaybillNo || request.replacementTracking ? (
            <View className='after-sale-detail-card aim-card'>
              <Text className='after-sale-detail-card__title'>换货物流</Text>
              {request.replacementCarrierName ? (
                <InfoRow
                  label='承运商'
                  value={request.replacementCarrierName}
                />
              ) : null}
              <TrackingBlock
                title='换货商品'
                tracking={request.replacementTracking}
                waybill={request.replacementWaybillNo}
              />
            </View>
          ) : null}
          {request.sellerRejectReason || request.sellerReturnWaybillNo ? (
            <View className='after-sale-detail-card aim-card'>
              <Text className='after-sale-detail-card__title'>
                卖家验收结果
              </Text>
              {request.sellerRejectReason ? (
                <InfoRow
                  label='不通过原因'
                  value={request.sellerRejectReason}
                />
              ) : null}
              <TrackingBlock
                title='卖家退回'
                tracking={request.sellerReturnTracking}
                waybill={request.sellerReturnWaybillNo}
              />
            </View>
          ) : null}
          <View className='after-sale-detail-card aim-card'>
            <Text className='after-sale-detail-card__title'>处理进度</Text>
            {timeline.length ? (
              <View className='after-sale-history'>
                {[...timeline].reverse().map((item, index, items) => (
                  <View
                    className={[
                      "after-sale-history__item",
                      index === 0 ? "after-sale-history__item--latest" : "",
                      index === items.length - 1 ? "after-sale-history__item--last" : "",
                    ].filter(Boolean).join(" ")}
                    key={item.id}
                  >
                    <View />
                    <View>
                      <Text>{AFTER_SALE_STATUS_LABELS[item.toStatus]}</Text>
                      {item.reason ? <Text className='after-sale-history__meta'>{item.reason}</Text> : null}
                      <Text className='after-sale-history__meta'>{formatTime(item.createdAt)}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text className='after-sale-detail-empty'>处理记录暂未返回</Text>
            )}
          </View>
          <View className='after-sale-detail-card aim-card'>
            <Text className='after-sale-detail-card__title'>当前可用操作</Text>
            <Text className='after-sale-detail-empty'>
              {nextActionText(request)}
            </Text>
            {paymentBlocked ? (
              <Button
                className='after-sale-action-button'
                disabled={busy}
                loading={busy}
                onClick={onPay}
              >
                微信支付退货运费
              </Button>
            ) : null}
            {canCreateWaybill(request) ? (
              <Button
                className='after-sale-action-button'
                disabled={busy}
                loading={busy}
                onClick={() => onAction("waybill")}
              >
                生成顺丰退货面单
              </Button>
            ) : null}
            {canCancel(request.status) ? (
              <Button
                className='after-sale-action-button after-sale-action-button--danger'
                disabled={busy}
                onClick={() => onAction("cancel")}
              >
                撤销申请
              </Button>
            ) : null}
            {canArbitrate(request.status) ? (
              <View className='after-sale-action-row'>
                <Button disabled={busy} onClick={() => onAction("escalate")}>
                  升级仲裁
                </Button>
                <Button disabled={busy} onClick={() => onAction("close")}>
                  接受关闭
                </Button>
              </View>
            ) : null}
            {canConfirmReplacement(request.status) ? (
              <Button
                className='after-sale-action-button'
                disabled={busy}
                onClick={() => onAction("confirm")}
              >
                确认收到换货商品
              </Button>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </>
  );
}
