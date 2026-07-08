import React, { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { AppHeader, Screen } from '../../src/components/layout';
import { ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { CaptainRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { compactActionTextProps, useTheme } from '../../src/theme';
import type { CaptainApplication, SubmitCaptainApplicationInput } from '../../src/types';

const communityOptions = [
  { value: 'NONE', label: '暂无社群' },
  { value: 'UNDER_50', label: '50人以下' },
  { value: 'BETWEEN_50_200', label: '50-200人' },
  { value: 'BETWEEN_200_500', label: '200-500人' },
  { value: 'OVER_500', label: '500人以上' },
];

const gmvOptions = [
  { value: 'UNDER_3000', label: '3000以下' },
  { value: 'BETWEEN_3000_10000', label: '3000-1万' },
  { value: 'BETWEEN_10000_30000', label: '1万-3万' },
  { value: 'OVER_30000', label: '3万以上' },
];

const resourceOptions = [
  { value: 'MOMENTS', label: '朋友圈' },
  { value: 'WECHAT_GROUP', label: '微信群' },
  { value: 'VIDEO_ACCOUNT', label: '视频号' },
  { value: 'COMMUNITY', label: '线下社区' },
  { value: 'RESTAURANT', label: '餐饮店' },
  { value: 'COMPANY_GROUP_BUY', label: '企业团购' },
  { value: 'FRIENDS_FAMILY', label: '亲友圈' },
  { value: 'OTHER', label: '其他' },
];

const experienceOptions = [
  { value: 'NONE', label: '无经验' },
  { value: 'BUYER', label: '买过' },
  { value: 'SOLD_BEFORE', label: '卖过' },
  { value: 'SUPPLY_CHAIN_OR_GROUP_BUY', label: '供应链/团购经验' },
];

const applicationSchema = z.object({
  realName: z.string().trim().min(2, '请填写真实姓名').max(40, '姓名过长'),
  contact: z.string().trim().min(3, '请填写微信或手机号').max(80, '联系方式过长'),
  city: z.string().trim().min(2, '请填写所在城市或经营区域').max(80, '区域过长'),
  communityScale: z.string().min(1, '请选择社群规模'),
  expectedMonthlyGmv: z.string().min(1, '请选择预计月销售能力'),
  resourceTypes: z.array(z.string()).min(1, '请选择至少一种资源').max(8, '资源类型过多'),
  promotionPlan: z.string().trim().min(10, '请简要说明推广计划').max(500, '推广计划不超过 500 字'),
  seafoodExperience: z.string().min(1, '请选择预包装海鲜经验'),
  complianceAccepted: z.boolean().refine((value) => value, '请确认合规承诺'),
});

type ApplicationFormValues = z.infer<typeof applicationSchema>;

const emptyValues: ApplicationFormValues = {
  realName: '',
  contact: '',
  city: '',
  communityScale: '',
  expectedMonthlyGmv: '',
  resourceTypes: [],
  promotionPlan: '',
  seafoodExperience: '',
  complianceAccepted: false,
};

export default function CaptainApplicationPage() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { show } = useToast();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);

  const applicationQuery = useQuery({
    queryKey: ['captain-application-me'],
    queryFn: () => CaptainRepo.getMyApplication(),
    enabled: isLoggedIn,
  });

  const result = applicationQuery.data;
  const statusData = result?.ok ? result.data : null;
  const loadError = result && !result.ok ? result.error : null;
  const application = statusData?.application ?? null;

  const { control, handleSubmit, reset, formState } = useForm<ApplicationFormValues>({
    resolver: zodResolver(applicationSchema),
    defaultValues: emptyValues,
  });

  useEffect(() => {
    if (application?.status === 'REJECTED') {
      reset({
        realName: application.realName,
        contact: application.contact,
        city: application.city,
        communityScale: application.communityScale,
        expectedMonthlyGmv: application.expectedMonthlyGmv,
        resourceTypes: application.resourceTypes ?? [],
        promotionPlan: application.promotionPlan,
        seafoodExperience: application.seafoodExperience,
        complianceAccepted: application.complianceAccepted,
      });
    }
  }, [application, reset]);

  const submitMutation = useMutation({
    mutationFn: async (values: SubmitCaptainApplicationInput) => {
      const submitResult = await CaptainRepo.submitApplication(values);
      if (!submitResult.ok) throw submitResult.error;
      return submitResult.data;
    },
    onSuccess: async () => {
      show({ message: '申请已提交', type: 'success' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['captain-application-me'] }),
        queryClient.invalidateQueries({ queryKey: ['captain-me'] }),
      ]);
    },
    onError: (error: unknown) => {
      show({ message: (error as any)?.displayMessage ?? '提交失败，请稍后重试', type: 'error' });
    },
  });

  const onSubmit = (values: ApplicationFormValues) => {
    submitMutation.mutate({
      ...values,
      realName: values.realName.trim(),
      contact: values.contact.trim(),
      city: values.city.trim(),
      promotionPlan: values.promotionPlan.trim(),
    });
  };

  if (!isLoggedIn) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="申请团长" />
        <View style={{ padding: spacing.xl }}>
          <ErrorState title="请先登录" description="登录后可以提交团长申请" />
        </View>
      </Screen>
    );
  }

  if (applicationQuery.isLoading) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="申请团长" />
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={160} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={360} radius={radius.lg} />
        </View>
      </Screen>
    );
  }

  if (loadError) {
    return (
      <Screen contentStyle={{ flex: 1 }}>
        <AppHeader title="申请团长" />
        <View style={{ padding: spacing.xl }}>
          <ErrorState
            title="申请状态加载失败"
            description={(loadError as any)?.displayMessage ?? '请稍后重试'}
            onAction={() => applicationQuery.refetch()}
          />
        </View>
      </Screen>
    );
  }

  if (statusData?.isCaptain) {
    return (
      <StatusLayout
        title="团长已开通"
        description="当前账号已经是有效团长，可以进入团长经营中心查看经营奖励和订单进度。"
        actionLabel="进入团长经营"
        icon="storefront-outline"
        onAction={() => router.push('/me/captain')}
      />
    );
  }

  if (application?.status === 'PENDING') {
    return (
      <StatusLayout
        title="申请审核中"
        description={`提交时间：${formatDate(application.createdAt)}。平台会结合你的申请内容和历史成交情况审核。`}
        icon="clock-outline"
        actionLabel="刷新状态"
        onAction={() => applicationQuery.refetch()}
        application={application}
      />
    );
  }

  if (application?.status === 'APPROVED') {
    return (
      <StatusLayout
        title="申请已通过"
        description="团长资料已开通，可以进入团长经营中心查看团长码和经营数据。"
        icon="check-circle-outline"
        actionLabel="进入团长经营"
        onAction={() => router.push('/me/captain')}
      />
    );
  }

  return (
    <Screen contentStyle={{ flex: 1 }} keyboardAvoiding>
      <AppHeader title="申请团长" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {application?.status === 'REJECTED' ? (
          <View style={[styles.notice, { backgroundColor: colors.background, borderRadius: radius.lg }]}>
            <MaterialCommunityIcons name="alert-circle-outline" size={20} color={colors.danger} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={[typography.bodyStrong, { color: colors.danger }]}>申请未通过</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                {application.rejectReason || '请补充资料后重新提交'}
              </Text>
            </View>
          </View>
        ) : null}

        <View style={[styles.card, { backgroundColor: colors.surface, borderRadius: radius.lg }, shadow.sm]}>
          <Text style={[typography.headingSm, { color: colors.text.primary }]}>基础信息</Text>
          <ControlledInput
            control={control}
            name="realName"
            label="真实姓名"
            placeholder="用于平台审核"
            error={formState.errors.realName?.message}
          />
          <ControlledInput
            control={control}
            name="contact"
            label="联系微信或手机号"
            placeholder="方便平台联系你"
            error={formState.errors.contact?.message}
          />
          <ControlledInput
            control={control}
            name="city"
            label="所在城市 / 经营区域"
            placeholder="例如：杭州滨江"
            error={formState.errors.city?.message}
          />
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderRadius: radius.lg }, shadow.sm]}>
          <Text style={[typography.headingSm, { color: colors.text.primary }]}>经营能力</Text>
          <ChoiceGroup
            control={control}
            name="communityScale"
            label="社群规模"
            options={communityOptions}
            error={formState.errors.communityScale?.message}
          />
          <ChoiceGroup
            control={control}
            name="expectedMonthlyGmv"
            label="预计月销售能力"
            options={gmvOptions}
            error={formState.errors.expectedMonthlyGmv?.message}
          />
          <MultiChoiceGroup
            control={control}
            name="resourceTypes"
            label="资源类型"
            options={resourceOptions}
            error={formState.errors.resourceTypes?.message}
          />
          <ChoiceGroup
            control={control}
            name="seafoodExperience"
            label="预包装海鲜经验"
            options={experienceOptions}
            error={formState.errors.seafoodExperience?.message}
          />
          <ControlledInput
            control={control}
            name="promotionPlan"
            label="推广计划"
            placeholder="说明你准备如何做真实成交和复购"
            multiline
            error={formState.errors.promotionPlan?.message}
          />
        </View>

        <Controller
          control={control}
          name="complianceAccepted"
          render={({ field: { value, onChange } }) => (
            <Pressable
              onPress={() => onChange(!value)}
              style={[styles.checkRow, { backgroundColor: colors.surface, borderRadius: radius.lg }, shadow.sm]}
            >
              <MaterialCommunityIcons
                name={value ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
                size={22}
                color={value ? colors.brand.primary : colors.text.secondary}
              />
              <Text style={[typography.caption, { color: colors.text.secondary, flex: 1, marginLeft: 10 }]}>
                我承诺不收入门费、不要求囤货、不承诺固定收益，收益来自真实商品成交，并接受月度考核和售后冲回。
              </Text>
            </Pressable>
          )}
        />
        {formState.errors.complianceAccepted ? (
          <Text style={[typography.caption, { color: colors.danger, marginTop: 6 }]}>
            {formState.errors.complianceAccepted.message}
          </Text>
        ) : null}

        <Pressable
          disabled={submitMutation.isPending}
          onPress={handleSubmit(onSubmit)}
          style={({ pressed }) => [
            styles.submitButton,
            {
              backgroundColor: submitMutation.isPending ? colors.muted : colors.brand.primary,
              borderRadius: radius.pill,
              opacity: pressed ? 0.84 : 1,
            },
          ]}
        >
          <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: colors.text.inverse }]}>
            {submitMutation.isPending ? '提交中' : '提交申请'}
          </Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

