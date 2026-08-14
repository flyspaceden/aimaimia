import React from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'react-native-qrcode-svg';
import { OrderRepo } from '../../repos';
import { useTheme } from '../../theme';
import type { Order } from '../../types';
import {
  formatPickupBusinessHours,
  pickupOrderStatusHint,
  pickupOrderStatusLabel,
} from '../../utils';

export function PickupFulfillmentCard({ order }: { order: Order }) {
  const { colors, radius, spacing, typography } = useTheme();
  const [revealPass, setRevealPass] = React.useState(false);
  const [clock, setClock] = React.useState(() => Date.now());
  const pickup = order.pickupFulfillment;
  const passQuery = useQuery({
    queryKey: ['order', order.id, 'pickup-pass'],
    queryFn: () => OrderRepo.getPickupPass(order.id),
    enabled: revealPass && pickup?.status === 'READY',
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: revealPass && pickup?.status === 'READY' ? 15_000 : false,
  });
  React.useEffect(() => {
    if (!revealPass) return undefined;
    const timer = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [revealPass]);
  if (order.fulfillmentMode !== 'PICKUP') return null;
  if (!pickup) {
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.danger, borderRadius: radius.lg, padding: spacing.md }]}>
        <Text style={[typography.bodyStrong, { color: colors.danger }]}>自提履约信息暂不可用</Text>
        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>系统不会将本单改按快递展示，请联系订单客服处理。</Text>
      </View>
    );
  }

  const point = pickup.pickupPoint;
  const rawPass = passQuery.data?.ok ? passQuery.data.data : undefined;
  const pass = rawPass && new Date(rawPass.expiresAt).getTime() > clock ? rawPass : undefined;
  const openMap = async () => {
    const location = point.location;
    if (!location) return;
    const label = encodeURIComponent(point.name);
    const url = Platform.select({
      ios: `http://maps.apple.com/?ll=${location.lat},${location.lng}&q=${label}`,
      default: `geo:${location.lat},${location.lng}?q=${location.lat},${location.lng}(${label})`,
    });
    if (url) await Linking.openURL(url);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md }]}>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: colors.brand.primarySoft, borderRadius: radius.md }]}>
          <MaterialCommunityIcons name="store-marker-outline" size={20} color={colors.brand.primary} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{pickupOrderStatusLabel(order)}</Text>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 2 }]}>{pickupOrderStatusHint(order)}</Text>
        </View>
      </View>

      <View style={[styles.place, { borderTopColor: colors.border }]}>
        <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{point.name}</Text>
        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>{point.regionText} {point.detail}</Text>
        <Text style={[typography.caption, { color: colors.brand.primary, marginTop: 4 }]}>{formatPickupBusinessHours(point.businessHours)}</Text>
        {point.pickupNotice ? <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>{point.pickupNotice}</Text> : null}
        <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 8 }]}>自提人：{pickup.recipient.name}　{pickup.recipient.phoneMasked}</Text>
        {point.location ? (
          <Pressable onPress={openMap} style={styles.mapAction}>
            <MaterialCommunityIcons name="navigation-variant-outline" size={16} color={colors.brand.primary} />
            <Text style={[typography.caption, { color: colors.brand.primary, marginLeft: 4 }]}>导航到自提点</Text>
          </Pressable>
        ) : null}
      </View>

      {pickup.status === 'READY' ? (
        <View style={[styles.ticket, { backgroundColor: colors.brand.primarySoft, borderColor: colors.brand.primary, borderRadius: radius.md }]}>
          {!revealPass ? (
            <Pressable onPress={() => setRevealPass(true)} style={[styles.revealButton, { backgroundColor: colors.brand.primary, borderRadius: radius.pill }]}>
              <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>显示一次性取货凭证</Text>
            </Pressable>
          ) : passQuery.isLoading ? (
            <ActivityIndicator color={colors.brand.primary} />
          ) : pass ? (
            <>
              <View style={styles.qrWrap}><QRCode value={pass.qrPayload} size={184} color="#142C1A" backgroundColor="#FFFFFF" /></View>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 12 }]}>人工取货码</Text>
              <Text selectable style={[styles.code, { color: colors.text.primary }]}>{pass.pickupCode}</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>有效至 {new Date(pass.expiresAt).toLocaleString('zh-CN')}</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 8, textAlign: 'center' }]}>请勿转发；商家核销后凭证立即失效。</Text>
            </>
          ) : (
            <Text style={[typography.caption, { color: colors.danger, textAlign: 'center' }]}>{passQuery.data && !passQuery.data.ok ? passQuery.data.error.displayMessage || '取货凭证已失效' : rawPass ? '二维码已过期，正在刷新' : '取货凭证暂不可用'}</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 8, borderWidth: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start' },
  icon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, marginLeft: 10 },
  place: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  mapAction: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: 9, paddingVertical: 4 },
  ticket: { alignItems: 'center', marginTop: 14, padding: 14, borderWidth: 1, borderStyle: 'dashed' },
  revealButton: { paddingHorizontal: 18, paddingVertical: 11 },
  qrWrap: { padding: 10, backgroundColor: '#FFFFFF', borderRadius: 12 },
  code: { marginTop: 3, fontSize: 27, fontWeight: '800', letterSpacing: 6 },
});
