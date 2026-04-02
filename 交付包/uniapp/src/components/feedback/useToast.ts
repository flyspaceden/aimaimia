// Toast 提示：统一轻量反馈（公共组件需中文注释）
export const useToast = () => {
  const show = (payload: { message: string; type?: 'success' | 'error' | 'info' }) => {
    const type = payload.type ?? 'info';
    const icon = type === 'success' ? 'success' : type === 'error' ? 'error' : 'none';
    uni.showToast({
      title: payload.message,
      icon,
      duration: 1800,
    });
  };

  return { show };
};