function StatusLayout({
  title,
  description,
  icon,
  actionLabel,
  onAction,
  application,
}: {
  title: string;
  description: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  actionLabel: string;
  onAction: () => void;
  application?: CaptainApplication | null;
}) {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="申请团长" />
      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}>
        <View style={[styles.statusCard, { backgroundColor: colors.surface, borderRadius: radius.xl }, shadow.sm]}>
          <MaterialCommunityIcons name={icon} size={42} color={colors.brand.primary} />
          <Text style={[typography.headingSm, { color: colors.text.primary, marginTop: 14 }]}>{title}</Text>
          <Text style={[typography.bodySm, { color: colors.text.secondary, textAlign: 'center', marginTop: 8 }]}>
            {description}
          </Text>
          {application ? (
            <View style={[styles.summary, { borderColor: colors.border }]}>
              <SummaryRow label="申请人" value={application.realName} />
              <SummaryRow label="所在区域" value={application.city} />
              <SummaryRow label="联系方式" value={application.contact} />
            </View>
          ) : null}
          <Pressable
            onPress={onAction}
            style={({ pressed }) => [
              styles.statusButton,
              { backgroundColor: colors.brand.primary, borderRadius: radius.pill, opacity: pressed ? 0.84 : 1 },
            ]}
          >
            <Text {...compactActionTextProps} style={[typography.bodyStrong, { color: colors.text.inverse }]}>
              {actionLabel}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const { colors, typography } = useTheme();
  return (
    <View style={styles.summaryRow}>
      <Text style={[typography.caption, { color: colors.text.secondary }]}>{label}</Text>
      <Text style={[typography.bodyStrong, { color: colors.text.primary }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function ControlledInput({
  control,
  name,
  label,
  placeholder,
  multiline,
  error,
}: {
  control: any;
  name: keyof ApplicationFormValues;
  label: string;
  placeholder: string;
  multiline?: boolean;
  error?: string;
}) {
  const { colors, radius, typography } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[typography.caption, { color: colors.text.secondary }]}>{label}</Text>
      <Controller
        control={control}
        name={name}
        render={({ field: { value, onChange } }) => (
          <TextInput
            value={String(value ?? '')}
            onChangeText={onChange}
            placeholder={placeholder}
            placeholderTextColor={colors.text.secondary}
            multiline={multiline}
            textAlignVertical={multiline ? 'top' : 'center'}
            style={[
              styles.input,
              multiline && styles.textarea,
              {
                borderColor: error ? colors.danger : colors.border,
                borderRadius: radius.md,
                color: colors.text.primary,
                backgroundColor: colors.background,
              },
              typography.body,
            ]}
          />
        )}
      />
      {error ? <Text style={[typography.caption, { color: colors.danger, marginTop: 4 }]}>{error}</Text> : null}
    </View>
  );
}

function ChoiceGroup({
  control,
  name,
  label,
  options,
  error,
}: {
  control: any;
  name: keyof ApplicationFormValues;
  label: string;
  options: Array<{ value: string; label: string }>;
  error?: string;
}) {
  const { colors, radius, typography } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[typography.caption, { color: colors.text.secondary }]}>{label}</Text>
      <Controller
        control={control}
        name={name}
        render={({ field: { value, onChange } }) => (
          <View style={styles.optionWrap}>
            {options.map((option) => {
              const selected = value === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => onChange(option.value)}
                  style={[
                    styles.option,
                    {
                      borderRadius: radius.pill,
                      borderColor: selected ? colors.brand.primary : colors.border,
                      backgroundColor: selected ? colors.brand.primarySoft : colors.background,
                    },
                  ]}
                >
                  <Text style={[typography.caption, { color: selected ? colors.brand.primary : colors.text.secondary }]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      />
      {error ? <Text style={[typography.caption, { color: colors.danger, marginTop: 4 }]}>{error}</Text> : null}
    </View>
  );
}

function MultiChoiceGroup({
  control,
  name,
  label,
  options,
  error,
}: {
  control: any;
  name: keyof ApplicationFormValues;
  label: string;
  options: Array<{ value: string; label: string }>;
  error?: string;
}) {
  const { colors, radius, typography } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[typography.caption, { color: colors.text.secondary }]}>{label}</Text>
      <Controller
        control={control}
        name={name}
        render={({ field: { value, onChange } }) => {
          const selectedValues = Array.isArray(value) ? value : [];
          return (
            <View style={styles.optionWrap}>
              {options.map((option) => {
                const selected = selectedValues.includes(option.value);
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => {
                      onChange(
                        selected
                          ? selectedValues.filter((item) => item !== option.value)
                          : [...selectedValues, option.value],
                      );
                    }}
                    style={[
                      styles.option,
                      {
                        borderRadius: radius.pill,
                        borderColor: selected ? colors.brand.primary : colors.border,
                        backgroundColor: selected ? colors.brand.primarySoft : colors.background,
                      },
                    ]}
                  >
                    <Text style={[typography.caption, { color: selected ? colors.brand.primary : colors.text.secondary }]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          );
        }}
      />
      {error ? <Text style={[typography.caption, { color: colors.danger, marginTop: 4 }]}>{error}</Text> : null}
    </View>
  );
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    marginBottom: 14,
  },
  field: {
    marginTop: 14,
  },
  input: {
    minHeight: 44,
    marginTop: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  textarea: {
    minHeight: 108,
    paddingTop: 12,
  },
  optionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  option: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    marginBottom: 14,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
  },
  submitButton: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  statusCard: {
    alignItems: 'center',
    padding: 24,
  },
  statusButton: {
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    marginTop: 18,
  },
  summary: {
    alignSelf: 'stretch',
    borderTopWidth: 1,
    marginTop: 18,
    paddingTop: 14,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
  },
});
