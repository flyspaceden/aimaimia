import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { AppHeader, Screen } from '../../../src/components/layout';
import { OrderRepo } from '../../../src/repos';
import { useAuthStore } from '../../../src/store';
import { priceTextProps, useTheme } from '../../../src/theme';
import type { PickupPass } from '../../../src/types/domain/Fulfillment';
import { formatPickupBusinessHours } from '../../../src/utils/pickupOrder';
import { openPickupLocation } from '../../../src/utils/openPickupLocation';

export default function PickupPassScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = typeof id === 'string' ? id : '';
  const userId = useAuthStore((s) => s.userId);
  const loggedIn = useAuthStore((s) => s.isLoggedIn);
  const { colors, typography, radius } = useTheme();
  // Credentials live only in this mounted screen; never enter the persisted query cache.
  const [entry, setEntry] = useState<{ owner?: string; pass: PickupPass; version: number }>();
  const [clock, setClock] = useState(Date.now());
  const [message, setMessage] = useState('正在读取取货凭证…');
  const [loading, setLoading] = useState(false);
  const [imageFailed, setImageFailed] = useState<number>();
  const generation = useRef(0);
  const refresh = useRef<() => void>(() => {});

  useFocusEffect(useCallback(() => {
    let active = true;
    let foreground = AppState.currentState === 'active';
    let pending = false;
    const clear = () => { generation.current += 1; setEntry(undefined); pending = false; setLoading(false); };
    const fetchPass = async () => {
      if (!active || !foreground || pending || !loggedIn || !userId || !orderId) return;
      pending = true;
      const version = ++generation.current;
      setLoading(true);
      try {
        const result = await OrderRepo.getPickupPass(orderId);
        if (!active || !foreground || version !== generation.current || useAuthStore.getState().userId !== userId || !useAuthStore.getState().isLoggedIn) return;
        if (result.ok && result.data.status === 'READY' && result.data.orderId === orderId && new Date(result.data.expiresAt).getTime() > Date.now()) {
          setEntry({ owner: userId, pass: result.data, version });
          setImageFailed(undefined);
          setMessage('');
        } else {
          setEntry(undefined);
          setMessage(result.ok ? '取货凭证已过期，请刷新。' : result.error.displayMessage || '取货凭证暂不可用，请返回订单查看状态。');
        }
      } catch {
        if (active && version === generation.current) {
          setEntry(undefined);
          setMessage('读取失败，旧凭证已撤下，请重试。');
        }
      } finally {
        if (version === generation.current) { pending = false; setLoading(false); }
      }
    };
    refresh.current = () => { clear(); void fetchPass(); };
    clear();
    void fetchPass();
    const poll = setInterval(() => void fetchPass(), 15_000);
    const tick = setInterval(() => setClock(Date.now()), 1_000);
    const subscription = AppState.addEventListener('change', (state) => {
      foreground = state === 'active';
      clear();
      if (foreground) void fetchPass();
    });
    // Invalidate synchronously even if logout/login changes happen between renders.
    const unsubscribe = useAuthStore.subscribe((state, previous) => {
      if (state.userId !== previous.userId || state.isLoggedIn !== previous.isLoggedIn) clear();
    });
    return () => {
      active = false;
      clear();
      refresh.current = () => {};
      clearInterval(poll);
      clearInterval(tick);
      subscription.remove();
      unsubscribe();
    };
  }, [loggedIn, userId, orderId]));

  const pass = loggedIn && userId && entry?.owner === userId && entry.pass.orderId === orderId
    && new Date(entry.pass.expiresAt).getTime() > clock ? entry.pass : undefined;
  const copyCode = async () => {
    if (!pass || new Date(pass.expiresAt).getTime() <= Date.now() || useAuthStore.getState().userId !== userId || !useAuthStore.getState().isLoggedIn) return;
    try {
      await Clipboard.setStringAsync(pass.pickupCode);
    } catch {
      Alert.alert('复制失败', '请直接向商家出示人工取货码。');
    }
  };
  const button = (label: string, onPress: () => void) => <Pressable accessibilityRole="button" onPress={onPress} style={[styles.button, { borderColor: colors.border, borderRadius: radius.md }]}><Text style={[typography.bodyStrong, { color: colors.brand.primary, textAlign: 'center' }]}>{label}</Text></Pressable>;
  const version = entry?.version;

  return <Screen safeAreaBottom contentStyle={{ flex: 1 }}>
    <AppHeader title="取货凭证" />
    <ScrollView contentContainerStyle={styles.content}>
      {pass ? <>
        <Text style={[typography.title2, { color: colors.text.primary }]}>商品已备好</Text>
        <Text style={[typography.body, { color: colors.text.secondary }]}>到店后出示二维码或人工取货码，由商家核销完成取货。</Text>
        <View style={[styles.ticket, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{pass.pickupPoint.name}</Text>
          {pass.qrImageBase64 && pass.qrImageMimeType === 'image/png' && imageFailed !== version ? <Image
            key={version}
            accessibilityLabel="本订单取货二维码"
            source={{ uri: `data:image/png;base64,${pass.qrImageBase64}` }}
            resizeMode="contain"
            style={styles.qr}
            onError={() => { if (generation.current === version) setImageFailed(version); }}
          /> : <Text style={[typography.body, { color: colors.text.secondary, marginVertical: 20 }]}>二维码未能显示，请使用下方人工取货码，或刷新重试。</Text>}
          <Text style={[typography.caption, { color: colors.text.secondary }]}>人工取货码</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="复制人工取货码" onPress={() => void copyCode()} style={{ paddingVertical: 12 }}>
            <Text {...priceTextProps} style={{ color: colors.text.primary, fontSize: 32, fontWeight: '700', textAlign: 'center' }}>{pass.pickupCode}</Text>
          </Pressable>
          <Text style={[typography.caption, { color: colors.text.secondary }]}>点击可复制 · 仅本订单一次有效</Text>
        </View>
        <Text style={[typography.body, { color: colors.text.primary }]}>取货人：{pass.recipient.name}　{pass.recipient.phoneMasked}</Text>
        <Text style={[typography.body, { color: colors.text.primary }]}>自提地址：{pass.pickupPoint.regionText} {pass.pickupPoint.detail}</Text>
        <Text style={[typography.body, { color: colors.text.secondary }]}>营业时间：{formatPickupBusinessHours(pass.pickupPoint.businessHours)}</Text>
        {pass.pickupPoint.pickupNotice ? <Text style={[typography.body, { color: colors.text.secondary }]}>取货须知：{pass.pickupPoint.pickupNotice}</Text> : null}
        <Text style={[typography.caption, { color: colors.text.secondary }]}>二维码有效至 {new Date(pass.expiresAt).toLocaleTimeString('zh-CN')}，页面会自动刷新，无需在此时间前到店。</Text>
        {button('按地址搜索自提点', () => void openPickupLocation(pass.pickupPoint))}
        <Text style={[typography.caption, { color: colors.text.secondary }]}>地图按地址搜索，请核对门店。请勿将凭证转发他人，核销后立即失效。</Text>
      </> : <Text style={[typography.body, { color: colors.text.secondary }]}>{!loggedIn ? '请先登录后查看本人取货凭证。' : !orderId ? '订单信息缺失，请返回订单重新进入。' : message || '二维码已过期，请刷新取货凭证。'}</Text>}
      {loading ? <ActivityIndicator color={colors.brand.primary} /> : null}
      {loggedIn && orderId ? button('刷新取货凭证', () => refresh.current()) : null}
    </ScrollView>
  </Screen>;
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32, gap: 16 },
  ticket: { padding: 20, alignItems: 'center' },
  qr: { width: '100%', maxWidth: 260, aspectRatio: 1, marginVertical: 16, backgroundColor: '#fff' },
  button: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 16, borderWidth: 1 },
});
