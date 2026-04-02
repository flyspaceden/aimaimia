// uni.$emit / uni.$on 的类型封装：TS 下 uni 的类型不一定包含 $on/$off/$emit
// 后续如切换为 Pinia/Vuex，可删掉该封装，页面改为订阅 store 即可。
import type { AppEventName } from './events';

type Handler = (payload?: any) => void;

export const onAppEvent = (name: AppEventName, handler: Handler) => {
  const u = uni as any;
  if (typeof u.$on === 'function') u.$on(name, handler);
  return () => {
    if (typeof u.$off === 'function') u.$off(name, handler);
  };
};

export const emitAppEvent = (name: AppEventName, payload?: any) => {
  const u = uni as any;
  if (typeof u.$emit === 'function') u.$emit(name, payload);
};

