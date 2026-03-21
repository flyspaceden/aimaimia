/**
 * 未保存更改警告 Hook
 *
 * 当页面存在未保存的更改时：
 * 1. 阻止 SPA 内导航，弹出确认对话框
 * 2. 阻止浏览器关闭/刷新，触发浏览器原生提示
 */
import { useEffect } from 'react';
import { useBlocker } from 'react-router';
import { Modal } from 'antd';

export function useUnsavedChanges(isDirty: boolean) {
  // 阻止 SPA 内部导航
  const blocker = useBlocker(isDirty);

  useEffect(() => {
    if (blocker.state === 'blocked') {
      Modal.confirm({
        title: '未保存的更改',
        content: '你有未保存的更改，确定离开吗？离开后更改将丢失。',
        okText: '确定离开',
        cancelText: '继续编辑',
        okButtonProps: { danger: true },
        onOk: () => blocker.proceed?.(),
        onCancel: () => blocker.reset?.(),
      });
    }
  }, [blocker]);

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
