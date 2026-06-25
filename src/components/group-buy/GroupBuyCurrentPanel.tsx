import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { compactActionTextProps, fitTextProps, useTheme } from '../../theme';
import { monoFamily } from '../../theme/typography';
import { useToast } from '../feedback';
import { Countdown } from '../ui/Countdown';
import type { GroupBuyCurrentInstance } from '../../types';
import { getGroupBuyCountdownState } from '../../utils/groupBuyCountdown';
import { calculateGroupBuyProgressTargetCount } from '../../utils/groupBuyProgress';
import { GROUP_BUY_COLORS, GROUP_BUY_SHARE_URL } from './constants';
import { GroupBuyProgressRail } from './GroupBuyProgressRail';

type GroupBuyCurrentPanelProps = {
  current: GroupBuyCurrentInstance;
  onTerminate?: () => void;
  onAbandon?: () => void;
  onActivityExpire?: () => void;
  terminating?: boolean;
  abandoning?: boolean;
};

const statusCopy: Record<GroupBuyCurrentInstance['status'], {
  title: string;
  description: string;
  tone: 'active' | 'pending' | 'muted' | 'done';
}> = {
  QUALIFICATION_PENDING: {
    title: '资格确认中',
    description: '确认收货且无退换货后，将生成本次分享推荐码。',
    tone: 'pending',
  },
  SHARING: {
    title: '本次分享进行中',
    description: '好友通过本次推荐码购买同款并完成有效订单后计入。',
    tone: 'active',
  },
  COMPLETED: {
    title: '本次分享已完成',
    description: '符合条件的返还会按到账规则处理。',
    tone: 'done',
  },
  TERMINATED: {
    title: '本次分享已结束',
    description: '已到账返还保留，未确认的推荐名额不再产生返还。',
    tone: 'muted',
  },
  QUALIFICATION_ABANDONED: {
    title: '本次资格已放弃',
    description: '本次资格已关闭，可重新选择团购商品。',
    tone: 'muted',
  },
  QUALIFICATION_INVALID: {
    title: '本次资格未生效',
    description: '订单发生退换货或未满足条件，未生成分享推荐码。',
    tone: 'muted',
  },
  EXPIRED: {
    title: '本次分享已过期',
    description: '活动有效期结束后，本次推荐码已失效，未到账的推荐不再产生返还。',
    tone: 'muted',
  },
};

const toneColor = {
  active: GROUP_BUY_COLORS.tide,
  pending: GROUP_BUY_COLORS.brass,
  muted: GROUP_BUY_COLORS.inkSoft,
  done: GROUP_BUY_COLORS.coral,
};

