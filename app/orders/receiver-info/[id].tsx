import React from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../../src/components/layout';
import { ErrorState, Skeleton, useToast } from '../../../src/components/feedback';
import { RegionPicker, type RegionValue } from '../../../src/components/forms';
import { OrderRepo } from '../../../src/repos';
import { useBottomInset, useTheme } from '../../../src/theme';
import { isMainlandPhone } from '../../../src/utils';

type FormData = {
  recipientName: string;
  phone: string;
  region: RegionValue | null;
  detail: string;
};

const emptyForm: FormData = {
  recipientName: '',
  phone: '',
  region: null,
  detail: '',
};

const toRegionValue = (snapshot: any): RegionValue | null => {
  if (snapshot?.regionCode && snapshot?.regionText) {
    return { regionCode: snapshot.regionCode, regionText: snapshot.regionText };
  }
  const regionText = [snapshot?.province, snapshot?.city, snapshot?.district].filter(Boolean).join('/');
  return regionText ? { regionCode: '', regionText } : null;
};

export default function OrderReceiverInfoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = String(id ?? '');
  const { colors, radius, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const bottomPadding = useBottomInset(160);
  const [form, setForm] = React.useState<FormData>(emptyForm);
  const [submitting, setSubmitting] = React.useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => OrderRepo.getById(orderId),
    enabled: Boolean(orderId),
  });

  React.useEffect(() => {
    if (!data?.ok) return;
    const snapshot = data.data.addressSnapshot || {};
    setForm({
      recipientName: snapshot.recipientName || snapshot.receiverName || '',
      phone: snapshot.phone || '',
      region: toRegionValue(snapshot),
      detail: snapshot.detail || '',
    });
  }, [data]);

  const validate = (): string | null => {
    if (!form.recipientName.trim()) return '请输入收货人姓名';
    if (!isMainlandPhone(form.phone)) return '请输入正确的手机号';
    if (!form.region?.regionCode || !form.region?.regionText) return '请选择省/市/区';
    if (!form.detail.trim()) return '请输入详细地址';
    return null;
  };

  const handleSave = async () => {
    const error = validate();
    if (error) {
      show({ message: error, type: 'error' });
      return;
    }
    setSubmitting(true);
    try {
      const result = await OrderRepo.updateReceiverInfo(orderId, {
        recipientName: form.recipientName.trim(),
        phone: form.phone.trim(),
        regionCode: form.region!.regionCode,
        regionText: form.region!.regionText,
        detail: form.detail.trim(),
      });
      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '修改失败', type: 'error' });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      await queryClient.invalidateQueries({ queryKey: ['inbox'] });
      show({ message: '收货信息已更新', type: 'success' });
      router.back();
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="修改收货信息" />
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={220} radius={radius.lg} />
        </View>
      </Screen>
    );
  }

  if (!data || !data.ok) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="修改收货信息" />
        <ErrorState
          title="订单加载失败"
          description={data?.ok === false ? data.error.displayMessage ?? '请重试' : '请重试'}
          onAction={refetch}
        />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }} keyboardAvoiding>
      <AppHeader title="修改收货信息" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: bottomPadding }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.notice, { backgroundColor: colors.gold.light, borderColor: colors.gold.primary, borderRadius: radius.md }]}>
          <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>发货前修改当前订单</Text>
          <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
            保存后只更新这笔订单的收货信息，不会同步修改地址簿。
          </Text>
        </View>

        {[
          { key: 'recipientName', label: '收货人', placeholder: '请输入姓名' },
          { key: 'phone', label: '手机号', placeholder: '请输入11位手机号', keyboardType: 'phone-pad' as const },
        ].map((field) => (
          <View key={field.key} style={{ marginBottom: spacing.lg }}>
            <Text style={[typography.bodyStrong, { color: colors.text.primary, marginBottom: 6 }]}>
              {field.label}
            </Text>
            <TextInput
              value={(form as any)[field.key]}
              onChangeText={(value) => setForm({ ...form, [field.key]: value })}
              placeholder={field.placeholder}
              placeholderTextColor={colors.muted}
              keyboardType={(field as any).keyboardType}
              style={[
                styles.input,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  color: colors.text.primary,
                  ...typography.body,
                },
              ]}
            />
          </View>
        ))}

        <View style={{ marginBottom: spacing.lg }}>
          <Text style={[typography.bodyStrong, { color: colors.text.primary, marginBottom: 6 }]}>
            所在地区
          </Text>
          <RegionPicker value={form.region} onChange={(region) => setForm({ ...form, region })} />
        </View>

        <View style={{ marginBottom: spacing.xl }}>
          <Text style={[typography.bodyStrong, { color: colors.text.primary, marginBottom: 6 }]}>
            详细地址
          </Text>
          <TextInput
            value={form.detail}
            onChangeText={(value) => setForm({ ...form, detail: value })}
            placeholder="街道/小区/门牌号"
            placeholderTextColor={colors.muted}
            style={[
              styles.input,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radius.md,
                color: colors.text.primary,
                ...typography.body,
              },
            ]}
          />
        </View>

        <Pressable onPress={handleSave} disabled={submitting}>
          <LinearGradient
            colors={submitting ? [colors.border, colors.border] : [colors.brand.primary, colors.ai.start]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.saveButton, { borderRadius: radius.pill }]}
          >
            <Text style={[typography.bodyStrong, { color: submitting ? colors.text.secondary : colors.text.inverse }]}>
              {submitting ? '保存中...' : '保存修改'}
            </Text>
          </LinearGradient>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  notice: {
    borderWidth: 1,
    marginBottom: 18,
    padding: 12,
  },
  input: {
    borderWidth: 1,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  saveButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
});
