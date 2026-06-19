import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { useToast } from '../../src/components/feedback/Toast';
import { DeliveryUnitRepo } from '../../src/repos/delivery';
import { useDeliveryAuthStore } from '../../src/store';
import {
  DeliveryButton,
  DeliveryLoading,
  DeliveryPanel,
  DeliveryTextField,
  useDeliveryTheme,
} from './_components';

type FormState = {
  name: string;
  contactName: string;
  contactPhone: string;
  provinceName: string;
  cityName: string;
  districtName: string;
  detailAddress: string;
};

const emptyForm: FormState = {
  name: '',
  contactName: '',
  contactPhone: '',
  provinceName: '',
  cityName: '',
  districtName: '',
  detailAddress: '',
};

export default function DeliveryUnitEditScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const unitId = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();
  const { show } = useToast();
  const { palette, spacing, typography } = useDeliveryTheme();
  const currentUnitId = useDeliveryAuthStore((state) => state.currentUnitId);
  const setCurrentUnit = useDeliveryAuthStore((state) => state.setCurrentUnit);
  const [form, setForm] = React.useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['delivery-units', 'edit', unitId],
    queryFn: () => DeliveryUnitRepo.list(),
  });

  React.useEffect(() => {
    if (!unitId || !data?.ok) return;
    const target = data.data.items.find((item) => item.id === unitId);
    if (!target) return;
    setForm({
      name: target.name,
      contactName: target.contactName,
      contactPhone: target.contactPhone,
      provinceName: target.provinceName,
      cityName: target.cityName,
      districtName: target.districtName,
      detailAddress: target.detailAddress,
    });
  }, [data, unitId]);

  const updateField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (
      !form.name.trim() ||
      !form.contactName.trim() ||
      !form.contactPhone.trim() ||
      !form.provinceName.trim() ||
      !form.cityName.trim() ||
      !form.districtName.trim() ||
      !form.detailAddress.trim()
    ) {
      show({ message: '请把单位信息补完整', type: 'warning' });
      return;
    }

    const payload = {
      name: form.name.trim(),
      contactName: form.contactName.trim(),
      contactPhone: form.contactPhone.trim(),
      provinceCode: form.provinceName.trim(),
      provinceName: form.provinceName.trim(),
      cityCode: form.cityName.trim(),
      cityName: form.cityName.trim(),
      districtCode: form.districtName.trim(),
      districtName: form.districtName.trim(),
      detailAddress: form.detailAddress.trim(),
    };

    setSubmitting(true);
    const result = unitId
      ? await DeliveryUnitRepo.update(unitId, payload)
      : await DeliveryUnitRepo.create(payload);
    setSubmitting(false);

    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '保存单位失败', type: 'error' });
      return;
    }

    if (!currentUnitId || currentUnitId === result.data.unit.id || result.data.currentUnitId === result.data.unit.id) {
      setCurrentUnit(result.data.unit);
    }

    router.replace('/delivery/unit-select');
  };

  if (unitId && isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="编辑配送单位" />
        <DeliveryLoading />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title={unitId ? '编辑配送单位' : '新增配送单位'} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ padding: spacing.xl }}>
          <DeliveryPanel>
            <Text style={[typography.headingSm, { color: palette.text.primary }]}>
              单位信息
            </Text>
            <DeliveryTextField
              label="单位名称"
              value={form.name}
              onChangeText={(value) => updateField('name', value)}
              placeholder="例如：华南餐饮部"
              style={{ marginTop: spacing.lg }}
            />
            <DeliveryTextField
              label="联系人"
              value={form.contactName}
              onChangeText={(value) => updateField('contactName', value)}
              placeholder="请输入联系人"
              style={{ marginTop: spacing.lg }}
            />
            <DeliveryTextField
              label="联系电话"
              value={form.contactPhone}
              onChangeText={(value) => updateField('contactPhone', value)}
              keyboardType="phone-pad"
              placeholder="请输入联系电话"
              style={{ marginTop: spacing.lg }}
            />
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
              <View style={{ flex: 1 }}>
                <DeliveryTextField
                  label="省"
                  value={form.provinceName}
                  onChangeText={(value) => updateField('provinceName', value)}
                  placeholder="省"
                />
              </View>
              <View style={{ flex: 1 }}>
                <DeliveryTextField
                  label="市"
                  value={form.cityName}
                  onChangeText={(value) => updateField('cityName', value)}
                  placeholder="市"
                />
              </View>
            </View>
            <DeliveryTextField
              label="区 / 县"
              value={form.districtName}
              onChangeText={(value) => updateField('districtName', value)}
              placeholder="请输入区 / 县"
              style={{ marginTop: spacing.lg }}
            />
            <DeliveryTextField
              label="详细地址"
              value={form.detailAddress}
              onChangeText={(value) => updateField('detailAddress', value)}
              placeholder="街道、楼栋、门牌"
              multiline
              style={{ marginTop: spacing.lg }}
            />
            <DeliveryButton
              label={submitting ? '保存中...' : '保存单位'}
              onPress={handleSubmit}
              disabled={submitting}
              style={{ marginTop: spacing.xl }}
            />
          </DeliveryPanel>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
