// 价格格式化：保留 2 位小数并去掉末尾 0
export const formatPrice = (value: number | undefined | null) => {
  if (value == null || isNaN(value)) return '0';
  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.[1-9])0$/, '$1');
};
