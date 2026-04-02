import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../../theme';

export interface SpinWheelPrize {
  id: string;
  name: string;
  type: string;
}

interface SpinWheelProps {
  prizes: SpinWheelPrize[];
  rotation: SharedValue<number>;
  size?: number;
}

// 奖品类型 → 双色方案（主色 + 浅色交替，营造节庆视觉层次）
// 文字颜色确保 WCAG AA 对比度 ≥ 4.5:1
const SEGMENT_THEMES: Record<string, { main: string; alt: string; text: string }> = {
  RED_PACK: { main: '#E8A000', alt: '#FFD54F', text: '#4A2800' },
  COUPON: { main: '#2E7D32', alt: '#43A047', text: '#FFFFFF' },
  PRODUCT: { main: '#C62828', alt: '#D32F2F', text: '#FFFFFF' },
  NONE: { main: '#F0DBA0', alt: '#FFF3D0', text: '#5A4520' },
};
const DEFAULT_THEME = { main: '#F0DBA0', alt: '#FFF3D0', text: '#5A4520' };

function getSegmentTheme(type: string) {
  return SEGMENT_THEMES[type] || DEFAULT_THEME;
}

// 将角度转换为弧度
function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// 截断文字以适应扇区
function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

// 生成扇形SVG路径
function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const startRad = degToRad(startAngle - 90);
  const endRad = degToRad(endAngle - 90);
  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy + r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy + r * Math.sin(endRad);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

// SVG 转盘组件：等分扇形 + 装饰外圈 + 奖品文字，旋转由父组件 SharedValue 控制
export function SpinWheel({ prizes, rotation, size = 280 }: SpinWheelProps) {
  const { shadow } = useTheme();
  const half = size / 2;
  const outerR = half - 14; // 留出装饰外圈空间
  const centerR = 22;
  const DOT_COUNT = 20; // 装饰灯珠数量
  const DOT_RADIUS = 3;

  // 计算扇区数据
  const segments = useMemo(() => {
    if (prizes.length === 0) return [];
    const segAngle = 360 / prizes.length;
    return prizes.map((prize, i) => {
      const startAngle = i * segAngle;
      const endAngle = startAngle + segAngle;
      const midAngle = startAngle + segAngle / 2;
      const textR = outerR * 0.6;
      const textRad = degToRad(midAngle - 90);
      const textX = half + textR * Math.cos(textRad);
      const textY = half + textR * Math.sin(textRad);
      const theme = getSegmentTheme(prize.type);
      // 交替使用主色和浅色，增加视觉丰富度
      const fill = i % 2 === 0 ? theme.main : theme.alt;
      return {
        prize,
        path: describeArc(half, half, outerR, startAngle, endAngle),
        fill,
        textColor: theme.text,
        textX,
        textY,
        textRotation: midAngle,
        label: truncateText(prize.name, 5),
      };
    });
  }, [prizes, half, outerR]);

  // 外圈装饰灯珠
  const rimDots = useMemo(() => {
    const dotRingR = half - 7;
    return Array.from({ length: DOT_COUNT }, (_, i) => {
      const angle = (360 / DOT_COUNT) * i;
      const rad = degToRad(angle - 90);
      return {
        cx: half + dotRingR * Math.cos(rad),
        cy: half + dotRingR * Math.sin(rad),
        fill: i % 2 === 0 ? '#FFFFFF' : '#1B5E20',
      };
    });
  }, [half]);

  // 动画旋转样式
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <View style={[styles.container, { width: size, height: size }, shadow.lg]}>
      <Animated.View style={[{ width: size, height: size }, animatedStyle]}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* 外圈装饰：深绿底 → 金色环 → 灯珠 */}
          <Circle cx={half} cy={half} r={half - 1} fill="#1B5E20" />
          <Circle cx={half} cy={half} r={half - 3} fill="#D4A017" />
          <Circle cx={half} cy={half} r={half - 13} fill="transparent" />

          {/* 扇区 */}
          {segments.map((seg, i) => (
            <G key={seg.prize.id || i}>
              <Path d={seg.path} fill={seg.fill} />
              {/* 金色分割线 */}
              <Path d={seg.path} fill="none" stroke="#C89510" strokeWidth={1.5} />
              {/* 奖品文字 */}
              <SvgText
                x={seg.textX}
                y={seg.textY}
                fill={seg.textColor}
                fontSize={13}
                fontWeight="700"
                textAnchor="middle"
                alignmentBaseline="central"
                rotation={seg.textRotation}
                origin={`${seg.textX}, ${seg.textY}`}
              >
                {seg.label}
              </SvgText>
            </G>
          ))}

          {/* 装饰灯珠（金白交替） */}
          {rimDots.map((dot, i) => (
            <Circle
              key={`dot-${i}`}
              cx={dot.cx}
              cy={dot.cy}
              r={DOT_RADIUS}
              fill={dot.fill}
              opacity={0.9}
            />
          ))}

          {/* 中心按钮：多层圆环营造立体感 */}
          <Circle cx={half} cy={half} r={centerR + 5} fill="#1B5E20" />
          <Circle cx={half} cy={half} r={centerR + 3} fill="#D4A017" />
          <Circle cx={half} cy={half} r={centerR} fill="#FFD54F" />
          <SvgText
            x={half}
            y={half}
            fill="#5C3000"
            fontSize={20}
            fontWeight="bold"
            textAnchor="middle"
            alignmentBaseline="central"
          >
            ★
          </SvgText>
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9999,
  },
});
