import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { useToast } from '../../src/components/feedback/Toast';
import { RegionPicker, RegionValue } from '../../src/components/forms/RegionPicker';
import { DeliveryUnitFieldConfig, DeliveryUnitRepo } from '../../src/repos/delivery';
import { useDeliveryAuthStore } from '../../src/store';
import { mapRegionValueToDeliveryUnitFields } from '../../src/utils/deliveryRegion';
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
  provinceCode: string;
  provinceName: string;
  cityCode: string;
  cityName: string;
  districtCode: string;
  districtName: string;
  detailAddress: string;
  extraFields: Record<string, string>;
};

const emptyForm: FormState = {
  name: '',
  contactName: '',
  contactPhone: '',
  provinceCode: '',
  provinceName: '',
  cityCode: '',
  cityName: '',
  districtCode: '',
  districtName: '',
  detailAddress: '',
  extraFields: {},
};

const FIXED_FIELD_KEYS = new Set(['name', 'contactName', 'contactPhone', 'region', 'detailAddress']);

const getSelectOptions = (field: DeliveryUnitFieldConfig): Array<{ label: string; value: string }> => {
  if (!Array.isArray(field.options)) return [];
  return field.options
    .map((option) => {
      if (typeof option === 'string') {
        const value = option.trim();
        return value ? { label: value, value } : null;
      }
      if (!option || typeof option !== 'object' || Array.isArray(option)) {
        return null;
      }
      const record = option as Record<string, unknown>;
      const label = typeof record.label === 'string' ? record.label.trim() : '';
      const value = typeof record.value === 'string' ? record.value.trim() : '';
      return label && value ? { label, value } : null;
    })
    .filter((option): option is { label: string; value: string } => Boolean(option));
};

const toRegionValue = (form: FormState): RegionValue | null => {
  if (!form.districtCode || !form.provinceName || !form.cityName || !form.districtName) {
    return null;
  }
  return {
    regionCode: form.districtCode,
    regionText: `${form.provinceName}/${form.cityName}/${form.districtName}`,
  };
};

