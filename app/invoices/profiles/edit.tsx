import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { AppHeader, Screen } from '../../../src/components/layout';
import { Skeleton, useToast } from '../../../src/components/feedback';
import { InvoiceRepo } from '../../../src/repos';
import { useAuthStore } from '../../../src/store';
import { useTheme } from '../../../src/theme';
import { InvoiceType } from '../../../src/types';

// 手机号正则（与后端 DTO 一致）
const phoneRegex = /^1\d{10}$/;

// 个人发票验证
const personalSchema = z.object({
  type: z.literal('PERSONAL'),
  title: z.string().min(2, '请输入至少2个字').max(100, '抬头名称不超过100字'),
  email: z.string().email('邮箱格式不正确').optional().or(z.literal('')),
  phone: z.string().regex(phoneRegex, '请输入11位手机号').optional().or(z.literal('')),
  taxNo: z.string().optional(),
  bankName: z.string().optional(),
  accountNo: z.string().optional(),
  address: z.string().optional(),
});

// 企业发票验证
const companySchema = z.object({
  type: z.literal('COMPANY'),
  title: z.string().min(2, '请输入至少2个字').max(100, '公司名称不超过100字'),
  taxNo: z.string().regex(/^[A-Z0-9]{15,20}$/, '税号为15-20位大写字母或数字'),
  email: z.string().email('邮箱格式不正确').optional().or(z.literal('')),
  phone: z.string().regex(phoneRegex, '请输入11位手机号').optional().or(z.literal('')),
  bankName: z.string().optional().or(z.literal('')),
  accountNo: z.string().optional().or(z.literal('')),
  address: z.string().optional().or(z.literal('')),
});

// 联合 schema
const formSchema = z.discriminatedUnion('type', [personalSchema, companySchema]);

type FormValues = z.infer<typeof formSchema>;

