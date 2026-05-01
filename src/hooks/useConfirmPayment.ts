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

    // 第一步：active-query 立刻向支付宝查询真实状态
    const activeR = await OrderRepo.activeQueryPayment(sessionId);
    if (activeR.ok) {
      const { status } = activeR.data;
      if (status === 'COMPLETED') {
        await queryClient.invalidateQueries({ queryKey: ['pending-checkout'] });
        await queryClient.invalidateQueries({ queryKey: ['orders'] });
        await queryClient.invalidateQueries({ queryKey: ['me-order-counts'] });
        show({ message: '支付成功', type: 'success' });
        onSuccess?.();
        return { outcome: 'completed' as const };
      }
      if (status === 'EXPIRED' || status === 'FAILED') {
        show({ message: status === 'EXPIRED' ? '支付超时，请重试' : '支付失败', type: 'error' });
        return { outcome: 'terminal-failure' as const };
      }
    }

    // 第二步：polling getCheckoutSessionStatus 最多 ~30 秒（每 2s 一次）
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const statusR = await OrderRepo.getCheckoutSessionStatus(sessionId);
      if (statusR.ok) {
        const s = statusR.data.status;
        if (s === 'COMPLETED') {
          await queryClient.invalidateQueries({ queryKey: ['pending-checkout'] });
          await queryClient.invalidateQueries({ queryKey: ['orders'] });
          await queryClient.invalidateQueries({ queryKey: ['me-order-counts'] });
          show({ message: '支付成功', type: 'success' });
          onSuccess?.();
          return { outcome: 'completed' as const };
        }
        if (s === 'EXPIRED' || s === 'FAILED') {
          show({ message: s === 'EXPIRED' ? '支付超时' : '支付失败', type: 'error' });
          return { outcome: 'terminal-failure' as const };
        }
      }
      // 每 5 轮（约 10s）再做一次 active-query 重查
      if (i > 0 && i % 5 === 0) {
        const reactiveR = await OrderRepo.activeQueryPayment(sessionId);
        if (reactiveR.ok && reactiveR.data.status === 'COMPLETED') {
          await queryClient.invalidateQueries({ queryKey: ['pending-checkout'] });
          await queryClient.invalidateQueries({ queryKey: ['orders'] });
          await queryClient.invalidateQueries({ queryKey: ['me-order-counts'] });
          show({ message: '支付成功', type: 'success' });
          onSuccess?.();
          return { outcome: 'completed' as const };
        }
      }
    }

    // 兜底：超时未确认 — 软提示，不当失败
    show({ message: '支付处理中，请稍后到订单列表查看', type: 'info', duration: 4000 });
    router.replace('/orders');
    return { outcome: 'pending-confirm' as const };
  };
}
