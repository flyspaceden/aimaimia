import { Image, Text, View } from '@tarojs/components';
import type { Company } from '@/types';
import { displayCompanyCertifications } from './catalog-utils';
import './catalog-company-card.scss';

type Props = { company: Company; onClick: (company: Company) => void };

export function CatalogCompanyCard({ company, onClick }: Props) {
  const badges = displayCompanyCertifications(company).slice(0, 3);
  return (
    <View className='catalog-company-card aim-card' hoverClass='catalog-company-card--pressed' onClick={() => onClick(company)}>
      <Image className='catalog-company-card__cover' src={company.cover} mode='aspectFill' lazyLoad />
      <View className='catalog-company-card__shade' />
      <View className='catalog-company-card__content'>
        <View className='catalog-company-card__verified'>企业优选</View>
        <Text className='catalog-company-card__name'>{company.name}</Text>
        <Text className='catalog-company-card__business'>{company.mainBusiness}</Text>
        <View className='catalog-company-card__meta'>
          <Text className='catalog-company-card__location'>{company.location}</Text>
          {company.distanceKm > 0 ? <Text className='catalog-company-card__distance'>{company.distanceKm.toFixed(1)} km</Text> : null}
        </View>
        {badges.length ? <View className='catalog-company-card__badges'>{badges.map((badge) => <Text className='catalog-company-card__badge' key={badge}>{badge}</Text>)}</View> : null}
      </View>
    </View>
  );
}
