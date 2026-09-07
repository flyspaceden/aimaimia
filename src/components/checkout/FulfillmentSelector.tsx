import React from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useTheme, useResponsiveLayout } from '../../theme';
import type { PickupSelection } from '../../hooks/usePickupSelection';
import { formatPickupBusinessHours, isPickupRecipientValid } from '../../utils/pickupSelection';
import { openPickupLocation } from '../../utils/openPickupLocation';

export function FulfillmentSelector({ pickup, disabled = false }: { pickup: PickupSelection; disabled?: boolean }) {
  const { colors, spacing, typography } = useTheme();
  const { isCompact, isLargeText } = useResponsiveLayout();
  const inputStyle = { ...typography.body, color: colors.text.primary, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: spacing.md, minHeight: 48 };
  return <View style={{ backgroundColor: colors.surface, borderRadius: 8, padding: spacing.lg, gap: spacing.md }}>
    <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>履约方式</Text>
    <View style={{ flexDirection: isCompact || isLargeText ? 'column' : 'row', gap: spacing.sm }}>
      {(['DELIVERY', 'PICKUP'] as const).map((mode) => <Pressable key={mode} accessibilityRole="radio" accessibilityState={{ checked: pickup.mode === mode, disabled: disabled || (mode === 'PICKUP' && !pickup.available) }} disabled={disabled || (mode === 'PICKUP' && !pickup.available)} onPress={() => pickup.setMode(mode)} style={{ flex: 1, minHeight: 58, padding: spacing.md, borderRadius: 8, borderWidth: 1, borderColor: pickup.mode === mode ? colors.brand.primary : colors.border }}>
        <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{pickup.mode === mode ? '● ' : '○ '}{mode === 'DELIVERY' ? '送货上门' : '到店自提'}</Text>
        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>{mode === 'DELIVERY' ? '平台统一安排配送' : pickup.loading ? '正在查询自提点' : pickup.available ? '免运费，备好后凭码取货' : '当前商品暂无可用自提点'}</Text>
      </Pressable>)}
    </View>
    {pickup.loading ? <ActivityIndicator color={colors.brand.primary} /> : null}
    {pickup.error ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{pickup.error}</Text> : null}
    <Pressable disabled={disabled || pickup.loading} accessibilityRole="button" onPress={pickup.retry} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.brand.primary }}>{pickup.error ? '重新加载自提点' : '刷新自提点'}</Text></Pressable>
    {pickup.mode === 'PICKUP' ? <>
      <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>取货人</Text>
      <TextInput accessibilityLabel="取货人姓名" placeholder="姓名（至少 2 个字）" placeholderTextColor={colors.text.tertiary} value={pickup.recipientName} onChangeText={pickup.setRecipientName} maxLength={20} editable={!disabled} style={inputStyle} />
      <TextInput accessibilityLabel="取货人手机号" placeholder="11 位手机号" placeholderTextColor={colors.text.tertiary} value={pickup.recipientPhone} onChangeText={pickup.setRecipientPhone} keyboardType="phone-pad" maxLength={11} editable={!disabled} style={inputStyle} />
      {!isPickupRecipientValid(pickup.recipientName, pickup.recipientPhone) ? <Text style={{ color: colors.text.secondary }}>请填写至少 2 个字的姓名和有效手机号</Text> : null}
      <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>按商家选择自提点</Text>
      {pickup.groups.map((group) => <View key={group.companyId} style={{ gap: spacing.sm }}>
        <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{group.companyName}</Text>
        {!group.points.length ? <Text style={{ color: colors.danger }}>该商家暂无可用自提点，请选择送货上门</Text> : null}
        {group.points.map((point) => <View key={point.id} style={{ borderWidth: 1, borderColor: pickup.selections[group.companyId] === point.id ? colors.brand.primary : colors.border, padding: spacing.md, borderRadius: 8, gap: spacing.sm }}>
          <Pressable disabled={disabled || pickup.loading} accessibilityRole="radio" accessibilityState={{ checked: pickup.selections[group.companyId] === point.id }} onPress={() => pickup.setSelection(group.companyId, point.id)} style={{ minHeight: 44, gap: spacing.xs }}>
            <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{pickup.selections[group.companyId] === point.id ? '● ' : '○ '}{point.name}{point.isPlatformHub || point.kind === 'PLATFORM_HUB' ? ' · 平台中心仓' : ''}</Text>
            <Text style={{ color: colors.text.secondary }}>{point.regionText} {point.detail}</Text>
            <Text style={{ color: colors.text.secondary }}>营业时间：{formatPickupBusinessHours(point.businessHours)}</Text>
            {point.pickupNotice ? <Text style={{ color: colors.text.secondary }}>取货须知：{point.pickupNotice}</Text> : null}
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => { void openPickupLocation(point); }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.brand.primary }}>查看位置 / 导航</Text></Pressable>
        </View>)}
      </View>)}
      <Text style={[typography.caption, { color: colors.text.secondary }]}>商家备好后凭码取货。各订单独立核销，请分别展示取货凭证。</Text>
    </> : null}
  </View>;
}
