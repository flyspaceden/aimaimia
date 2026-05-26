import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { AvatarFrame, DefaultAvatar, PRESET_AVATAR_IDS, PRESET_AVATAR_LABEL, PresetAvatarId, Tag, isPresetUri, parsePresetUri, toPresetUri } from '../../src/components/ui';
import { BonusRepo, UserRepo } from '../../src/repos';
import { useAuthStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { AvatarFrame as AvatarFrameType } from '../../src/types';
import { pickAvatarFromCamera, pickAvatarFromLibrary } from '../../src/lib/avatar/uploadAvatar';

type FrameOption = {
  id: 'default' | 'vip';
  label: string;
  frame: AvatarFrameType | null;
  hint: string;
  requiresVip: boolean;
};

export default function MeAppearanceScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedFrameId, setSelectedFrameId] = useState<FrameOption['id']>('default');
  // 选中头像：preset:// 或 https:// URL
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null);
  const [uploading, setUploading] = useState<null | 'library' | 'camera'>(null);
  const [saving, setSaving] = useState(false);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['me-appearance-profile'],
    queryFn: () => UserRepo.profile(),
    enabled: isLoggedIn,
  });

  // 用 BonusRepo 拿 tier 判定 VIP 框权限
  const { data: memberData } = useQuery({
    queryKey: ['me-appearance-member'],
    queryFn: () => BonusRepo.getMember(),
    enabled: isLoggedIn,
  });

  const profile = data?.ok ? data.data : null;
  const error = data && !data.ok ? data.error : null;
  const isVip = memberData?.ok && memberData.data.tier === 'VIP';

  const frameOptions = useMemo<FrameOption[]>(
    () => [
      { id: 'default', label: '默认', frame: null, hint: '所有用户可用', requiresVip: false },
      {
        id: 'vip',
        label: 'VIP 动态框',
        frame: { id: 'frame-vip', type: 'vip', label: 'VIP' },
        hint: isVip ? '会员专享' : '开通 VIP 解锁',
        requiresVip: true,
      },
    ],
    [isVip]
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetch(), queryClient.invalidateQueries({ queryKey: ['me-appearance-member'] })]);
    setRefreshing(false);
  };

  // 用 profile 初始化已选项
  useEffect(() => {
    if (!profile) return;
    setSelectedAvatar(profile.avatar);
    if (profile.avatarFrame?.type === 'vip') {
      setSelectedFrameId('vip');
    } else {
      setSelectedFrameId('default');
    }
  }, [profile]);

  const selectedFrame = frameOptions.find((opt) => opt.id === selectedFrameId) ?? frameOptions[0];
  const currentPresetId: PresetAvatarId | null = parsePresetUri(selectedAvatar);

  const invalidateProfileQueries = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['me-profile'] }),
      queryClient.invalidateQueries({ queryKey: ['me-profile-detail'] }),
      queryClient.invalidateQueries({ queryKey: ['me-appearance-profile'] }),
    ]);

  const handlePickFromLibrary = async () => {
    if (uploading) return;
    setUploading('library');
    try {
      const result = await pickAvatarFromLibrary();
      if (!result) return; // 取消 / 拒权
      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '上传失败', type: 'error' });
        return;
      }
      setSelectedAvatar(result.data.url);
      show({ message: '已选择新头像，记得点保存', type: 'info' });
    } finally {
      setUploading(null);
    }
  };

  const handlePickFromCamera = async () => {
    if (uploading) return;
    setUploading('camera');
    try {
      const result = await pickAvatarFromCamera();
      if (!result) return;
      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '上传失败', type: 'error' });
        return;
      }
      setSelectedAvatar(result.data.url);
      show({ message: '已选择新头像，记得点保存', type: 'info' });
    } finally {
      setUploading(null);
    }
  };

  const handleSave = async () => {
    if (!profile || saving) return;
    setSaving(true);
    try {
      const result = await UserRepo.updateProfile({
        avatar: selectedAvatar ?? profile.avatar,
        avatarFrame: selectedFrame.frame ?? undefined,
      });
      if (!result.ok) {
        show({ message: result.error.displayMessage ?? '保存失败', type: 'error' });
        return;
      }
      await invalidateProfileQueries();
      show({ message: '头像设置已保存', type: 'success' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader title="头像与装扮" />
      {isLoading ? (
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={180} radius={radius.lg} />
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
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['4xl'] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        >
          {/* 预览卡片 */}
          <Animated.View
            entering={FadeInDown.duration(280)}
            style={[styles.previewCard, shadow.md, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
          >
            <LinearGradient
              colors={[colors.brand.primarySoft, colors.surface]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.previewGradient}
            >
              <AvatarFrame uri={selectedAvatar ?? profile.avatar} size={108} frame={selectedFrame.frame} />
              <Text style={[typography.title2, { color: colors.text.primary, marginTop: spacing.md }]}>{profile.name}</Text>
              <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}>
                {currentPresetId
                  ? `已选默认头像 · ${PRESET_AVATAR_LABEL[currentPresetId]}`
                  : isPresetUri(selectedAvatar)
                  ? '已选默认头像'
                  : '已选自定义头像'}
              </Text>
              {selectedFrame.frame ? (
                <Tag label={selectedFrame.label} tone="brand" style={{ marginTop: spacing.sm }} />
              ) : null}
            </LinearGradient>
          </Animated.View>

          {/* 默认头像库 */}
          <Animated.View entering={FadeInDown.duration(280).delay(60)} style={{ marginTop: spacing.xl }}>
            <View style={styles.sectionHeader}>
              <Text style={[typography.title3, { color: colors.text.primary }]}>选择默认头像</Text>
              <Text style={[typography.caption, { color: colors.text.tertiary }]}>{PRESET_AVATAR_IDS.length} 款</Text>
            </View>
            <View style={styles.presetGrid}>
              {PRESET_AVATAR_IDS.map((presetId) => {
                const uri = toPresetUri(presetId);
                const active = selectedAvatar === uri;
                return (
                  <Pressable
                    key={presetId}
                    onPress={() => setSelectedAvatar(uri)}
                    style={[
                      styles.presetCell,
                      {
                        borderColor: active ? colors.brand.primary : colors.border,
                        borderRadius: radius.lg,
                        backgroundColor: active ? colors.brand.primarySoft : colors.surface,
                      },
                    ]}
                  >
                    <DefaultAvatar presetId={presetId} size={56} />
                    <Text
                      style={[
                        typography.caption,
                        {
                          color: active ? colors.brand.primary : colors.text.secondary,
                          marginTop: spacing.xs,
                          fontWeight: active ? '600' : '400',
                        },
                      ]}
                    >
                      {PRESET_AVATAR_LABEL[presetId]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Animated.View>

          {/* 上传 / 同步操作 */}
          <Animated.View entering={FadeInDown.duration(280).delay(120)} style={{ marginTop: spacing.xl }}>
            <Text style={[typography.title3, { color: colors.text.primary }]}>使用自己的头像</Text>
            <View style={styles.uploadRow}>
              <UploadAction
                icon="image-multiple-outline"
                label="相册"
                loading={uploading === 'library'}
                disabled={!!uploading && uploading !== 'library'}
                onPress={handlePickFromLibrary}
              />
              <UploadAction
                icon="camera-outline"
                label="拍照"
                loading={uploading === 'camera'}
                disabled={!!uploading && uploading !== 'camera'}
                onPress={handlePickFromCamera}
              />
            </View>
            <Text style={[typography.caption, { color: colors.text.tertiary, marginTop: spacing.sm }]}>
              支持 JPG / PNG / WebP，建议正方形比例
            </Text>
          </Animated.View>

          {/* 头像框选择 */}
          <Animated.View entering={FadeInDown.duration(280).delay(180)} style={{ marginTop: spacing.xl }}>
            <Text style={[typography.title3, { color: colors.text.primary }]}>选择头像框</Text>
            <View style={{ marginTop: spacing.sm }}>
              {frameOptions.map((option) => {
                const locked = option.requiresVip && !isVip;
                const active = option.id === selectedFrameId;
                return (
                  <Pressable
                    key={option.id}
                    disabled={locked}
                    onPress={() => setSelectedFrameId(option.id)}
                    style={({ pressed }) => [
                      styles.frameRow,
                      shadow.md,
                      {
                        backgroundColor: colors.surface,
                        borderRadius: radius.lg,
                        borderColor: active ? colors.brand.primary : 'transparent',
                        opacity: locked ? 0.55 : pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    <AvatarFrame uri={selectedAvatar ?? profile.avatar} size={56} frame={option.frame} />
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                      <View style={styles.frameTitleRow}>
                        <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>{option.label}</Text>
                        {option.requiresVip ? (
                          <Tag label="VIP" tone={isVip ? 'brand' : 'neutral'} style={{ marginLeft: spacing.sm }} />
                        ) : null}
                      </View>
                      <Text style={[typography.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}>
                        {option.hint}
                      </Text>
                    </View>
                    {active ? (
                      <Tag label="已选" tone="brand" />
                    ) : locked ? (
                      <MaterialCommunityIcons name="lock-outline" size={20} color={colors.text.tertiary} />
                    ) : (
                      <Text style={[typography.caption, { color: colors.text.secondary }]}>选择</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </Animated.View>

          {/* 保存按钮 */}
          <Pressable onPress={handleSave} disabled={saving}>
            <LinearGradient
              colors={[colors.brand.primary, colors.brand.primaryDark]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.saveButton, { borderRadius: radius.pill, opacity: saving ? 0.7 : 1 }]}
            >
              {saving ? (
                <ActivityIndicator color={colors.text.inverse} />
              ) : (
                <Text style={[typography.bodyStrong, { color: colors.text.inverse }]}>保存</Text>
              )}
            </LinearGradient>
          </Pressable>
        </ScrollView>
      )}
    </Screen>
  );
}

type UploadActionProps = {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
};

const UploadAction = ({ icon, label, loading, disabled, onPress }: UploadActionProps) => {
  const { colors, radius, spacing, typography } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.uploadCell,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.lg,
          opacity: disabled ? 0.55 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={[styles.uploadIconWrap, { backgroundColor: colors.brand.primarySoft, borderRadius: radius.md }]}>
        {loading ? (
          <ActivityIndicator color={colors.brand.primary} />
        ) : (
          <MaterialCommunityIcons name={icon} size={22} color={colors.brand.primary} />
        )}
      </View>
      <Text style={[typography.caption, { color: colors.text.primary, marginTop: spacing.xs }]}>{label}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  previewCard: {
    overflow: 'hidden',
  },
  previewGradient: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  presetCell: {
    width: '23%',
    marginHorizontal: '1%',
    marginBottom: 10,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  uploadRow: {
    flexDirection: 'row',
    marginTop: 10,
    marginHorizontal: -4,
  },
  uploadCell: {
    flex: 1,
    marginHorizontal: 4,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
  },
  uploadIconWrap: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  frameTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  saveButton: {
    marginTop: 24,
    paddingVertical: 14,
    alignItems: 'center',
  },
});
