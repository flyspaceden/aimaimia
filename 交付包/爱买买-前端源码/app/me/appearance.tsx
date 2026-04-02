import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { AvatarFrame, Tag } from '../../src/components/ui';
import { UserRepo } from '../../src/repos';
import { useTheme } from '../../src/theme';
import { AvatarFrame as AvatarFrameType } from '../../src/types';

type FrameOption = {
  id: string;
  label: string;
  frame: AvatarFrameType | null;
  hint: string;
};

export default function MeAppearanceScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedFrameId, setSelectedFrameId] = useState<string>('default');
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['me-appearance-profile'],
    queryFn: () => UserRepo.profile(),
  });

  const profile = data?.ok ? data.data : null;
  const error = data && !data.ok ? data.error : null;

  const options = useMemo<FrameOption[]>(
    () => [
      { id: 'default', label: '默认', frame: null, hint: '所有用户可用' },
      {
        id: 'vip',
        label: 'VIP 动态框',
        frame: { id: 'frame-vip', type: 'vip', label: 'VIP', expiresAt: undefined },
        hint: '会员专属（占位）',
      },
      {
        id: 'task',
        label: '任务奖励框',
        frame: { id: 'frame-task', type: 'task', label: '任务', expiresAt: '2026-12-31' },
        hint: '完成任务解锁（占位）',
      },
      {
        id: 'limited',
        label: '限时框',
        frame: { id: 'frame-limited', type: 'limited', label: '限时', expiresAt: '2026-06-30' },
        hint: '限时活动/福利（占位）',
      },
    ],
    []
  );
  const avatarOptions = useMemo(
    () => [
      'https://placehold.co/200x200/png?text=Farm',
      'https://placehold.co/200x200/png?text=Leaf',
      'https://placehold.co/200x200/png?text=AI',
      'https://placehold.co/200x200/png?text=Grow',
    ],
    []
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  useEffect(() => {
    if (!profile) {
      return;
    }
    setSelectedAvatar(profile.avatar);
  }, [profile]);

  const selectedOption = options.find((option) => option.id === selectedFrameId) ?? options[0];

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="头像框与装扮" />
      {isLoading ? (
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={160} radius={radius.lg} />
          <View style={{ height: spacing.md }} />
          <Skeleton height={220} radius={radius.lg} />
        </View>
      ) : error ? (
        <View style={{ padding: spacing.xl }}>
          <ErrorState title="加载失败" description={error.displayMessage ?? '请稍后重试'} onAction={refetch} />
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
          <View style={[styles.previewCard, shadow.sm, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <View style={{ alignItems: 'center' }}>
              <AvatarFrame uri={selectedAvatar ?? profile.avatar} size={92} frame={selectedOption.frame} />
              <Text style={[typography.title3, { color: colors.text.primary, marginTop: 10 }]}>{profile.name}</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>
                预览头像框效果（占位）
              </Text>
              {selectedOption.frame?.expiresAt ? (
                <Tag label={`有效期至 ${selectedOption.frame.expiresAt}`} tone="neutral" style={{ marginTop: 10 }} />
              ) : null}
            </View>
          </View>

          <View style={{ marginTop: spacing.lg }}>
            <Text style={[typography.title3, { color: colors.text.primary }]}>选择头像</Text>
            <View style={styles.avatarRow}>
              {avatarOptions.map((avatar) => {
                const active = avatar === selectedAvatar;
                return (
                  <Pressable
                    key={avatar}
                    onPress={() => setSelectedAvatar(avatar)}
                    style={[
                      styles.avatarOption,
                      {
                        borderColor: active ? colors.brand.primary : colors.border,
                        backgroundColor: colors.surface,
                        borderRadius: radius.lg,
                      },
                    ]}
                  >
                    <AvatarFrame uri={avatar} size={54} frame={active ? selectedOption.frame : null} />
                    <Text style={[typography.caption, { color: active ? colors.brand.primary : colors.text.secondary, marginTop: 6 }]}>
                      {active ? '已选' : '选择'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 6 }]}>
              当前为前端占位头像库，后续可接入上传/拍照能力
            </Text>
          </View>

          <View style={{ marginTop: spacing.lg }}>
            <Text style={[typography.title3, { color: colors.text.primary }]}>选择头像框</Text>
            <View style={{ marginTop: spacing.sm }}>
              {options.map((option) => {
                const active = option.id === selectedFrameId;
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => setSelectedFrameId(option.id)}
                    style={[
                      styles.optionRow,
                      shadow.sm,
                      {
                        backgroundColor: colors.surface,
                        borderRadius: radius.lg,
                        borderColor: active ? colors.brand.primary : 'transparent',
                      },
                    ]}
                  >
                    <AvatarFrame uri={profile.avatar} size={56} frame={option.frame} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{option.label}</Text>
                      <Text style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}>{option.hint}</Text>
                    </View>
                    {active ? (
                      <Tag label="已选" tone="brand" />
                    ) : (
                      <Text style={[typography.caption, { color: colors.text.secondary }]}>选择</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Pressable
            onPress={async () => {
              // 保存头像与头像框占位（复杂业务逻辑需中文注释）
              const result = await UserRepo.updateProfile({
                avatar: selectedAvatar ?? profile.avatar,
                avatarFrame: selectedOption.frame ?? undefined,
              });
              if (!result.ok) {
                show({ message: result.error.displayMessage ?? '保存失败', type: 'error' });
                return;
              }
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['me-profile'] }),
                queryClient.invalidateQueries({ queryKey: ['me-profile-detail'] }),
                queryClient.invalidateQueries({ queryKey: ['me-appearance-profile'] }),
              ]);
              show({ message: '头像设置已保存', type: 'success' });
            }}
            style={[styles.saveButton, { backgroundColor: colors.brand.primary, borderRadius: radius.pill }]}
          >
            <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>保存（占位）</Text>
          </Pressable>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  previewCard: {
    padding: 18,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  avatarRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  avatarOption: {
    borderWidth: 1,
    padding: 10,
    alignItems: 'center',
    marginRight: 10,
    marginBottom: 10,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  saveButton: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
});
