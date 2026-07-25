import {
  getHomeAiStageLayout,
  type HomeAiStageLayout,
} from '../homeAiStage';

const ORB_FRAME_WIDTH = {
  large: 220,
  medium: 194,
} as const;

function getSideOverlap(layout: HomeAiStageLayout) {
  const orbWidth = ORB_FRAME_WIDTH[layout.orbSize];
  const orbLeft = (layout.stageWidth - orbWidth) / 2;
  const orbRight = orbLeft + orbWidth;
  const lobsterRight = layout.lobsterLeft + layout.lobsterSize;
  const crabLeft =
    layout.stageWidth - layout.crabRight - layout.crabSize;

  return {
    left: lobsterRight - orbLeft,
    right: orbRight - crabLeft,
  };
}

describe('getHomeAiStageLayout', () => {
  it('keeps Xiaomi-like and Huawei-like widths on the same large visual tier', () => {
    const xiaomi = getHomeAiStageLayout(393, 20);
    const huawei = getHomeAiStageLayout(360, 20);

    expect(xiaomi.orbSize).toBe('large');
    expect(huawei.orbSize).toBe('large');
    expect(xiaomi.stageWidth).toBeLessThanOrEqual(360);
    expect(huawei.stageWidth).toBeLessThanOrEqual(360);
    expect(huawei.lobsterSize).toBeGreaterThanOrEqual(108);
    expect(huawei.crabSize).toBeGreaterThanOrEqual(116);

    const xiaomiOverlap = getSideOverlap(xiaomi);
    const huaweiOverlap = getSideOverlap(huawei);

    expect(Math.abs(xiaomiOverlap.left - huaweiOverlap.left)).toBeLessThanOrEqual(8);
    expect(Math.abs(xiaomiOverlap.right - huaweiOverlap.right)).toBeLessThanOrEqual(8);
  });

  it('caps wide phones instead of pushing seafood toward page edges', () => {
    const wide = getHomeAiStageLayout(480, 20);

    expect(wide.stageWidth).toBe(360);
    expect(wide.orbSize).toBe('large');
    expect(wide.lobsterSize).toBe(126);
    expect(wide.crabSize).toBe(136);
  });

  it('uses the medium tier only for a truly narrow phone', () => {
    const narrow = getHomeAiStageLayout(320, 20);

    expect(narrow.stageWidth).toBe(280);
    expect(narrow.orbSize).toBe('medium');
    expect(narrow.lobsterSize).toBe(96);
    expect(narrow.crabSize).toBe(104);
  });
});