export const GroupBuyCurrentPanel = ({
  current,
  onTerminate,
  onAbandon,
  onActivityExpire,
  terminating = false,
  abandoning = false,
}: GroupBuyCurrentPanelProps) => {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const [clockState, setClockState] = useState(() => getGroupBuyCountdownState(current.activity.endAt));
  const code = current.code?.code ?? '';
  const shareUrl = useMemo(() => (code ? `${GROUP_BUY_SHARE_URL}/${encodeURIComponent(code)}` : ''), [code]);
  const targetCount = calculateGroupBuyProgressTargetCount(current.activity.tiers);
  const lockedCount = Math.min(
    targetCount,
    current.referrals.filter((item) => item.status === 'CANDIDATE' || item.status === 'VALID').length,
  );
  const slotsFull = current.status === 'SHARING' && targetCount > 0 && lockedCount >= targetCount;
  const baseCopy = statusCopy[current.status];
  const activityPaused = current.activity.status === 'PAUSED';
  const copy = activityPaused && current.status === 'SHARING'
    ? {
      title: '活动已暂停',
      description: '活动暂停期间，本次推荐码暂不可用；活动恢复后可继续分享，也可以主动结束本次分享。',
      tone: 'muted' as const,
    }
    : slotsFull
      ? {
        title: '推荐名额已锁定',
        description: '已锁定全部推荐名额，等待好友确认收货且无退换货后释放返还。',
        tone: 'pending' as const,
      }
      : baseCopy;
  const activityEnded = current.status === 'EXPIRED' || current.activity.status === 'ENDED' || clockState.expired;
  const countdownUrgent = !activityEnded && clockState.urgent;
  const canShare = !activityEnded && !activityPaused && !slotsFull && current.status === 'SHARING' && current.code?.status === 'ACTIVE' && Boolean(code);
  const canTerminate = !activityEnded && current.status === 'SHARING';
  const canAbandon = !activityEnded && current.status === 'QUALIFICATION_PENDING';
  const showShareActions = !activityEnded && !activityPaused && !slotsFull;
  const qrPlaceholderText = slotsFull
    ? '已锁满'
    : activityEnded
      ? '已失效'
      : activityPaused
        ? '已暂停'
        : '待生成';

  useEffect(() => {
    setClockState(getGroupBuyCountdownState(current.activity.endAt));
  }, [current.id, current.activity.endAt]);

  const handleActivityExpire = () => {
    setClockState({ expired: true, urgent: false });
    onActivityExpire?.();
  };

  const handleCountdownTick = (remainingMs: number) => {
    setClockState({
      expired: remainingMs <= 0,
      urgent: remainingMs > 0 && remainingMs < 24 * 60 * 60 * 1000,
    });
  };

  const handleCopy = async () => {
    if (activityEnded) {
      show({ message: '团购活动已结束', type: 'info' });
      return;
    }
    if (activityPaused) {
      show({ message: '团购活动已暂停', type: 'info' });
      return;
    }
    if (slotsFull) {
      show({ message: '推荐名额已锁满', type: 'info' });
      return;
    }
    if (!code) {
      show({ message: '推荐码生成后可复制', type: 'info' });
      return;
    }
    await Clipboard.setStringAsync(shareUrl || code);
    show({ message: '团购推荐码已复制', type: 'success' });
  };

  const handleShare = async () => {
    if (!canShare) {
      show({ message: activityPaused ? '团购活动已暂停' : slotsFull ? '推荐名额已锁满' : '推荐码生成后可分享', type: 'info' });
      return;
    }
    try {
      await Share.share({
        message: `我买了 ${current.activity.product.title}，现在 APP 有分享福利。你下单同款，我可返还本次货款，你正常享受商品服务。${shareUrl}`,
      });
    } catch {
      // 用户取消系统分享时无需提示。
    }
  };

  return (
    <View style={[styles.panel, shadow.md, { borderRadius: 8, backgroundColor: colors.surface, borderColor: `${GROUP_BUY_COLORS.tide}22` }]}>
      <LinearGradient
        colors={[GROUP_BUY_COLORS.pine, GROUP_BUY_COLORS.tide]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.hero, { borderRadius: 8 }]}
      >
        <View style={styles.heroTop}>
          <View style={[styles.statusPill, { backgroundColor: 'rgba(255,253,246,0.14)' }]}>
            <View style={[styles.statusDot, { backgroundColor: toneColor[copy.tone] }]} />
            <Text {...compactActionTextProps} style={[typography.caption, { color: '#FFFFFF' }]}>
              {copy.title}
            </Text>
          </View>
          <Text {...compactActionTextProps} style={[typography.caption, { color: 'rgba(255,255,255,0.72)' }]}>
            {current.activity.product.title}
          </Text>
        </View>

        {current.activity.endAt ? (
          <View
            style={[
              styles.heroCountdown,
              {
                backgroundColor: countdownUrgent ? 'rgba(230,90,70,0.30)' : 'rgba(255,253,246,0.14)',
                borderColor: countdownUrgent ? 'rgba(255,205,193,0.80)' : 'rgba(255,253,246,0.18)',
                marginTop: spacing.sm,
              },
            ]}
          >
            <MaterialCommunityIcons
              name={countdownUrgent ? 'timer-alert-outline' : 'clock-outline'}
              size={14}
              color={countdownUrgent ? '#FFE5DE' : '#FFFFFF'}
            />
            {activityEnded ? (
              <Text {...compactActionTextProps} style={[typography.caption, styles.countdownText, { color: 'rgba(255,255,255,0.82)' }]}>
                活动已结束，本次分享已失效
              </Text>
            ) : (
              <Countdown
                expiresAt={current.activity.endAt}
                format="days-hours-minutes"
                prefix={countdownUrgent ? '活动即将结束' : '活动剩余'}
                onExpire={handleActivityExpire}
                onTick={handleCountdownTick}
                {...compactActionTextProps}
                style={[
                  typography.caption,
                  styles.countdownText,
                  countdownUrgent && styles.countdownTextUrgent,
                  { color: countdownUrgent ? '#FFE5DE' : '#FFFFFF' },
                ]}
              />
            )}
          </View>
        ) : null}

        <View style={[styles.codeRow, { marginTop: spacing.lg }]}>
          <View style={[styles.qrBox, { backgroundColor: GROUP_BUY_COLORS.ivory, borderRadius: 8 }]}>
            {canShare ? (
              <QRCode value={shareUrl} size={104} color={GROUP_BUY_COLORS.pine} backgroundColor={GROUP_BUY_COLORS.ivory} />
            ) : (
              <View style={styles.qrPlaceholder}>
                <MaterialCommunityIcons name="qrcode" size={42} color={`${GROUP_BUY_COLORS.pine}55`} />
                <Text {...fitTextProps} style={[typography.caption, { color: GROUP_BUY_COLORS.inkSoft, marginTop: 4 }]}>
                  {qrPlaceholderText}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.codeInfo}>
            <Text style={[typography.caption, { color: 'rgba(255,255,255,0.72)' }]}>
              团购推荐码
            </Text>
            <Text
              {...fitTextProps}
              style={[styles.codeText, { color: '#FFFFFF', marginTop: 6 }]}
            >
              {code ? code.split('').join(' ') : '确认中'}
            </Text>
            <Text numberOfLines={3} style={[typography.caption, styles.heroDescription, { color: 'rgba(255,255,255,0.78)', marginTop: spacing.sm }]}>
              {copy.description}
            </Text>
          </View>
        </View>
      </LinearGradient>

      <View style={[styles.body, { padding: spacing.lg, gap: spacing.lg }]}>
        <GroupBuyProgressRail current={current} />

        {showShareActions ? (
          <View style={styles.actionRow}>
            <Pressable
              onPress={handleCopy}
              style={[styles.secondaryButton, { borderColor: GROUP_BUY_COLORS.mist, borderRadius: radius.pill }]}
            >
              <MaterialCommunityIcons name="content-copy" size={16} color={GROUP_BUY_COLORS.pine} />
              <Text {...compactActionTextProps} style={[typography.bodyStrong, styles.actionText, { color: GROUP_BUY_COLORS.pine }]}>
                复制推荐码
              </Text>
            </Pressable>

            <Pressable
              onPress={handleShare}
              disabled={!canShare}
              style={[
                styles.primaryButton,
                {
                  borderRadius: radius.pill,
                  backgroundColor: canShare ? GROUP_BUY_COLORS.pine : colors.bgSecondary,
                },
              ]}
            >
              <MaterialCommunityIcons name="share-variant-outline" size={16} color={canShare ? '#FFFFFF' : colors.muted} />
              <Text {...compactActionTextProps} style={[typography.bodyStrong, styles.actionText, { color: canShare ? '#FFFFFF' : colors.muted }]}>
                系统分享
              </Text>
            </Pressable>
          </View>
        ) : null}

        {canTerminate || canAbandon ? (
          <Pressable
            onPress={canTerminate ? onTerminate : onAbandon}
            disabled={terminating || abandoning}
            style={[styles.endButton, { borderColor: `${GROUP_BUY_COLORS.coral}44`, borderRadius: radius.pill }]}
          >
            <MaterialCommunityIcons name="stop-circle-outline" size={16} color={GROUP_BUY_COLORS.coral} />
            <Text {...compactActionTextProps} style={[typography.bodyStrong, styles.actionText, { color: GROUP_BUY_COLORS.coral }]}>
              {canTerminate ? (terminating ? '结束中' : '结束本次分享') : (abandoning ? '处理中' : '放弃本次资格')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  panel: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  hero: {
    padding: 16,
    overflow: 'hidden',
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
  },
  heroCountdown: {
    alignSelf: 'flex-start',
    minHeight: 28,
    maxWidth: '100%',
    borderWidth: 1,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  countdownText: {
    marginLeft: 5,
  },
  countdownTextUrgent: {
    fontWeight: '800',
  },
  codeRow: {
    flexDirection: 'row',
    gap: 14,
  },
  qrBox: {
    width: 116,
    height: 116,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeInfo: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  codeText: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '800',
    fontFamily: monoFamily,
  },
  heroDescription: {
    minHeight: 54,
  },
  body: {},
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  primaryButton: {
    flex: 1,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  endButton: {
    minHeight: 42,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  actionText: {
    marginLeft: 6,
  },
});
