import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { compactActionTextProps, fitTextProps, useTheme } from '../../theme';
import type { GroupBuyCurrentInstance } from '../../types';
import { calculateGroupBuyProgressTargetCount } from '../../utils/groupBuyProgress';
import { GROUP_BUY_COLORS } from './constants';

type GroupBuyProgressRailProps = {
  current: GroupBuyCurrentInstance;
};

export const GroupBuyProgressRail = ({ current }: GroupBuyProgressRailProps) => {
  const { colors, spacing, typography } = useTheme();
  const targetCount = calculateGroupBuyProgressTargetCount(current.activity.tiers);
  const steps = useMemo(
    () => Array.from({ length: targetCount }, (_, index) => {
      const sequence = index + 1;
      const referral = current.referrals.find((item) => (
        item.effectiveSequence === sequence || item.candidateSequence === sequence
      ));
      const status = referral?.status;
      const completed = status === 'VALID';
      const pending = status === 'CANDIDATE';
      return { sequence, completed, pending };
    }),
    [current.referrals, targetCount],
  );

  const remaining = Math.max(targetCount - current.validReferralCount, 0);

  return (
    <View style={[styles.wrap, { gap: spacing.md }]}>
      <View style={styles.summaryRow}>
        <View style={styles.summaryItem}>
          <Text {...compactActionTextProps} style={[typography.headingMd, { color: GROUP_BUY_COLORS.pine }]}>
            {current.validReferralCount}/{targetCount}
          </Text>
          <Text {...fitTextProps} style={[typography.caption, { color: colors.text.secondary }]}>
            有效好友
          </Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
        <View style={styles.summaryItem}>
          <Text {...compactActionTextProps} style={[typography.headingMd, { color: GROUP_BUY_COLORS.tide }]}>
            {current.candidateCount}
          </Text>
          <Text {...fitTextProps} style={[typography.caption, { color: colors.text.secondary }]}>
            待确认订单
          </Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
        <View style={styles.summaryItem}>
          <Text {...compactActionTextProps} style={[typography.headingMd, { color: remaining > 0 ? GROUP_BUY_COLORS.coral : GROUP_BUY_COLORS.brass }]}>
            {remaining}
          </Text>
          <Text {...fitTextProps} style={[typography.caption, { color: colors.text.secondary }]}>
            还需好友
          </Text>
        </View>
      </View>

      <View style={styles.railRow}>
        {steps.map((step, index) => (
          <React.Fragment key={step.sequence}>
            <View
              style={[
                styles.stepDot,
                {
                  borderColor: step.completed ? GROUP_BUY_COLORS.tide : step.pending ? GROUP_BUY_COLORS.brass : colors.border,
                  backgroundColor: step.completed ? GROUP_BUY_COLORS.tide : step.pending ? '#FFF7DF' : colors.surface,
                },
              ]}
            >
              <MaterialCommunityIcons
                name={step.completed ? 'check' : step.pending ? 'clock-outline' : 'account-outline'}
                size={16}
                color={step.completed ? '#FFFFFF' : step.pending ? GROUP_BUY_COLORS.brass : colors.muted}
              />
            </View>
            {index < steps.length - 1 ? (
              <View
                style={[
                  styles.railLine,
                  { backgroundColor: step.completed ? `${GROUP_BUY_COLORS.tide}66` : colors.border },
                ]}
              />
            ) : null}
          </React.Fragment>
        ))}
      </View>

      <View style={styles.labelRow}>
        {steps.map((step) => (
          <Text
            key={step.sequence}
            {...fitTextProps}
            style={[
              typography.caption,
              styles.stepLabel,
              { color: step.completed ? GROUP_BUY_COLORS.tide : step.pending ? GROUP_BUY_COLORS.brass : colors.text.tertiary },
            ]}
          >
            {step.completed ? '已有效' : step.pending ? '待确认' : `第 ${step.sequence} 位`}
          </Text>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {},
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    minWidth: 0,
  },
  summaryDivider: {
    width: 1,
    height: 32,
  },
  railRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railLine: {
    flex: 1,
    height: 2,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  stepLabel: {
    flex: 1,
    textAlign: 'center',
  },
});
