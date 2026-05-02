import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { OrderRepo } from '../repos';
import { useToast } from '../components/feedback';

/**
 * 支付确认共享 hook：调起支付宝 SDK 后调用。
 *
 * 流程：active-query → 失败 polling getCheckoutSessionStatus → 兜底
 *
 * 注意：sdkResultStatus '9000' 仅代表 SDK 调起成功，不代表订单建单完成。
 * 必须经过 active-query / polling 确认 status='COMPLETED' 才能算真正成功。
 *
 * 与原 app/checkout.tsx 的 confirmPaymentAndNavigate 逻辑保持一致：
 * - polling 90 次 × 2s = 约 180s（沙箱 notify 长尾兜底）
 * - 每 5 轮再做一次 active-query 主动重查
 * - active-query 业务错误（INVALID/FORBIDDEN/NOT_FOUND）→ 终态停止
 * - active-query 网络错误 / 服务器异常 → 继续 polling 兜底
 */
export function useConfirmPayment() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { show } = useToast();

  return async (args: { sessionId: string; sdkResultStatus: string; onSuccess?: () => void }) => {
    const { sessionId, sdkResultStatus, onSuccess } = args;

    // 用户取消：6001 — 不做任何 active-query
    if (sdkResultStatus === '6001') {
      return { outcome: '6001-canceled' as const };
    }

    show({ message: '支付确认中...', type: 'info' });

    const invalidatePaymentQueries = async () => {
      await queryClient.invalidateQueries({ queryKey: ['pending-checkout'] });
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['me-order-counts'] });
    };

    /**
     * 处理 active-query 返回结果。
     * 返回值含义：
     *  - 'completed' → 已成功，停止
     *  - 'terminal-failure' → 业务终态/明确失败，停止并已提示
     *  - 'continue-poll' → 中间态或网络错误，继续 polling
     */
    const handleActiveQuery = async (): Promise<'completed' | 'terminal-failure' | 'continue-poll'> => {
      const r = await OrderRepo.activeQueryPayment(sessionId);
      if (r.ok) {
        const { status } = r.data;
        if (status === 'COMPLETED') {
          return 'completed';
        }
        if (status === 'EXPIRED' || status === 'FAILED') {
          show({ message: status === 'EXPIRED' ? '支付超时，请重试' : '支付失败', type: 'error' });
          return 'terminal-failure';
        }
        // ACTIVE/PAID/中间态 → 继续 polling
        return 'continue-poll';
      }
      // 业务错误立即终止（区分网络错误）
      const code = (r.error as any)?.code;
      if (code === 'INVALID' || code === 'FORBIDDEN' || code === 'NOT_FOUND') {
        show({
          message: r.error.displayMessage ?? '支付确认失败，请联系客服',
          type: 'error',
        });
        return 'terminal-failure';
      }
      // NETWORK / UNKNOWN → 继续 polling 兜底
      return 'continue-poll';
    };

    // 第一步：active-query 立刻向支付宝查询真实状态
    const initialOutcome = await handleActiveQuery();
    if (initialOutcome === 'completed') {
      await invalidatePaymentQueries();
      show({ message: '支付成功', type: 'success' });
      onSuccess?.();
      return { outcome: 'completed' as const };
    }
    if (initialOutcome === 'terminal-failure') {
      return { outcome: 'terminal-failure' as const };
    }

    // 第二步：polling 兜底（90 次 × 2s = 约 180s）
    const MAX_POLLS = 90;
    const POLL_INTERVAL = 2000;
    const ACTIVE_QUERY_EVERY = 5;
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));

      // 每 5 轮（约 10s）再做一次 active-query 重查
      if (i > 0 && i % ACTIVE_QUERY_EVERY === 0) {
        const outcome = await handleActiveQuery();
        if (outcome === 'completed') {
          await invalidatePaymentQueries();
          show({ message: '支付成功', type: 'success' });
          onSuccess?.();
          return { outcome: 'completed' as const };
        }
        if (outcome === 'terminal-failure') {
          return { outcome: 'terminal-failure' as const };
        }
      }

      // 普通本地 session 状态轮询（看 notify 路径有没有更新 session）
      const statusR = await OrderRepo.getCheckoutSessionStatus(sessionId);
      if (statusR.ok) {
        const s = statusR.data.status;
        if (s === 'COMPLETED') {
          await invalidatePaymentQueries();
          show({ message: '支付成功', type: 'success' });
          onSuccess?.();
          return { outcome: 'completed' as const };
        }
        if (s === 'EXPIRED' || s === 'FAILED') {
          show({ message: s === 'EXPIRED' ? '支付超时' : '支付失败', type: 'error' });
          return { outcome: 'terminal-failure' as const };
        }
      }
    }

    // 兜底：超时未确认 — 软提示，不当失败（钱可能已扣，避免用户重复支付）
    show({ message: '支付处理中，请稍后到订单列表查看', type: 'info', duration: 4000 });
    router.replace('/orders');
    return { outcome: 'pending-confirm' as const };
  };
}
