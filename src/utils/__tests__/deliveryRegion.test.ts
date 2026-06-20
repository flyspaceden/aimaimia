declare const describe: any;
declare const it: any;
declare const expect: any;

import { mapRegionValueToDeliveryUnitFields } from '../deliveryRegion';

describe('delivery region mapping', () => {
  it('stores delivery unit province and city with 6-digit standard region codes', () => {
    expect(
      mapRegionValueToDeliveryUnitFields({
        regionCode: '440106',
        regionText: '广东省/广州市/天河区',
      }),
    ).toEqual({
      provinceCode: '440000',
      provinceName: '广东省',
      cityCode: '440100',
      cityName: '广州市',
      districtCode: '440106',
      districtName: '天河区',
    });
  });
});
