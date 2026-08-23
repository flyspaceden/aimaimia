import { Image, Text, View } from '@tarojs/components';
import './index.scss';

export const PRESET_AVATARS = [
  { id: 'sprout', label: '嫩芽', glyph: '芽' },
  { id: 'leaf', label: '青叶', glyph: '叶' },
  { id: 'wheat', label: '麦穗', glyph: '麦' },
  { id: 'rice', label: '稻米', glyph: '稻' },
  { id: 'sun', label: '丰阳', glyph: '阳' },
  { id: 'mountain', label: '山林', glyph: '山' },
  { id: 'carrot', label: '红萝', glyph: '萝' },
  { id: 'tractor', label: '田耕', glyph: '耕' },
] as const;

export type PresetAvatarId = typeof PRESET_AVATARS[number]['id'];

export function presetAvatarId(uri?: string | null): PresetAvatarId | null {
  if (!uri?.startsWith('preset://')) return null;
  const id = uri.slice('preset://'.length);
  return PRESET_AVATARS.some((item) => item.id === id) ? id as PresetAvatarId : null;
}

export function ProfileAvatar({
  uri,
  name,
  frameType,
  size = 'small',
}: {
  uri?: string | null;
  name?: string;
  frameType?: string | null;
  size?: 'small' | 'large';
}) {
  const preset = presetAvatarId(uri);
  const entry = PRESET_AVATARS.find((item) => item.id === preset);
  const imageAllowed = Boolean(uri && /^(https?:\/\/|wxfile:\/\/|tmp\/)/i.test(uri));
  const classes = [
    'profile-avatar',
    `profile-avatar--${size}`,
    preset ? `profile-avatar--${preset}` : '',
    frameType === 'vip' ? 'profile-avatar--vip' : '',
  ].filter(Boolean).join(' ');
  return <View className={classes}>
    {imageAllowed ? <Image className='profile-avatar__image' src={uri!} mode='aspectFill' /> : <Text className='profile-avatar__glyph'>{entry?.glyph || name?.slice(0, 1) || '爱'}</Text>}
    {frameType === 'vip' ? <Text className='profile-avatar__vip'>VIP</Text> : null}
  </View>;
}
