/**
 * 瀑布流列分配（性能底座）
 *
 * 用途：
 * - 给 nvue/recycle-list 提供“左右列”的数据切分
 * - 通过估算高度减少 reflow
 */
export type WaterfallItem = {
  id: string;
  estimatedHeight: number;
};

export const splitWaterfall = <T extends WaterfallItem>(items: T[]) => {
  const left: T[] = [];
  const right: T[] = [];
  let leftHeight = 0;
  let rightHeight = 0;

  items.forEach((item) => {
    if (leftHeight <= rightHeight) {
      left.push(item);
      leftHeight += item.estimatedHeight;
    } else {
      right.push(item);
      rightHeight += item.estimatedHeight;
    }
  });

  return { left, right };
};

