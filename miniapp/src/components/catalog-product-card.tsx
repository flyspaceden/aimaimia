import { Button, Image, Text, View } from '@tarojs/components';
import type { Product } from '@/types';
import { catalogStockText, formatCatalogPrice, resolveCatalogQuickAddAction, resolveProductStock } from './catalog-utils';
import './catalog-product-card.scss';

type Props = {
  product: Product;
  compact?: boolean;
  onClick: (product: Product) => void;
  onAdd?: (product: Product) => void;
  adding?: boolean;
};

export function CatalogProductCard({ product, compact = false, onClick, onAdd, adding = false }: Props) {
  const stockText = catalogStockText(resolveProductStock(product));
  const quickAdd = onAdd ? resolveCatalogQuickAddAction(product) : undefined;
  return (
    <View
      className={`catalog-product-card aim-card${compact ? ' catalog-product-card--compact' : ''}`}
      hoverClass='catalog-product-card--pressed'
      onClick={() => onClick(product)}
    >
      <View className='catalog-product-card__media'>
        <Image className='catalog-product-card__image' src={product.image} mode='aspectFill' lazyLoad />
        {product.type === 'BUNDLE' ? <Text className='catalog-product-card__bundle'>组合装</Text> : null}
      </View>
      <View className='catalog-product-card__body'>
        <Text className='catalog-product-card__title'>{product.title}</Text>
        <Text className='catalog-product-card__origin'>{product.origin || product.companyName || '优选产地'}</Text>
        <View className='catalog-product-card__footer'>
          <View className='catalog-product-card__price-row'>
            <Text className='catalog-product-card__currency'>¥</Text>
            <Text className='catalog-product-card__price'>{formatCatalogPrice(product.price)}</Text>
            {product.priceFrom ? <Text className='catalog-product-card__from'>起</Text> : null}
          </View>
          <View className='catalog-product-card__actions'>
            {stockText ? <Text className={stockText === '暂时缺货' ? 'catalog-product-card__stock catalog-product-card__stock--out' : 'catalog-product-card__stock'}>{stockText}</Text> : null}
            {quickAdd ? <Button
              className='catalog-product-card__quick-add'
              loading={adding}
              disabled={adding}
              onClick={(event) => {
                event.stopPropagation();
                onAdd?.(product);
              }}
            >{quickAdd.label}</Button> : null}
          </View>
        </View>
      </View>
    </View>
  );
}
