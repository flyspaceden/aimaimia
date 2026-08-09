import type { MapProps } from '@tarojs/components';
import type { Company } from '@/types';

export type CompanyMapEntry = {
  company: Company;
  marker: MapProps.marker;
};

export type CompanyMapData = {
  center: MapProps.point | null;
  entries: CompanyMapEntry[];
  includePoints: MapProps.point[];
  markers: MapProps.marker[];
};

function hasValidCoordinates(company: Company): company is Company & {
  coordinates: { lat: number; lng: number };
} {
  const { coordinates } = company;
  return Boolean(
    coordinates
    && Number.isFinite(coordinates.lat)
    && Number.isFinite(coordinates.lng)
    && coordinates.lat >= -90
    && coordinates.lat <= 90
    && coordinates.lng >= -180
    && coordinates.lng <= 180,
  );
}

/**
 * 只把后端返回的有效企业坐标转为地图点位。
 * 中心点是已有点位的几何中心，不是用户位置，也不会补齐或伪造缺失坐标。
 */
export function buildCompanyMapData(
  companies: Company[],
  markerIconPath: string,
  selectedCompanyId?: string,
): CompanyMapData {
  const mappableCompanies = companies.filter(hasValidCoordinates);
  const entries = mappableCompanies.map((company, index) => {
    const selected = company.id === selectedCompanyId;
    const marker: MapProps.marker = {
      id: index + 1,
      latitude: company.coordinates.lat,
      longitude: company.coordinates.lng,
      title: company.name,
      iconPath: markerIconPath,
      width: selected ? 42 : 34,
      height: selected ? 42 : 34,
      zIndex: selected ? 2 : 1,
      anchor: { x: 0.5, y: 1 },
      ariaLabel: `${company.name}企业点位`,
    };
    return { company, marker };
  });
  const includePoints = entries.map(({ marker }) => ({
    latitude: marker.latitude,
    longitude: marker.longitude,
  }));
  const center = includePoints.length
    ? {
      latitude: includePoints.reduce((total, point) => total + point.latitude, 0) / includePoints.length,
      longitude: includePoints.reduce((total, point) => total + point.longitude, 0) / includePoints.length,
    }
    : null;

  return {
    center,
    entries,
    includePoints,
    markers: entries.map(({ marker }) => marker),
  };
}

export function findCompanyByMarkerId(
  entries: CompanyMapEntry[],
  markerId: number | string,
): Company | undefined {
  const normalizedMarkerId = Number(markerId);
  if (!Number.isInteger(normalizedMarkerId)) return undefined;
  return entries.find(({ marker }) => marker.id === normalizedMarkerId)?.company;
}
