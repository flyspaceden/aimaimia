import React from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Circle, Path, G } from 'react-native-svg';

// 内置默认头像：8 个农业 / 自然主题图案，全部用 SVG 即时渲染，无需 PNG 资源文件
// 通过 sentinel URL 形式持久化：profile.avatarUrl = 'preset://sprout'
// AvatarFrame 组件检测到 'preset://' 前缀会渲染本组件而不是 expo-image

export const PRESET_AVATAR_IDS = [
  'sprout',
  'leaf',
  'wheat',
  'rice',
  'sun',
  'mountain',
  'carrot',
  'tractor',
] as const;

export type PresetAvatarId = (typeof PRESET_AVATAR_IDS)[number];

const PRESET_URI_PREFIX = 'preset://';

export function toPresetUri(id: PresetAvatarId): string {
  return `${PRESET_URI_PREFIX}${id}`;
}

export function parsePresetUri(uri: string | null | undefined): PresetAvatarId | null {
  if (!uri || !uri.startsWith(PRESET_URI_PREFIX)) {
    return null;
  }
  const candidate = uri.slice(PRESET_URI_PREFIX.length) as PresetAvatarId;
  return (PRESET_AVATAR_IDS as readonly string[]).includes(candidate) ? candidate : null;
}

export function isPresetUri(uri: string | null | undefined): boolean {
  return !!uri && uri.startsWith(PRESET_URI_PREFIX);
}

type Palette = {
  bgStart: string;
  bgEnd: string;
  ink: string;
  accent: string;
};

// 8 套配色：以品牌绿为主，搭配丰收金 / 麦黄 / 沃土棕 / 晨光黄 等农业相关色相
const PRESET_PALETTE: Record<PresetAvatarId, Palette> = {
  sprout: { bgStart: '#E8F5E9', bgEnd: '#A5D6A7', ink: '#1B5E20', accent: '#66BB6A' },
  leaf: { bgStart: '#DCEFE0', bgEnd: '#7CB342', ink: '#33691E', accent: '#558B2F' },
  wheat: { bgStart: '#FFF8E1', bgEnd: '#FFD54F', ink: '#8D6E1B', accent: '#F9A825' },
  rice: { bgStart: '#F1F8E9', bgEnd: '#C5E1A5', ink: '#33691E', accent: '#7CB342' },
  sun: { bgStart: '#FFF3E0', bgEnd: '#FFB74D', ink: '#BF360C', accent: '#FB8C00' },
  mountain: { bgStart: '#E3F2FD', bgEnd: '#64B5F6', ink: '#0D47A1', accent: '#1976D2' },
  carrot: { bgStart: '#FBE9E7', bgEnd: '#FF8A65', ink: '#BF360C', accent: '#E64A19' },
  tractor: { bgStart: '#EFEBE9', bgEnd: '#A1887F', ink: '#3E2723', accent: '#6D4C41' },
};

