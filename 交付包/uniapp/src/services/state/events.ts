// 应用内事件名：用于跨页面/跨组件同步状态（购物车角标、登录态、未读数等）
// 说明：uni-app 运行时提供 uni.$emit / uni.$on / uni.$off（App/H5/小程序均可用），
// 用它可以在不引入额外状态库的情况下，让 nvue 与 vue 页面都能同步更新。
export const APP_EVENTS = {
  CART_CHANGED: 'nm:cart-changed',
  AUTH_CHANGED: 'nm:auth-changed',
  INBOX_CHANGED: 'nm:inbox-changed',
} as const;

export type AppEventName = (typeof APP_EVENTS)[keyof typeof APP_EVENTS];

