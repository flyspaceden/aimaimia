declare const describe: any;
declare const it: any;
declare const expect: any;

import { lightColors } from '../../theme/colors';
import { deliveryLightColors } from '../../theme/delivery';
import { resolveRegionPickerColors } from '../../components/forms/regionPickerTheme';

describe('resolveRegionPickerColors', () => {
  it('uses the injected palette when a business line provides one', () => {
    expect(resolveRegionPickerColors(lightColors, deliveryLightColors)).toBe(deliveryLightColors);
  });

  it('falls back to the app theme palette when no override is provided', () => {
    expect(resolveRegionPickerColors(lightColors)).toBe(lightColors);
  });
});
