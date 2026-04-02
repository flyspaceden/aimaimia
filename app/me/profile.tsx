import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { AvatarFrame, Tag } from '../../src/components/ui';
import { UserRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { AppError, UserProfile } from '../../src/types';

const profileSchema = z.object({
  name: z.string().min(2, '昵称至少 2 个字').max(12, '昵称不超过 12 个字'),
  location: z.string().min(2, '请填写所在地').max(20, '所在地不超过 20 个字'),
  interests: z.string().optional(),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

const parseInterests = (value: string) =>
  value
    .split(/[,，、/\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 6);

const formatInterests = (interests?: string[]) => (interests && interests.length > 0 ? interests.join('、') : '');

export default function MeProfileScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['me-profile-detail'],
    queryFn: () => UserRepo.profile(),
    enabled: isLoggedIn,
  });

  const profile = data?.ok ? data.data : null;
  const error = data && !data.ok ? data.error : null;

  const { control, handleSubmit, reset, watch, formState } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: '',
      location: '',
      interests: '',
    },
  });

  useEffect(() => {
    if (!profile) {
      return;
    }
    reset({
      name: profile.name,
      location: profile.location,
      interests: formatInterests(profile.interests),
    });
  }, [profile, reset]);

  const watchedInterests = watch('interests') ?? '';
  const interestTags = useMemo(() => parseInterests(watchedInterests), [watchedInterests]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleReset = (dataToReset: UserProfile) => {
    reset({
      name: dataToReset.name,
      location: dataToReset.location,
      interests: formatInterests(dataToReset.interests),
    });
  };

  const handleSave = async (values: ProfileFormValues) => {
    const result = await UserRepo.updateProfile({
      name: values.name.trim(),
      location: values.location.trim(),
      interests: parseInterests(values.interests ?? ''),
    });
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '保存失败', type: 'error' });
      return;
    }
    show({ message: '资料已更新', type: 'success' });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['me-profile'] }),
      queryClient.invalidateQueries({ queryKey: ['me-profile-detail'] }),
      queryClient.invalidateQueries({ queryKey: ['me-vip-profile'] }),
      queryClient.invalidateQueries({ queryKey: ['userProfile'] }),
    ]);
    handleReset(result.data);
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="个人资料" />
      {isLoading ? (
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={160} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={220} radius={radius.lg} />
        </View>
      ) : error ? (
        <View style={{ padding: spacing.xl }}>
          <ErrorState
            title="资料加载失败"
            description={(error as AppError)?.displayMessage ?? '请稍后重试'}
            onAction={refetch}
          />
        </View>
      ) : !profile ? (
        <View style={{ padding: spacing.xl }}>
          <EmptyState title="暂无资料" description="请稍后再试" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        >
          {/* 头像区域 */}
          <Animated.View entering={FadeInDown.duration(300)}>
            <View style={[styles.card, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
              <View style={styles.row}>
                <Pressable onPress={() => router.push('/me/appearance')}>
                  <AvatarFrame uri={profile.avatar} size={72} frame={profile.avatarFrame} />
                </Pressable>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[typography.title3, { color: colors.text.primary }]}>{profile.name}</Text>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>{profile.location}</Text>
                  <View style={styles.tagRow}>
                    {(profile.interests ?? []).slice(0, 3).map((tag) => (
                      <Tag key={tag} label={tag} tone="neutral" style={{ marginRight: 6, marginTop: 6 }} />
                    ))}
                  </View>
                </View>
                <Pressable
                  onPress={() => router.push('/me/appearance')}
                  style={[styles.action, { borderColor: colors.border, borderRadius: radius.pill }]}
                >
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>装扮</Text>
                </Pressable>
              </View>
            </View>
          </Animated.View>

          {/* 偏好与信息 */}
          <Animated.View entering={FadeInDown.duration(300).delay(80)}>
            <View style={{ marginTop: spacing.lg }}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>偏好与信息</Text>
              <View style={[styles.card, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
                <View style={styles.field}>
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>昵称</Text>
                  <Controller
                    control={control}
                    name="name"
                    render={({ field: { value, onChange } }) => (
                      <TextInput
                        value={value}
                        onChangeText={onChange}
                        placeholder="请输入昵称"
                        placeholderTextColor={colors.text.secondary}
                        style={[styles.input, { borderColor: colors.border, color: colors.text.primary, backgroundColor: colors.surface }]}
                      />
                    )}
                  />
                  {formState.errors.name ? (
                    <Text style={[typography.caption, { color: colors.danger }]}>
                      {formState.errors.name.message}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.field}>
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>所在地</Text>
                  <Controller
                    control={control}
                    name="location"
                    render={({ field: { value, onChange } }) => (
                      <TextInput
                        value={value}
                        onChangeText={onChange}
                        placeholder="例如：上海"
                        placeholderTextColor={colors.text.secondary}
                        style={[styles.input, { borderColor: colors.border, color: colors.text.primary, backgroundColor: colors.surface }]}
                      />
                    )}
                  />
                  {formState.errors.location ? (
                    <Text style={[typography.caption, { color: colors.danger }]}>
                      {formState.errors.location.message}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.field}>
                  <Text style={[typography.caption, { color: colors.text.secondary }]}>兴趣标签</Text>
                  <Controller
                    control={control}
                    name="interests"
                    render={({ field: { value, onChange } }) => (
                      <TextInput
                        value={value}
                        onChangeText={onChange}
                        placeholder="用逗号分隔，例如：有机蔬菜、蓝莓"
                        placeholderTextColor={colors.text.secondary}
                        style={[styles.input, { borderColor: colors.border, color: colors.text.primary, backgroundColor: colors.surface }]}
                      />
                    )}
                  />
                  {/* 兴趣标签 — 选中态微渐变 */}
                  <View style={styles.tagRow}>
                    {interestTags.map((tag) => (
                      <View key={tag} style={[styles.interestTag, { overflow: 'hidden', borderRadius: radius.pill }]}>
                        <LinearGradient
                          colors={[colors.brand.primarySoft, colors.ai.soft]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={{ paddingHorizontal: 10, paddingVertical: 4 }}
                        >
                          <Text style={[typography.caption, { color: colors.brand.primary }]}>{tag}</Text>
                        </LinearGradient>
                      </View>
                    ))}
                  </View>
                  <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                    最多展示 6 个标签
                  </Text>
                </View>

                {/* 保存按钮 */}
                <Pressable
                  onPress={handleSubmit(handleSave)}
                  disabled={!formState.isDirty || formState.isSubmitting}
                >
                  <LinearGradient
                    colors={!formState.isDirty ? [colors.border, colors.border] : [colors.brand.primary, colors.ai.start]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.primary, { borderRadius: radius.pill, marginTop: 14 }]}
                  >
                    <Text
                      style={[
                        typography.bodyStrong,
                        { color: !formState.isDirty ? colors.text.secondary : colors.text.inverse },
                      ]}
                    >
                      保存修改
                    </Text>
                  </LinearGradient>
                </Pressable>
                <Pressable
                  onPress={() => handleReset(profile)}
                  style={[styles.secondary, { borderColor: colors.border, borderRadius: radius.pill }]}
                >
                  <Text style={[typography.bodyStrong, { color: colors.text.secondary }]}>重置</Text>
                </Pressable>
              </View>
            </View>
          </Animated.View>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  interestTag: {
    marginRight: 6,
    marginTop: 6,
  },
  action: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  field: {
    marginBottom: 14,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
  },
  primary: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  secondary: {
    marginTop: 10,
    alignItems: 'center',
    paddingVertical: 10,
    borderWidth: 1,
  },
});