const filterExtraFieldsForApp = (
  extraFields: Record<string, unknown> | undefined | null,
  dynamicFields: DeliveryUnitFieldConfig[],
): Record<string, string> => {
  const allowedKeys = new Set(dynamicFields.map((field) => field.fieldKey));
  return Object.fromEntries(
    Object.entries(extraFields ?? {})
      .filter(([key]) => allowedKeys.has(key))
      .map(([key, value]) => [key, String(value ?? '')]),
  );
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
  const fieldConfigQuery = useQuery({
    queryKey: ['delivery-unit-field-config'],
    queryFn: () => DeliveryUnitRepo.getFieldConfig(),
  });

  const dynamicFields = React.useMemo(
    () =>
      fieldConfigQuery.data?.ok
        ? fieldConfigQuery.data.data
            .filter((field) => field.isVisible && field.showInApp && !field.isFixed && !FIXED_FIELD_KEYS.has(field.fieldKey))
            .sort((a, b) => a.sortOrder - b.sortOrder || a.fieldKey.localeCompare(b.fieldKey))
        : [],
    [fieldConfigQuery.data],
  );

  React.useEffect(() => {
    if (!unitId || !data?.ok) return;
    const target = data.data.items.find((item) => item.id === unitId);
    if (!target) return;
    setForm({
      name: target.name,
      contactName: target.contactName,
      contactPhone: target.contactPhone,
      provinceCode: target.provinceCode,
      provinceName: target.provinceName,
      cityCode: target.cityCode,
      cityName: target.cityName,
      districtCode: target.districtCode,
      districtName: target.districtName,
      detailAddress: target.detailAddress,
      extraFields: filterExtraFieldsForApp(target.extraFields, dynamicFields),
    });
  }, [data, dynamicFields, unitId]);

  const updateField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };
  const updateExtraField = (key: string, value: string) => {
    setForm((prev) => ({
      ...prev,
      extraFields: {
        ...prev.extraFields,
        [key]: value,
      },
    }));
  };
  const handleRegionChange = (value: RegionValue) => {
    const regionFields = mapRegionValueToDeliveryUnitFields(value);
    setForm((prev) => ({
      ...prev,
      ...regionFields,
    }));
  };

  const handleSubmit = async () => {
    if (
      !form.name.trim() ||
      !form.contactName.trim() ||
      !form.contactPhone.trim() ||
      !form.provinceCode.trim() ||
      !form.provinceName.trim() ||
      !form.cityCode.trim() ||
      !form.cityName.trim() ||
      !form.districtCode.trim() ||
      !form.districtName.trim() ||
      !form.detailAddress.trim()
    ) {
      show({ message: '请把单位信息补完整', type: 'warning' });
      return;
    }
    const missingDynamicField = dynamicFields.find(
      (field) => field.isRequired && !String(form.extraFields[field.fieldKey] ?? '').trim(),
    );
    if (missingDynamicField) {
      show({ message: `请填写${missingDynamicField.label}`, type: 'warning' });
      return;
    }

    const payload = {
      name: form.name.trim(),
      contactName: form.contactName.trim(),
      contactPhone: form.contactPhone.trim(),
      provinceCode: form.provinceCode.trim(),
      provinceName: form.provinceName.trim(),
      cityCode: form.cityCode.trim(),
      cityName: form.cityName.trim(),
      districtCode: form.districtCode.trim(),
      districtName: form.districtName.trim(),
      detailAddress: form.detailAddress.trim(),
      extraFields: Object.fromEntries(
        dynamicFields
          .map((field) => [field.fieldKey, String(form.extraFields[field.fieldKey] ?? '').trim()])
          .filter(([, value]) => value.length > 0),
      ),
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
            <View style={{ marginTop: spacing.lg }}>
              <Text style={[typography.caption, { color: palette.text.secondary, marginBottom: spacing.xs }]}>
                省 / 市 / 区
              </Text>
              <RegionPicker
                value={toRegionValue(form)}
                onChange={handleRegionChange}
                placeholder="请选择省 / 市 / 区"
                colors={palette}
              />
            </View>
            <DeliveryTextField
              label="详细地址"
              value={form.detailAddress}
              onChangeText={(value) => updateField('detailAddress', value)}
              placeholder="街道、楼栋、门牌"
              multiline
              style={{ marginTop: spacing.lg }}
            />
            {dynamicFields.map((field) => {
              const value = form.extraFields[field.fieldKey] ?? '';
              if (field.fieldType === 'SELECT') {
                const options = getSelectOptions(field);
                return (
                  <View key={field.fieldKey} style={{ marginTop: spacing.lg }}>
                    <Text style={[typography.caption, { color: palette.text.secondary, marginBottom: spacing.xs }]}>
                      {field.label}{field.isRequired ? ' *' : ''}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                      {options.map((option) => {
                        const selected = value === option.value;
                        return (
                          <Pressable
                            key={option.value}
                            onPress={() => updateExtraField(field.fieldKey, option.value)}
                            style={{
                              borderWidth: 1,
                              borderColor: selected ? palette.brand.primary : palette.border,
                              borderRadius: 8,
                              paddingHorizontal: spacing.md,
                              paddingVertical: spacing.sm,
                              backgroundColor: selected ? palette.brand.primarySoft : palette.surface,
                            }}
                          >
                            <Text
                              style={[
                                typography.bodySm,
                                { color: selected ? palette.brand.primaryDark : palette.text.primary },
                              ]}
                            >
                              {option.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                );
              }
              return (
                <DeliveryTextField
                  key={field.fieldKey}
                  label={`${field.label}${field.isRequired ? ' *' : ''}`}
                  value={value}
                  onChangeText={(nextValue) => updateExtraField(field.fieldKey, nextValue)}
                  placeholder={field.placeholder || `请输入${field.label}`}
                  keyboardType={field.fieldType === 'NUMBER' ? 'numeric' : 'default'}
                  multiline={field.fieldType === 'TEXTAREA'}
                  style={{ marginTop: spacing.lg }}
                />
              );
            })}
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
