import type { RegionValue } from '../components/forms/RegionPicker';

export type DeliveryUnitRegionFields = {
  provinceCode: string;
  provinceName: string;
  cityCode: string;
  cityName: string;
  districtCode: string;
  districtName: string;
};

export const mapRegionValueToDeliveryUnitFields = (value: RegionValue): DeliveryUnitRegionFields => {
  const districtCode = value.regionCode.trim();
  const [provinceName = '', cityName = '', districtName = ''] = value.regionText.split('/');

  return {
    provinceCode: `${districtCode.slice(0, 2)}0000`,
    provinceName,
    cityCode: `${districtCode.slice(0, 4)}00`,
    cityName,
    districtCode,
    districtName,
  };
};
