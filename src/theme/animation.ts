import { Easing } from 'react-native-reanimated';

// 动效常量：集中管理所有动画参数
export const animation = {
  // 持续时间（毫秒）
  duration: {
    micro: 150,
    standard: 250,
    emphasis: 350,
    continuous: 3000,
  },
  // 缓动函数
  easing: {
    easeOut: Easing.out(Easing.ease),
    easeInOut: Easing.inOut(Easing.ease),
    linear: Easing.linear,
  },
  // 弹簧参数（damping, stiffness, mass）
  spring: {
    emphasis: { damping: 15, stiffness: 150, mass: 1 },
    gentle: { damping: 20, stiffness: 100, mass: 1 },
  },
  // 列表交错延迟
  stagger: {
    listItem: 50,
  },
  // 按压缩放
  press: {
    button: { scale: 0.97 },
    card: { scale: 0.98 },
    orbLongPress: { scale: 1.15 },
  },
};
