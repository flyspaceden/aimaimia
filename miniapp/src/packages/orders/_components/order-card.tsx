import { Button, Image, Text, View } from '@tarojs/components';
import type { Order } from '@/types';
import { formatMoney, formatOrderTime, orderStatusMeta, shortOrderNo } from './order-utils';
import './order-shared.scss';

type Props = {
  order: Order;
  busy?: boolean;
  onOpen: () => void;
  onTrack?: () => void;
  onConfirm?: () => void;
  onRepurchase?: () => void;
  onCancel?: () => void;
  onPickupPass?: () => void;
};

export function MiniOrderCard({ order, busy, onOpen, onTrack, onConfirm, onRepurchase, onCancel, onPickupPass }: Props) {
  const meta = orderStatusMeta(order);
  const preview = order.items.slice(0, 3);
  const quantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
  return <View className='mini-order-card aim-card'>
    <View className='mini-order-card__head' onClick={onOpen}>
      <View><Text className='mini-order-card__no'>订单 {shortOrderNo(order.id)}</Text><Text className='mini-order-card__time'>{formatOrderTime(order.createdAt)}</Text></View>
      <Text className={`mini-order-status mini-order-status--${meta.tone}`}>{meta.label}</Text>
    </View>
    <View className='mini-order-card__items' onClick={onOpen}>{preview.map((item) => <View className='mini-order-card__item' key={item.id}><Image className='mini-order-card__image' src={item.image || ''} mode='aspectFill' /><View className='mini-order-card__item-copy'><Text className='mini-order-card__title'>{item.title}</Text><Text className='mini-order-card__sku'>{item.isPrize ? '赠品' : item.skuTitle || '默认规格'} · ×{item.quantity}</Text></View><Text className='mini-order-card__unit-price'>{order.bizType === 'VIP_PACKAGE' ? '赠品' : `¥${formatMoney(item.price)}`}</Text></View>)}</View>
    {order.items.length > preview.length ? <Text className='mini-order-card__more'>还有 {order.items.length - preview.length} 种商品，点击查看全部</Text> : null}
    {order.status === 'PENDING_PAYMENT' ? <View className='mini-order-history-note'>历史待支付记录仅供查看，不恢复旧支付</View> : null}
    {order.fulfillmentMode === 'PICKUP' ? order.pickupFulfillment
      ? <View className='mini-order-pickup-note'><Text>{order.pickupFulfillment.pickupPoint.name}</Text><Text>{order.pickupFulfillment.pickupPoint.regionText} {order.pickupFulfillment.pickupPoint.detail}</Text></View>
      : <View className='mini-order-pickup-note'><Text>自提信息暂不可用</Text><Text>请联系订单客服处理，系统不会将本单改按快递展示。</Text></View>
      : null}
    <View className='mini-order-card__total'><Text>共 {quantity} 件</Text><Text>实付 <Text className='mini-order-card__amount'>¥{formatMoney(order.totalPrice)}</Text></Text></View>
    {onCancel || onTrack || onConfirm || onRepurchase || onPickupPass ? <View className='mini-order-actions'>
      {onCancel ? <Button className='mini-order-action mini-order-action--danger' disabled={busy} onClick={onCancel}>{busy ? '处理中...' : '取消订单'}</Button> : null}
      {onTrack ? <Button className='mini-order-action' onClick={onTrack}>查看物流</Button> : null}
      {onConfirm ? <Button className='mini-order-action mini-order-action--primary' disabled={busy} onClick={onConfirm}>{busy ? '处理中...' : '确认收货'}</Button> : null}
      {onPickupPass ? <Button className='mini-order-action mini-order-action--primary' onClick={onPickupPass}>查看取货码</Button> : null}
      {onRepurchase ? <Button className='mini-order-action mini-order-action--primary' disabled={busy} onClick={onRepurchase}>{busy ? '加入中...' : '再次购买'}</Button> : null}
    </View> : null}
  </View>;
}
