import { Injectable } from '@nestjs/common';

type GrowthLevelLike = {
  code: string;
  name: string;
  threshold: number;
  enabled?: boolean;
  benefits?: unknown;
  avatarFrameType?: string | null;
  titleLabel?: string | null;
  monthlyExchangeLimit?: number | null;
};

@Injectable()
export class GrowthLevelService {
  resolveLevel(growthValue: number, levels: GrowthLevelLike[]) {
    const enabledLevels = levels
      .filter((level) => level.enabled !== false)
      .sort((a, b) => a.threshold - b.threshold);

    let current: GrowthLevelLike | null = null;
    let next: GrowthLevelLike | null = null;

    for (const level of enabledLevels) {
      if (level.threshold <= growthValue) {
        current = level;
        continue;
      }
      next = level;
      break;
    }

    return {
      level: current ? this.toPublicLevel(current) : null,
      nextLevel: next ? this.toPublicLevel(next) : null,
      levelProgress: this.buildProgress(growthValue, current, next),
    };
  }

  private buildProgress(
    growthValue: number,
    current: GrowthLevelLike | null,
    next: GrowthLevelLike | null,
  ) {
    if (!current || !next) {
      return {
        current: 0,
        required: null,
        ratio: next ? 0 : 1,
      };
    }

    const currentProgress = Math.max(0, growthValue - current.threshold);
    const required = Math.max(1, next.threshold - current.threshold);
    const ratio = Math.min(1, currentProgress / required);

    return {
      current: currentProgress,
      required,
      ratio: Math.round(ratio * 10000) / 10000,
    };
  }

  private toPublicLevel(level: GrowthLevelLike) {
    return {
      code: level.code,
      name: level.name,
      threshold: level.threshold,
      benefits: level.benefits ?? null,
      avatarFrameType: level.avatarFrameType ?? null,
      titleLabel: level.titleLabel ?? null,
      monthlyExchangeLimit: level.monthlyExchangeLimit ?? null,
    };
  }
}
