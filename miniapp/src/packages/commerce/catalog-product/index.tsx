import { Button, Image, Swiper, SwiperItem, Text, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { catalogStockText, defaultSelectedSkuId, formatCatalogPrice, productHeadlinePrice } from '@/components/catalog-utils';
import { queryClient } from '@/query/client';
import { CartRepo, CompanyRepo, ProductRepo } from '@/repos';
import { useAuthStore } from '@/store/auth';
import type { ProductDetail } from '@/types';
import './index.scss';

export default function CatalogProductPage() {
  const router = useRouter();
  const id = typeof router.params.id === 'string' ? router.params.id : '';
  const [selectedSkuId, setSelectedSkuId] = useState<string>();
  const [quantity, setQuantity] = useState(1);
  const [slide, setSlide] = useState(0);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const productQuery = useQuery({ queryKey: ['catalog', 'product', id], queryFn: () => ProductRepo.getById(id), enabled: Boolean(id), staleTime: 5 * 60_000 });
  const detail = productQuery.data?.ok ? productQuery.data.data : undefined;
  const companyQuery = useQuery({ queryKey: ['catalog', 'company', detail?.companyId], queryFn: () => CompanyRepo.getById(detail!.companyId!), enabled: Boolean(detail?.companyId), staleTime: 5 * 60_000 });

  useEffect(() => { if (detail) setSelectedSkuId(defaultSelectedSkuId(detail)); }, [detail]);
  const selectedSku = useMemo(() => detail?.skus.find((sku) => sku.id === selectedSkuId), [detail, selectedSkuId]);
  const stock = detail ? (detail.type === 'BUNDLE' ? detail.bundleAvailableStock ?? selectedSku?.stock : selectedSku?.stock) : undefined;
  const stockText = catalogStockText(stock);
  const maxQuantity = Math.max(1, Math.min(stock ?? Number.MAX_SAFE_INTEGER, selectedSku?.maxPerOrder ?? detail?.maxPerOrder ?? Number.MAX_SAFE_INTEGER));
  const needsSku = Boolean(detail?.skus.length && !selectedSku);
  const canAdd = Boolean(detail && selectedSkuId && !needsSku && (stock === undefined || stock > 0));
  const headline = detail ? productHeadlinePrice(detail, selectedSkuId) : undefined;
  const images = detail ? (detail.images.length ? detail.images.map((item) => item.url) : [detail.image].filter(Boolean)) : [];
  const company = companyQuery.data?.ok ? companyQuery.data.data : undefined;

  useEffect(() => { if (quantity > maxQuantity) setQuantity(maxQuantity); }, [maxQuantity, quantity]);
  const addMutation = useMutation({
    mutationFn: () => CartRepo.addItem(selectedSkuId!, quantity),
    onSuccess: async (result) => {
      if (!result.ok) { Taro.showToast({ title: result.error.displayMessage || '加入购物车失败', icon: 'none' }); return; }
      await queryClient.invalidateQueries({ queryKey: ['commerce', 'cart'] });
      Taro.showToast({ title: '已加入购物车', icon: 'success' });
    },
    onError: () => Taro.showToast({ title: '网络开小差了，请重试', icon: 'none' }),
  });
  const addToCart = () => {
    if (!loggedIn) {
      const returnUrl = `/packages/commerce/catalog-product/index?id=${encodeURIComponent(id)}`;
      void Taro.navigateTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(returnUrl)}` });
      return;
    }
    if (needsSku) { Taro.showToast({ title: '请选择规格', icon: 'none' }); return; }
    if (!canAdd) { Taro.showToast({ title: '商品暂无库存', icon: 'none' }); return; }
    addMutation.mutate();
  };
  const buyNow = () => {
    const returnUrl = `/packages/commerce/catalog-product/index?id=${encodeURIComponent(id)}`;
    if (!loggedIn) {
      void Taro.navigateTo({ url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(returnUrl)}` });
      return;
    }
    if (needsSku) { Taro.showToast({ title: '请选择规格', icon: 'none' }); return; }
    if (!canAdd || !selectedSkuId) { Taro.showToast({ title: '商品暂无库存', icon: 'none' }); return; }
    const checkoutUrl = `/packages/commerce/checkout/index?buyNowProductId=${encodeURIComponent(id)}&buyNowSkuId=${encodeURIComponent(selectedSkuId)}&buyNowQuantity=${quantity}`;
    void Taro.navigateTo({ url: checkoutUrl });
  };

  if (productQuery.isLoading) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  if (!id || !productQuery.data || !productQuery.data.ok) return <View className='aim-page'><CatalogFeedback kind='error' title='商品加载失败' description={productQuery.data && !productQuery.data.ok ? productQuery.data.error.displayMessage : '商品信息不完整'} onRetry={() => productQuery.refetch()} /></View>;

  const product = detail as ProductDetail;
  return (
    <View className='catalog-product-page'>
      <View className='catalog-product-gallery'>
        <Swiper className='catalog-product-gallery__swiper' circular={images.length > 1} indicatorDots={false} onChange={(event) => setSlide(event.detail.current)}>
          {images.map((url, index) => <SwiperItem key={`${url}-${index}`}><Image className='catalog-product-gallery__image' src={url} mode='aspectFill' /></SwiperItem>)}
        </Swiper>
        {images.length > 1 ? <Text className='catalog-product-gallery__count'>{slide + 1}/{images.length}</Text> : null}
        {product.type === 'BUNDLE' ? <Text className='catalog-product-gallery__bundle'>组合商品</Text> : null}
      </View>
      <View className='catalog-product-content'>
        <View className='catalog-product-price aim-card'>
          <View className='catalog-product-price__line'><Text className='catalog-product-price__currency'>¥</Text><Text className='catalog-product-price__value'>{formatCatalogPrice(headline!.value)}</Text>{headline!.from ? <Text className='catalog-product-price__from'>起</Text> : null}{product.strikePrice ? <Text className='catalog-product-price__strike'>¥{formatCatalogPrice(product.strikePrice)}</Text> : null}</View>
          <View className='catalog-product-price__stats'>{product.monthlySales ? <Text>月销 {product.monthlySales}</Text> : null}{product.rating ? <Text>好评 {product.rating}%</Text> : null}</View>
          <Text className='catalog-product-price__policy'>{product.effectiveReturnPolicy === 'NON_RETURNABLE' ? '签收后24小时内如有质量问题可申请售后' : '支持7天无理由退换 · 质量问题可申请售后'}</Text>
        </View>
        <View className='catalog-product-intro'>
          <Text className='catalog-product-intro__title'>{product.title}</Text>
          {product.subtitle ? <Text className='catalog-product-intro__subtitle'>{product.subtitle}</Text> : null}
          <Text className='catalog-product-intro__origin'>{product.origin || '优选产地'}</Text>
          {product.tags?.length ? <View className='catalog-product-tags'>{product.tags.map((tag) => <Text className='catalog-product-tag' key={tag}>{tag}</Text>)}</View> : null}
        </View>

        {product.skus.length ? <View className='catalog-product-section aim-card'>
          <Text className='catalog-product-section__title'>规格选择</Text>
          <View className='catalog-product-skus'>{product.skus.map((sku) => {
            const skuStock = product.type === 'BUNDLE' ? product.bundleAvailableStock ?? sku.stock : sku.stock;
            const active = sku.id === selectedSkuId;
            return <View className={active ? 'catalog-product-sku catalog-product-sku--active' : 'catalog-product-sku'} key={sku.id} onClick={() => { setSelectedSkuId(sku.id); setQuantity(1); }}><Text className='catalog-product-sku__title'>{sku.title}</Text><Text className='catalog-product-sku__meta'>¥{formatCatalogPrice(sku.price)} {catalogStockText(skuStock) ? `· ${catalogStockText(skuStock)}` : ''}</Text></View>;
          })}</View>
          {selectedSku?.maxPerOrder ? <Text className='catalog-product-section__tip'>每单限购 {selectedSku.maxPerOrder} 件</Text> : null}
          {stockText ? <Text className={stock && stock > 0 ? 'catalog-product-section__stock' : 'catalog-product-section__stock catalog-product-section__stock--out'}>{stockText}</Text> : null}
        </View> : null}

        {product.type === 'BUNDLE' && product.bundleItems?.length ? <View className='catalog-product-section aim-card'>
          <View className='catalog-product-section__heading'><Text className='catalog-product-section__accent' /><Text className='catalog-product-section__title'>组合内容</Text></View>
          {product.bundleItems.map((item, index) => <View className={index ? 'catalog-bundle-row catalog-bundle-row--divided' : 'catalog-bundle-row'} key={`${item.skuId}-${index}`}>
            {item.image ? <Image className='catalog-bundle-row__image' src={item.image} mode='aspectFill' /> : <View className='catalog-bundle-row__placeholder'>礼</View>}
            <View className='catalog-bundle-row__copy'><Text className='catalog-bundle-row__title'>{item.productTitle}</Text><Text className='catalog-bundle-row__sku'>{item.skuTitle}</Text></View><Text className='catalog-bundle-row__quantity'>×{item.quantity}</Text>
          </View>)}
        </View> : null}

        {company ? <View className='catalog-product-company aim-card' onClick={() => Taro.navigateTo({ url: `/packages/commerce/catalog-company/index?id=${encodeURIComponent(company.id)}` })}>
          <Image className='catalog-product-company__image' src={company.cover} mode='aspectFill' />
          <View className='catalog-product-company__copy'><Text className='catalog-product-company__label'>企业优选</Text><Text className='catalog-product-company__name'>{company.name}</Text><Text className='catalog-product-company__business'>{company.mainBusiness}</Text></View><Text className='catalog-product-company__arrow'>›</Text>
        </View> : null}

        {(product.description || Object.keys(product.attributes ?? {}).length) ? <View className='catalog-product-section aim-card'>
          <View className='catalog-product-section__heading'><Text className='catalog-product-section__accent' /><Text className='catalog-product-section__title'>商品详情</Text></View>
          {product.description ? <Text className='catalog-product-description'>{product.description}</Text> : null}
          {Object.entries(product.attributes ?? {}).map(([label, value]) => <View className='catalog-product-attribute' key={label}><Text>{label}</Text><Text>{value}</Text></View>)}
        </View> : null}
      </View>
      <View className='catalog-product-bar'>
        <View className='catalog-product-cart-entry' onClick={() => Taro.navigateTo({ url: '/packages/commerce/cart/index' })}><Text className='catalog-product-cart-entry__icon'>购</Text><Text>购物车</Text></View>
        <View className='catalog-product-quantity'><Text className={quantity <= 1 ? 'catalog-product-quantity__button catalog-product-quantity__button--disabled' : 'catalog-product-quantity__button'} onClick={() => setQuantity((value) => Math.max(1, value - 1))}>−</Text><Text className='catalog-product-quantity__value'>{quantity}</Text><Text className={quantity >= maxQuantity ? 'catalog-product-quantity__button catalog-product-quantity__button--disabled' : 'catalog-product-quantity__button'} onClick={() => setQuantity((value) => Math.min(maxQuantity, value + 1))}>+</Text></View>
        <View className='catalog-product-bar__actions'><Button className={canAdd ? 'catalog-product-bar__button catalog-product-bar__button--cart' : 'catalog-product-bar__button catalog-product-bar__button--disabled'} disabled={!canAdd || addMutation.isPending} loading={addMutation.isPending} onClick={addToCart}>{needsSku ? '请选规格' : !selectedSkuId ? '暂不可购买' : stock === 0 ? '暂时缺货' : '加入购物车'}</Button><Button className={canAdd ? 'catalog-product-bar__button catalog-product-bar__button--buy' : 'catalog-product-bar__button catalog-product-bar__button--disabled'} disabled={!canAdd} onClick={buyNow}>{!loggedIn ? '登录后购买' : '立即购买'}</Button></View>
      </View>
    </View>
  );
}
