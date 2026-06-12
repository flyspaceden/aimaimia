import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, G, Path, Text as SvgText, TSpan } from 'react-native-svg';
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

type SegmentTheme = {
  background: string;
  text: string;
};

// 奖品实例调色板：同一类型的不同奖品也会获得不同背景色，避免按类型固定成同色块。
// 文字颜色随背景预设，保证转盘上有足够对比度。
const SEGMENT_PALETTE: SegmentTheme[] = [
  { background: '#C62828', text: '#FFFFFF' },
  { background: '#E8A000', text: '#3A2600' },
  { background: '#2E7D32', text: '#FFFFFF' },
  { background: '#1565C0', text: '#FFFFFF' },
  { background: '#7B1FA2', text: '#FFFFFF' },
  { background: '#00838F', text: '#FFFFFF' },
  { background: '#AD1457', text: '#FFFFFF' },
  { background: '#6D4C41', text: '#FFFFFF' },
  { background: '#EF6C00', text: '#FFFFFF' },
  { background: '#455A64', text: '#FFFFFF' },
];

function hashString(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash << 5) - hash + char.charCodeAt(0);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getSegmentTheme(type: string, index: number, id: string): SegmentTheme {
  const key = `${type}:${id}:${index}`;
  return SEGMENT_PALETTE[hashString(key) % SEGMENT_PALETTE.length];
}

// 将角度转换为弧度
function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function buildWheelLabelLines(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) return [''];

  const chars = Array.from(normalized);
  if (chars.length <= 4) return [normalized];

  const lineCount = chars.length <= 8 ? 2 : chars.length <= 12 ? 3 : 4;
  const charsPerLine = Math.ceil(chars.length / lineCount);
  const lines: string[] = [];
  for (let i = 0; i < chars.length; i += charsPerLine) {
    lines.push(chars.slice(i, i + charsPerLine).join(''));
  }
  return lines;
}

function getWheelLabelFontSize(text: string, totalPrizes: number): number {
  const length = Array.from(text.trim()).length;
  if (length <= 4 && totalPrizes <= 5) return 13;
  if (length <= 8) return totalPrizes >= 6 ? 10 : 11;
  return totalPrizes >= 6 ? 8 : 9;
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
      const textR = outerR * 0.62;
      const textRad = degToRad(midAngle - 90);
      const textX = half + textR * Math.cos(textRad);
      const textY = half + textR * Math.sin(textRad);
      const theme = getSegmentTheme(prize.type, i, prize.id);
      const labelLines = buildWheelLabelLines(prize.name);
      const fontSize = getWheelLabelFontSize(prize.name, prizes.length);
      const lineHeight = fontSize + 2;
      return {
        prize,
        path: describeArc(half, half, outerR, startAngle, endAngle),
        fill: theme.background,
        textColor: theme.text,
        textX,
        textY,
        textRotation: midAngle,
        labelLines,
        fontSize,
        lineHeight,
        labelYOffset: -((labelLines.length - 1) * lineHeight) / 2,
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
                y={seg.textY + seg.labelYOffset}
                fill={seg.textColor}
                fontSize={seg.fontSize}
                fontWeight="700"
                textAnchor="middle"
                alignmentBaseline="central"
                rotation={seg.textRotation}
                origin={`${seg.textX}, ${seg.textY}`}
              >
                {seg.labelLines.map((line, lineIndex) => (
                  <TSpan
                    key={`${seg.prize.id}-line-${lineIndex}`}
                    x={seg.textX}
                    dy={lineIndex === 0 ? 0 : seg.lineHeight}
                  >
                    {line}
                  </TSpan>
                ))}
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
