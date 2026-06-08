import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { OrderItemRow } from '../cards/OrderItemRow';
import { OrderItem } from '../../types';

interface Props {
  companyName: string;
  items: OrderItem[];
  isVipPackage?: boolean;
  onContactSeller?: () => void;
  showAfterSaleAction?: boolean;
  onItemAfterSale?: (item: OrderItem) => void;
}

export function ShopGroup({ companyName, items, isVipPackage, onContactSeller, showAfterSaleAction, onItemAfterSale }: Props) {
  const { colors, typography } = useTheme();
  return (
    <View>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[typography.bodyStrong, { color: colors.text.primary, flex: 1 }]}>🏪 {companyName}</Text>
        {onContactSeller ? (
          <Pressable onPress={onContactSeller}>
            <Text style={[typography.caption, { color: colors.text.secondary }]}>联系卖家 ›</Text>
          </Pressable>
        ) : null}
      </View>
      {items.map((item) => (
        <OrderItemRow
          key={item.id}
          image={item.image}
          title={item.title}
          skuTitle={item.skuTitle}
          unitPrice={item.price}
          quantity={item.quantity}
          priceLabel={isVipPackage ? 'VIP礼包' : undefined}
          showAfterSaleAction={showAfterSaleAction && !item.isPrize}
          onAfterSale={() => onItemAfterSale?.(item)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, paddingBottom: 6, marginBottom: 4 },
});
