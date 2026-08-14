import { Input, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import type { FulfillmentMode, PickupPoint, PickupPointGroup } from '@/types';
import {
  formatPickupBusinessHours,
  isPickupRecipientValid,
  type PickupSelectionMap,
} from './pickup-utils';
import './pickup-fulfillment.scss';

export function FulfillmentModeSwitch({
  mode,
  onChange,
  pickupAvailable = true,
}: {
  mode: FulfillmentMode;
  onChange: (mode: FulfillmentMode) => void;
  pickupAvailable?: boolean;
}) {
  return <View className='pickup-mode-card aim-card'>
    <View className='pickup-mode-card__heading'><Text>履约方式</Text><Text>配送与自提二选一</Text></View>
    <View className='pickup-mode-switch' role='radiogroup'>
      <View className={mode === 'DELIVERY' ? 'pickup-mode-option pickup-mode-option--active' : 'pickup-mode-option'} onClick={() => onChange('DELIVERY')}>
        <Text className='pickup-mode-option__mark'>送</Text><View><Text>送货上门</Text><Text>平台统一安排顺丰配送</Text></View>
      </View>
      <View className={mode === 'PICKUP' ? 'pickup-mode-option pickup-mode-option--active' : 'pickup-mode-option'} onClick={() => { if (pickupAvailable) onChange('PICKUP'); }}>
        <Text className='pickup-mode-option__mark'>取</Text><View><Text>到店自提</Text><Text>{pickupAvailable ? '免运费，备好后凭码取货' : '暂无可用自提点'}</Text></View>
      </View>
    </View>
  </View>;
}

async function openPickupPoint(point: PickupPoint) {
  const location = point.location;
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
    Taro.showToast({ title: '门店暂未配置地图位置', icon: 'none' });
    return;
  }
  await Taro.openLocation({
    latitude: location.lat,
    longitude: location.lng,
    name: location.poiName || point.name,
    address: `${point.regionText} ${point.detail}`.trim(),
  });
}

export function PickupSelectionPanel({
  groups,
  selections,
  recipientName,
  recipientPhone,
  onRecipientNameChange,
  onRecipientPhoneChange,
  onSelect,
  loading,
  error,
  onRetry,
}: {
  groups: PickupPointGroup[];
  selections: PickupSelectionMap;
  recipientName: string;
  recipientPhone: string;
  onRecipientNameChange: (value: string) => void;
  onRecipientPhoneChange: (value: string) => void;
  onSelect: (companyId: string, pickupPointId: string) => void;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  const recipientValid = isPickupRecipientValid(recipientName, recipientPhone);
  return <View className='pickup-selection aim-card'>
    <View className='pickup-selection__headline'><View><Text>到店自提</Text><Text>取货信息只用于本次订单</Text></View><Text>{groups.length > 1 ? `需前往 ${groups.length} 个地点` : '免运费'}</Text></View>
    <View className='pickup-recipient'>
      <View><Text>自提人</Text><Input value={recipientName} maxlength={20} placeholder='请输入真实姓名' onInput={(event) => onRecipientNameChange(event.detail.value)} /></View>
      <View><Text>手机号</Text><Input type='number' value={recipientPhone} maxlength={11} placeholder='接收备货通知' onInput={(event) => onRecipientPhoneChange(event.detail.value)} /></View>
      {!recipientValid && (recipientName || recipientPhone) ? <Text className='pickup-recipient__error'>请填写至少 2 个字的姓名和 11 位手机号</Text> : null}
    </View>
    {loading ? <Text className='pickup-selection__state'>正在查找商家自提点...</Text> : null}
    {error ? <View className='pickup-selection__error' onClick={onRetry}><Text>{error}</Text><Text>重新加载 ›</Text></View> : null}
    {!loading && !error && !groups.length ? <Text className='pickup-selection__state'>当前商品暂无可用自提点，请选择送货上门</Text> : null}
    {groups.map((group) => <View className='pickup-merchant' key={group.companyId}>
      <View className='pickup-merchant__heading'><Text>{group.companyName || '商家自提点'}</Text><Text>{group.points.length ? `${group.points.length} 个可选` : '暂无可用点'}</Text></View>
      {group.points.map((point) => {
        const selected = selections[group.companyId] === point.id;
        return <View className={selected ? 'pickup-point pickup-point--active' : 'pickup-point'} key={point.id} onClick={() => onSelect(group.companyId, point.id)}>
          <View className='pickup-point__radio'>{selected ? '✓' : ''}</View>
          <View className='pickup-point__body'>
            <View className='pickup-point__title'><Text>{point.name}</Text><Text onClick={(event) => { event.stopPropagation(); void openPickupPoint(point); }}>导航</Text></View>
            <Text className='pickup-point__address'>{point.regionText} {point.detail}</Text>
            <Text className='pickup-point__hours'>{formatPickupBusinessHours(point.businessHours)}</Text>
            {point.pickupNotice ? <Text className='pickup-point__notice'>{point.pickupNotice}</Text> : null}
          </View>
        </View>;
      })}
    </View>)}
  </View>;
}
