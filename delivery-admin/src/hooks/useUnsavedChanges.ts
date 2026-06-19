/**
 * 未保存更改警告 Hook
 *
 * 当页面存在未保存的更改时：
 * 1. 阻止浏览器关闭/刷新，触发浏览器原生提示
 * 2. 通过全局状态标记，供 AdminLayout 在侧边栏导航时拦截
 */
import { useEffect } from 'react';

// 全局 dirty 状态（供 AdminLayout menuItemRender 读取）
let _globalDirty = false;

export function isGlobalDirty() {
  return _globalDirty;
}

export function useUnsavedChanges(isDirty: boolean) {
  // 同步到全局状态
  useEffect(() => {
    _globalDirty = isDirty;
    return () => {
      _globalDirty = false;
    };
  }, [isDirty]);

  // 阻止浏览器关闭/刷新
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
}
