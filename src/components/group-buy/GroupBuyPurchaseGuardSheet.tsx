import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppBottomSheet } from '../overlay';
import { compactActionTextProps, fitTextProps, useTheme } from '../../theme';
import type { GroupBuyCurrentInstance, GroupBuyActivity } from '../../types';
import { GROUP_BUY_COLORS } from './constants';

type GroupBuyPurchaseGuardSheetProps = {
  open: boolean;
  current: GroupBuyCurrentInstance | null;
  targetActivity?: GroupBuyActivity | null;
  onClose: () => void;
  onEndAndBuy: () => void;
  onViewCurrent: () => void;
  loading?: boolean;
};

export const GroupBuyPurchaseGuardSheet = ({
  open,
  current,
  targetActivity,
  onClose,
  onEndAndBuy,
  onViewCurrent,
  loading = false,
}: GroupBuyPurchaseGuardSheetProps) => {
  const { colors, radius, spacing, typography } = useTheme();
  const currentTitle = current?.activity.title ?? '当前团购';
  const targetTitle = targetActivity?.title ?? '新的团购商品';
  const isPending = current?.status === 'QUALIFICATION_PENDING';
  const heading = isPending ? '当前有待确认资格' : '当前有进行中的分享';
  const description = isPending
    ? `${currentTitle} 正在等待确认收货及售后期结束，暂未生成推荐码。同一时间只能保留一个团购资格，需要先放弃本次资格，才可以购买 ${targetTitle}。`
    : `${currentTitle} 正在分享中。同一时间只能保留一个团购推荐码，需要先结束本次分享，才可以购买 ${targetTitle}。`;
  const ruleCopy = isPending
    ? '放弃后，本次资格不会再生成推荐码，也不会产生新的返还记录。'
    : '已经产生的有效推荐订单，仍按确认收货且无退换货后的规则处理。';
  const endLabel = isPending ? '放弃本次资格并购买' : '结束本次分享并购买';

  return (
    <AppBottomSheet open={open} onClose={onClose} mode="auto" title="需要先处理当前团购">
      <View style={{ gap: spacing.lg }}>
        <View style={[styles.noticeBox, { borderRadius: 8, backgroundColor: GROUP_BUY_COLORS.porcelain, borderColor: GROUP_BUY_COLORS.mist }]}>
          <View style={[styles.noticeIcon, { backgroundColor: `${GROUP_BUY_COLORS.tide}18` }]}>
            <MaterialCommunityIcons name="ticket-confirmation-outline" size={24} color={GROUP_BUY_COLORS.tide} />
          </View>
          <View style={styles.noticeText}>
            <Text {...fitTextProps} style={[typography.bodyStrong, { color: colors.text.primary }]}>
              {heading}
            </Text>
            <Text style={[typography.bodySm, { color: colors.text.secondary, marginTop: 4 }]}>
              {description}
            </Text>
          </View>
        </View>

        <View style={[styles.ruleRow, { borderColor: colors.border }]}>
          <MaterialCommunityIcons name="shield-check-outline" size={18} color={GROUP_BUY_COLORS.brass} />
          <Text style={[typography.caption, styles.ruleText, { color: colors.text.secondary }]}>
            {ruleCopy}
          </Text>
        </View>

        <Pressable
          onPress={onEndAndBuy}
          disabled={loading}
          style={[styles.primaryAction, { borderRadius: radius.pill, backgroundColor: GROUP_BUY_COLORS.pine }]}
        >
          <MaterialCommunityIcons name="stop-circle-outline" size={18} color="#FFFFFF" />
          <Text {...compactActionTextProps} style={[typography.bodyStrong, styles.actionText, { color: '#FFFFFF' }]}>
            {loading ? '处理中' : endLabel}
          </Text>
        </Pressable>

        <Pressable
          onPress={onViewCurrent}
          style={[styles.secondaryAction, { borderRadius: radius.pill, borderColor: GROUP_BUY_COLORS.mist }]}
        >
          <MaterialCommunityIcons name="clipboard-text-outline" size={18} color={GROUP_BUY_COLORS.pine} />
          <Text {...compactActionTextProps} style={[typography.bodyStrong, styles.actionText, { color: GROUP_BUY_COLORS.pine }]}>
            查看本次状态
          </Text>
        </Pressable>
      </View>
    </AppBottomSheet>
  );
};

const styles = StyleSheet.create({
  noticeBox: {
    borderWidth: 1,
    flexDirection: 'row',
    padding: 14,
    gap: 12,
  },
  noticeIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeText: {
    flex: 1,
    minWidth: 0,
  },
  ruleRow: {
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    gap: 8,
  },
  ruleText: {
    flex: 1,
    minWidth: 0,
  },
  primaryAction: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  secondaryAction: {
    minHeight: 46,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  actionText: {
    marginLeft: 7,
  },
});
