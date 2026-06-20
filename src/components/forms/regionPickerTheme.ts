import type { ColorScheme } from '../../theme/colors';

export const resolveRegionPickerColors = (
  baseColors: ColorScheme,
  overrideColors?: ColorScheme,
): ColorScheme => overrideColors ?? baseColors;