export default function InvoiceProfileEditScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string }>();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const isEdit = !!params.id;

  const [invoiceType, setInvoiceType] = useState<InvoiceType>('PERSONAL');

  const { control, handleSubmit, reset, setValue, formState, watch } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      type: 'PERSONAL',
      title: '',
      email: '',
      phone: '',
    },
  });

  // 编辑模式：加载现有抬头
  const { data: profilesData, isLoading } = useQuery({
    queryKey: ['invoice-profiles'],
    queryFn: () => InvoiceRepo.getProfiles(),
    enabled: isLoggedIn && isEdit,
  });

  // 编辑模式回填
  useEffect(() => {
    if (!isEdit || !profilesData?.ok) return;
    const profile = profilesData.data.find((p) => p.id === params.id);
    if (!profile) return;

    setInvoiceType(profile.type);
    reset({
      type: profile.type,
      title: profile.title,
      taxNo: profile.taxNo ?? '',
      email: profile.email ?? '',
      phone: profile.phone ?? '',
      bankName: profile.bankInfo?.bankName ?? '',
      accountNo: profile.bankInfo?.accountNo ?? '',
      address: profile.address ?? '',
    } as FormValues);
  }, [profilesData, params.id, isEdit, reset]);

  // 切换类型时更新 form
  const handleTypeChange = (type: InvoiceType) => {
    setInvoiceType(type);
    const currentValues = watch();
    reset({
      ...currentValues,
      type,
      taxNo: type === 'COMPANY' ? (currentValues.taxNo ?? '') : undefined,
    } as FormValues);
  };

  // 提交
  const handleSave = async (values: FormValues) => {
    const payload = {
      type: values.type,
      title: values.title.trim(),
      taxNo: values.taxNo?.trim() || undefined,
      email: values.email?.trim() || undefined,
      phone: values.phone?.trim() || undefined,
      bankInfo: values.bankName?.trim() && values.accountNo?.trim()
        ? { bankName: values.bankName.trim(), accountNo: values.accountNo.trim() }
        : undefined,
      address: values.address?.trim() || undefined,
    };

    const result = isEdit
      ? await InvoiceRepo.updateProfile(params.id!, payload)
      : await InvoiceRepo.createProfile(payload);

    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '保存失败', type: 'error' });
      return;
    }

    show({ message: isEdit ? '抬头已更新' : '抬头已创建', type: 'success' });
    await queryClient.invalidateQueries({ queryKey: ['invoice-profiles'] });
    router.back();
  };

  // 渲染表单字段
  const renderField = (
    name: keyof FormValues,
    label: string,
    placeholder: string,
    options?: { required?: boolean; multiline?: boolean; keyboardType?: 'default' | 'email-address' | 'phone-pad' },
  ) => (
    <View style={styles.field}>
      <Text style={[typography.caption, { color: colors.text.secondary }]}>
        {label}{options?.required ? ' *' : ''}
      </Text>
      <Controller
        control={control}
        name={name}
        render={({ field: { value, onChange } }) => (
          <TextInput
            value={value as string ?? ''}
            onChangeText={onChange}
            placeholder={placeholder}
            placeholderTextColor={colors.text.tertiary}
            multiline={options?.multiline}
            keyboardType={options?.keyboardType}
            style={[
              styles.input,
              {
                borderColor: colors.border,
                color: colors.text.primary,
                backgroundColor: colors.surface,
                borderRadius: radius.md,
              },
              options?.multiline ? { minHeight: 60, textAlignVertical: 'top' } : {},
            ]}
          />
        )}
      />
      {(formState.errors as any)[name] ? (
        <Text style={[typography.caption, { color: colors.danger, marginTop: 2 }]}>
          {(formState.errors as any)[name]?.message}
        </Text>
      ) : null}
    </View>
  );

  if (isEdit && isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="编辑抬头" />
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={300} radius={radius.lg} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }} keyboardAvoiding>
      <AppHeader title={isEdit ? '编辑抬头' : '新建抬头'} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* 类型切换 */}
        <View style={[styles.card, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
          <Text style={[typography.bodySm, { color: colors.text.primary, marginBottom: 10 }]}>发票类型</Text>
          <View style={styles.typeRow}>
            <Pressable
              onPress={() => handleTypeChange('PERSONAL')}
              style={[
                styles.typeBtn,
                {
                  borderRadius: radius.pill,
                  borderColor: invoiceType === 'PERSONAL' ? colors.brand.primary : colors.border,
                  borderWidth: 1,
                  backgroundColor: invoiceType === 'PERSONAL' ? colors.brand.primarySoft : colors.surface,
                },
              ]}
            >
              <Text style={[
                typography.bodySm,
                { color: invoiceType === 'PERSONAL' ? colors.brand.primary : colors.text.secondary },
              ]}>
                个人
              </Text>
            </Pressable>
            <Pressable
              onPress={() => handleTypeChange('COMPANY')}
              style={[
                styles.typeBtn,
                {
                  borderRadius: radius.pill,
                  borderColor: invoiceType === 'COMPANY' ? colors.accent.blue : colors.border,
                  borderWidth: 1,
                  backgroundColor: invoiceType === 'COMPANY' ? colors.accent.blueSoft : colors.surface,
                  marginLeft: 10,
                },
              ]}
            >
              <Text style={[
                typography.bodySm,
                { color: invoiceType === 'COMPANY' ? colors.accent.blue : colors.text.secondary },
              ]}>
                企业
              </Text>
            </Pressable>
          </View>
        </View>

        {/* 基本信息 */}
        <View style={[styles.card, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }]}>
          <Text style={[typography.bodySm, { color: colors.text.primary, marginBottom: 10 }]}>基本信息</Text>

          {renderField('title', invoiceType === 'PERSONAL' ? '抬头名称' : '公司名称', invoiceType === 'PERSONAL' ? '请输入个人姓名' : '请输入公司全称', { required: true })}

          {invoiceType === 'COMPANY' ? (
            renderField('taxNo' as keyof FormValues, '纳税人识别号', '请输入15-20位税号', { required: true })
          ) : null}

          {renderField('email' as keyof FormValues, '收票邮箱', '请输入接收发票的邮箱', { keyboardType: 'email-address' })}
          {renderField('phone' as keyof FormValues, '联系电话', '请输入联系电话', { keyboardType: 'phone-pad' })}
        </View>

        {/* 企业额外信息 */}
        {invoiceType === 'COMPANY' ? (
          <View style={[styles.card, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg }]}>
            <Text style={[typography.bodySm, { color: colors.text.primary, marginBottom: 10 }]}>开票信息（选填）</Text>
            {renderField('bankName' as keyof FormValues, '开户银行', '请输入开户银行名称')}
            {renderField('accountNo' as keyof FormValues, '银行账号', '请输入银行账号')}
            {renderField('address' as keyof FormValues, '注册地址', '请输入公司注册地址')}
          </View>
        ) : null}

        {/* 保存按钮 */}
        <Pressable
          onPress={handleSubmit(handleSave)}
          disabled={formState.isSubmitting}
          style={{ marginTop: spacing.xl }}
        >
          <LinearGradient
            colors={formState.isSubmitting ? [colors.border, colors.border] : [colors.brand.primary, colors.ai.start]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.submitBtn, { borderRadius: radius.pill }]}
          >
            <Text style={[typography.bodyStrong, { color: formState.isSubmitting ? colors.text.secondary : colors.text.inverse }]}>
              {formState.isSubmitting ? '保存中...' : '保存'}
            </Text>
          </LinearGradient>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
  },
  typeRow: {
    flexDirection: 'row',
  },
  typeBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    alignItems: 'center',
  },
  field: {
    marginBottom: 14,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
  },
  submitBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
});
