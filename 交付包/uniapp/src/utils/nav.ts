// 导航封装：统一 App 转场参数（避免页面各自写动画）
export type NavToOptions = UniApp.NavigateToOptions & {
  animationType?: UniApp.NavigateToOptions['animationType'];
  animationDuration?: number;
};

export type NavBackOptions = UniApp.NavigateBackOptions & {
  animationType?: UniApp.NavigateBackOptions['animationType'];
  animationDuration?: number;
};

const DEFAULT_FORWARD_ANIMATION: Required<Pick<NavToOptions, 'animationType' | 'animationDuration'>> = {
  animationType: 'slide-in-right',
  animationDuration: 220,
};

export const navTo = (options: NavToOptions | string) => {
  const payload = typeof options === 'string' ? ({ url: options } as NavToOptions) : options;
  const { animationType, animationDuration, ...rest } = payload;
  return uni.navigateTo({
    ...rest,
    animationType: animationType ?? DEFAULT_FORWARD_ANIMATION.animationType,
    animationDuration: animationDuration ?? DEFAULT_FORWARD_ANIMATION.animationDuration,
  });
};

export const navReplace = (options: UniApp.RedirectToOptions | string) => {
  const payload = typeof options === 'string' ? ({ url: options } as UniApp.RedirectToOptions) : options;
  return uni.redirectTo(payload);
};

export const navTab = (options: UniApp.SwitchTabOptions | string) => {
  const payload = typeof options === 'string' ? ({ url: options } as UniApp.SwitchTabOptions) : options;
  return uni.switchTab(payload);
};

export const navBack = (options: NavBackOptions = {}) => {
  return uni.navigateBack(options);
};
