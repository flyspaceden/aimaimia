import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../../theme';
import { DefaultAvatar, parsePresetUri } from './DefaultAvatar';

// "无框"头像：列表/评论/作者卡等场景，不需要 AvatarFrame 那种装饰边框 + 呼吸动效
// 但需要正确处理 `preset://xxx` sentinel（否则 preset URL 会让 Image 静默失败）
type UserAvatarProps = {
  uri?: string | null;
  size: number;
  style?: StyleProp<ViewStyle>;
};

export const UserAvatar = ({ uri, size, style }: UserAvatarProps) => {
  const { colors } = useTheme();
  const radius = size / 2;
  const presetId = parsePresetUri(uri);
  const baseStyle = [{ width: size, height: size, borderRadius: radius, overflow: 'hidden' as const }, style];

  if (presetId) {
    return (
      <View style={baseStyle}>
        <DefaultAvatar presetId={presetId} size={size} />
      </View>
    );
  }
  if (uri) {
    return <Image source={{ uri }} style={baseStyle as any} />;
  }
  return <View style={[baseStyle, { backgroundColor: colors.brand.primarySoft }]} />;
};
