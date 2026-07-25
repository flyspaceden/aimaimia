export type HomeAiStageOrbSize = 'large' | 'medium';

export interface HomeAiStageLayout {
  stageWidth: number;
  stageHeight: number;
  orbSize: HomeAiStageOrbSize;
  lobsterSize: number;
  lobsterLeft: number;
  lobsterTop: number;
  crabSize: number;
  crabRight: number;
  crabTop: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Keeps the lobster, AI orb and king crab as one centered visual cluster.
 *
 * Decorative art reacts only to usable window width. System font/display
 * scaling must not independently shrink the seafood or push it to page edges.
 */
export function getHomeAiStageLayout(
  windowWidth: number,
  horizontalPadding = 20
): HomeAiStageLayout {
  const safeWindowWidth =
    Number.isFinite(windowWidth) && windowWidth > 0 ? windowWidth : 390;
  const safeHorizontalPadding =
    Number.isFinite(horizontalPadding) && horizontalPadding >= 0
      ? horizontalPadding
      : 20;
  const stageWidth = Math.round(
    clamp(safeWindowWidth - safeHorizontalPadding * 2, 200, 360)
  );
  const isTrulyNarrow = safeWindowWidth < 340;

  if (isTrulyNarrow) {
    const scale = clamp(stageWidth / 280, 0.78, 1);
    const lobsterSize = Math.round(96 * scale);
    const crabSize = Math.round(104 * scale);

    return {
      stageWidth,
      stageHeight: 220,
      orbSize: 'medium',
      lobsterSize,
      lobsterLeft: Math.round(-6 * scale),
      lobsterTop: Math.round(64 + (96 - lobsterSize) / 2),
      crabSize,
      crabRight: Math.round(-8 * scale),
      crabTop: Math.round(64 + (104 - crabSize) / 2),
    };
  }

  const scale = clamp(stageWidth / 360, 0.84, 1);
  const lobsterSize = Math.round(126 * scale);
  const crabSize = Math.round(136 * scale);

  return {
    stageWidth,
    stageHeight: 236,
    orbSize: 'large',
    lobsterSize,
    lobsterLeft: Math.round(-14 * scale),
    lobsterTop: Math.round(58 + (126 - lobsterSize) / 2),
    crabSize,
    crabRight: Math.round(-18 * scale),
    crabTop: Math.round(62 + (136 - crabSize) / 2),
  };
}