// 每个 id 对应一段 SVG path（在 0..100 的 viewBox 里画）
const PRESET_PATHS: Record<PresetAvatarId, (palette: Palette) => React.ReactNode> = {
  // 嫩芽：双叶 + 短茎
  sprout: (p) => (
    <G>
      <Path
        d="M50 78 C 50 60, 50 50, 50 38"
        stroke={p.ink}
        strokeWidth={3.5}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M50 52 C 36 52, 28 44, 28 32 C 40 32, 50 40, 50 52 Z"
        fill={p.accent}
      />
      <Path
        d="M50 44 C 64 44, 72 36, 72 24 C 60 24, 50 32, 50 44 Z"
        fill={p.ink}
      />
    </G>
  ),
  // 叶片：单片树叶
  leaf: (p) => (
    <G>
      <Path
        d="M30 70 C 30 40, 50 22, 76 22 C 76 48, 58 70, 30 70 Z"
        fill={p.accent}
      />
      <Path
        d="M30 70 C 42 56, 58 40, 74 26"
        stroke={p.ink}
        strokeWidth={2.5}
        strokeLinecap="round"
        fill="none"
      />
    </G>
  ),
  // 麦穗
  wheat: (p) => (
    <G stroke={p.ink} strokeWidth={2.4} strokeLinecap="round">
      <Path d="M50 82 L50 28" fill="none" />
      <Path d="M50 70 C 40 66, 36 60, 36 52" fill="none" />
      <Path d="M50 70 C 60 66, 64 60, 64 52" fill="none" />
      <Path d="M50 58 C 40 54, 36 48, 36 40" fill="none" />
      <Path d="M50 58 C 60 54, 64 48, 64 40" fill="none" />
      <Path d="M50 46 C 40 42, 36 36, 36 28" fill="none" />
      <Path d="M50 46 C 60 42, 64 36, 64 28" fill="none" />
    </G>
  ),
  // 米粒：圆形排列
  rice: (p) => (
    <G fill={p.ink}>
      <Path d="M40 36 C 36 38, 36 46, 40 48 C 44 46, 44 38, 40 36 Z" />
      <Path d="M60 36 C 56 38, 56 46, 60 48 C 64 46, 64 38, 60 36 Z" />
      <Path d="M50 52 C 46 54, 46 62, 50 64 C 54 62, 54 54, 50 52 Z" />
      <Path d="M40 68 C 36 70, 36 78, 40 80 C 44 78, 44 70, 40 68 Z" />
      <Path d="M60 68 C 56 70, 56 78, 60 80 C 64 78, 64 70, 60 68 Z" />
    </G>
  ),
  // 太阳：放射光线
  sun: (p) => (
    <G>
      <Circle cx={50} cy={50} r={18} fill={p.ink} />
      <G stroke={p.ink} strokeWidth={4} strokeLinecap="round">
        <Path d="M50 18 L50 26" />
        <Path d="M50 74 L50 82" />
        <Path d="M18 50 L26 50" />
        <Path d="M74 50 L82 50" />
        <Path d="M28 28 L33 33" />
        <Path d="M67 67 L72 72" />
        <Path d="M72 28 L67 33" />
        <Path d="M33 67 L28 72" />
      </G>
    </G>
  ),
  // 山峦：双峰
  mountain: (p) => (
    <G>
      <Path
        d="M14 76 L36 42 L50 60 L66 30 L86 76 Z"
        fill={p.ink}
      />
      <Path
        d="M32 50 L40 42 L48 50 Z"
        fill={p.bgStart}
      />
      <Path
        d="M60 38 L66 30 L72 38 Z"
        fill={p.bgStart}
      />
    </G>
  ),
  // 胡萝卜
  carrot: (p) => (
    <G>
      <Path d="M50 24 L42 18 M50 24 L50 14 M50 24 L58 18" stroke={p.accent} strokeWidth={3} strokeLinecap="round" fill="none" />
      <Path d="M38 30 L62 30 L50 82 Z" fill={p.ink} />
      <Path d="M44 44 L56 44 M42 56 L58 56 M46 68 L54 68" stroke={p.bgStart} strokeWidth={2} strokeLinecap="round" />
    </G>
  ),
  // 拖拉机
  tractor: (p) => (
    <G>
      <Path d="M22 64 L40 64 L46 48 L60 48 L66 64 L78 64 L78 72 L22 72 Z" fill={p.ink} />
      <Circle cx={34} cy={74} r={8} fill={p.accent} />
      <Circle cx={34} cy={74} r={3.5} fill={p.bgStart} />
      <Circle cx={68} cy={74} r={6} fill={p.accent} />
      <Circle cx={68} cy={74} r={2.5} fill={p.bgStart} />
      <Path d="M50 48 L50 40 L62 40 L62 48" fill={p.bgStart} stroke={p.ink} strokeWidth={1.5} />
    </G>
  ),
};

// 中文标签（appearance 页选中态用）
export const PRESET_AVATAR_LABEL: Record<PresetAvatarId, string> = {
  sprout: '嫩芽',
  leaf: '青叶',
  wheat: '麦穗',
  rice: '稻米',
  sun: '丰阳',
  mountain: '山林',
  carrot: '红萝',
  tractor: '田耕',
};

type DefaultAvatarProps = {
  presetId: PresetAvatarId;
  size?: number;
};

export const DefaultAvatar = ({ presetId, size = 72 }: DefaultAvatarProps) => {
  const palette = PRESET_PALETTE[presetId];
  const gradientId = `bg-${presetId}`;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={palette.bgStart} />
            <Stop offset="100%" stopColor={palette.bgEnd} />
          </LinearGradient>
        </Defs>
        <Circle cx={50} cy={50} r={50} fill={`url(#${gradientId})`} />
        {PRESET_PATHS[presetId](palette)}
      </Svg>
    </View>
  );
};
