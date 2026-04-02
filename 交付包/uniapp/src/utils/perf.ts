// 性能开关工具：控制是否启用 recycle-list（用于真机回归/问题排查）
// 使用方式：
// - 通过 uni.setStorageSync('nm_use_recycle', 0/1) 强制关闭/开启
// - 未设置时默认开启（更流畅）
export const getRecycleEnabled = (fallback = true) => {
  const raw = uni.getStorageSync('nm_use_recycle');
  if (raw === 0 || raw === '0' || raw === false || raw === 'false') return false;
  if (raw === 1 || raw === '1' || raw === true || raw === 'true') return true;
  return fallback;
};

export const setRecycleEnabled = (enabled: boolean) => {
  uni.setStorageSync('nm_use_recycle', enabled ? 1 : 0);
};
