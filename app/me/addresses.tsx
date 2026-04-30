import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader, Screen } from '../../src/components/layout';
import { EmptyState, ErrorState, Skeleton, useToast } from '../../src/components/feedback';
import { AddressRepo } from '../../src/repos';
import { useAuthStore, useCheckoutStore } from '../../src/store';
import { useTheme } from '../../src/theme';
import { Address } from '../../src/types';

type FormData = {
  receiverName: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
};

const emptyForm: FormData = { receiverName: '', phone: '', province: '', city: '', district: '', detail: '' };

export default function AddressesScreen() {
  const { colors, radius, shadow, spacing, typography } = useTheme();
  const { show } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const setSelectedAddress = useCheckoutStore((state) => state.setSelectedAddress);
  // 支持从其他页面（如 checkout-address）带 openNew=1 参数直达新增表单，避免多一跳列表
  const params = useLocalSearchParams<{ openNew?: string }>();
  const [editing, setEditing] = useState<string | null>(null); // 'new' 或 address id
  const [form, setForm] = useState<FormData>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  // 标记用户是从 checkout-address 经 openNew=1 跳来：保存成功后应回到确认订单页，
  // 表单返回/取消则回到选择地址页，避免落到本页列表态。
  const cameFromCheckoutRef = useRef(false);

  // 进入页面时若带 openNew=1 自动进表单态（仅触发一次，不依赖 params 持续更新）
  useEffect(() => {
    if (params.openNew === '1') {
      setForm(emptyForm);
      setEditing('new');
      cameFromCheckoutRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['addresses'],
    queryFn: () => AddressRepo.list(),
    enabled: isLoggedIn,
  });

  const addresses = data?.ok ? data.data : [];
  const error = data && !data.ok ? data.error : null;

  const openNew = () => {
    setForm(emptyForm);
    setEditing('new');
  };

  const openEdit = (addr: Address) => {
    setForm({
      receiverName: addr.receiverName,
      phone: addr.phone,
      province: addr.province,
      city: addr.city,
      district: addr.district,
      detail: addr.detail,
    });
    setEditing(addr.id);
  };

  const validate = (): string | null => {
    if (!form.receiverName.trim()) return '请输入收货人姓名';
    if (!form.phone.trim() || form.phone.trim().length < 11) return '请输入正确的手机号';
    if (!form.province.trim()) return '请输入省份';
    if (!form.city.trim()) return '请输入城市';
    if (!form.district.trim()) return '请输入区县';
    if (!form.detail.trim()) return '请输入详细地址';
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) { show({ message: err, type: 'error' }); return; }
    setSubmitting(true);
    const result = editing === 'new'
      ? await AddressRepo.create(form)
      : await AddressRepo.update(editing!, form);
    setSubmitting(false);
    if (!result.ok) {
      show({ message: result.error.displayMessage ?? '保存失败', type: 'error' });
      return;
    }
    show({ message: editing === 'new' ? '添加成功' : '修改成功', type: 'success' });
    queryClient.invalidateQueries({ queryKey: ['addresses'] });
    // 用户从 checkout-address 经 openNew=1 跳来 → 直接回确认订单页；
    // 否则正常关掉表单回到地址列表
    if (cameFromCheckoutRef.current) {
      cameFromCheckoutRef.current = false;
      // 把刚创建的地址写入 checkout store 自动选中，避免用户回结算页后还要再点一次
      // （仅新建有效；编辑场景不动 store，因为可能是其他地址被编辑而非当前选中的）
      if (editing === 'new' && result.ok && result.data?.id) {
        setSelectedAddress(result.data.id);
      }
      router.dismiss(2);
    } else {
      setEditing(null);
    }
  };

  const handleFormBack = () => {
    if (cameFromCheckoutRef.current) {
      cameFromCheckoutRef.current = false;
      router.back();
      return;
    }
    setEditing(null);
  };

  const handleDelete = (id: string) => {
    Alert.alert('确认删除', '删除后不可恢复', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          const result = await AddressRepo.remove(id);
          if (!result.ok) { show({ message: '删除失败', type: 'error' }); return; }
          show({ message: '已删除', type: 'success' });
          queryClient.invalidateQueries({ queryKey: ['addresses'] });
        },
      },
    ]);
  };

  const handleSetDefault = async (id: string) => {
    const result = await AddressRepo.setDefault(id);
    if (!result.ok) { show({ message: '设置失败', type: 'error' }); return; }
    show({ message: '已设为默认', type: 'success' });
    queryClient.invalidateQueries({ queryKey: ['addresses'] });
  };

  // 表单编辑界面
  if (editing) {
    return (
      <Screen contentStyle={{ flex: 1 }} keyboardAvoiding>
        <AppHeader
          title={editing === 'new' ? '新增地址' : '编辑地址'}
          onBack={handleFormBack}
        />
        {/* ScrollView 让区县/详细地址等底部字段在键盘弹起时能滚到可视区上方
            paddingBottom 用 insets.bottom + 200 动态适配带手势条/虚拟键的机型 */}
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 200 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {[
            { key: 'receiverName', label: '收货人', placeholder: '请输入姓名' },
            { key: 'phone', label: '手机号', placeholder: '请输入手机号', keyboardType: 'phone-pad' as const },
            { key: 'province', label: '省份', placeholder: '如：浙江省' },
            { key: 'city', label: '城市', placeholder: '如：杭州市' },
            { key: 'district', label: '区县', placeholder: '如：西湖区' },
            { key: 'detail', label: '详细地址', placeholder: '街道/小区/门牌号' },
          ].map((field) => (
            <View key={field.key} style={{ marginBottom: spacing.lg }}>
              <Text style={[typography.bodyStrong, { color: colors.text.primary, marginBottom: 6 }]}>
                {field.label}
              </Text>
              <TextInput
                value={(form as any)[field.key]}
                onChangeText={(v) => setForm({ ...form, [field.key]: v })}
                placeholder={field.placeholder}
                placeholderTextColor={colors.muted}
                keyboardType={(field as any).keyboardType}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    color: colors.text.primary,
                    ...typography.body,
                  },
                ]}
              />
            </View>
          ))}

          {/* 保存按钮 — 渐变 */}
          <Pressable onPress={handleSave} disabled={submitting}>
            <LinearGradient
              colors={submitting ? [colors.border, colors.border] : [colors.brand.primary, colors.ai.start]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.saveButton, { borderRadius: radius.pill }]}
            >
              <Text style={[typography.bodyStrong, { color: submitting ? colors.text.secondary : colors.text.inverse }]}>
                {submitting ? '保存中...' : '保存地址'}
              </Text>
            </LinearGradient>
          </Pressable>
        </ScrollView>
      </Screen>
    );
  }

  // 地址列表界面
  return (
    <Screen contentStyle={{ flex: 1 }}>
      <AppHeader
        title="收货地址"
        rightSlot={
          <Pressable onPress={openNew} hitSlop={10} style={{ padding: 8 }}>
            <MaterialCommunityIcons name="plus" size={22} color={colors.brand.primary} />
          </Pressable>
        }
      />
      {isLoading ? (
        <View style={{ padding: spacing.xl }}>
          <Skeleton height={80} radius={radius.lg} style={{ marginBottom: spacing.md }} />
          <Skeleton height={80} radius={radius.lg} />
        </View>
      ) : error ? (
        <ErrorState title="地址加载失败" description="请稍后重试" onAction={() => refetch()} />
      ) : addresses.length === 0 ? (
        <EmptyState
          title="暂无收货地址"
          description="添加一个收货地址以便下单"
          actionLabel="添加地址"
          onAction={openNew}
        />
      ) : (
        <FlatList
          data={addresses}
          keyExtractor={(item) => item.id}
          initialNumToRender={6}
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing['3xl'] }}
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.duration(300).delay(50 + index * 30)}>
              <Pressable
                onPress={() => openEdit(item)}
                style={[
                  styles.card,
                  shadow.md,
                  {
                    backgroundColor: colors.surface,
                    borderRadius: radius.lg,
                    overflow: 'hidden',
                  },
                ]}
              >
                {/* 默认地址左侧渐变高亮 */}
                {item.isDefault ? (
                  <LinearGradient
                    colors={[colors.brand.primary, colors.ai.start]}
                    style={styles.defaultIndicator}
                  />
                ) : null}
                <View style={[styles.cardContent, { paddingLeft: item.isDefault ? 14 : 14 }]}>
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <View style={styles.nameRow}>
                        <Text style={[typography.bodyStrong, { color: colors.text.primary }]}>
                          {item.receiverName}
                        </Text>
                        <Text style={[typography.caption, { color: colors.text.secondary, marginLeft: 12 }]}>
                          {item.phone}
                        </Text>
                        {item.isDefault ? (
                          <View style={[styles.defaultBadge, { backgroundColor: colors.brand.primarySoft }]}>
                            <Text style={[typography.caption, { color: colors.brand.primary }]}>默认</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text
                        style={[typography.caption, { color: colors.text.secondary, marginTop: 4 }]}
                        numberOfLines={2}
                      >
                        {item.province}{item.city}{item.district} {item.detail}
                      </Text>
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={20} color={colors.text.secondary} />
                  </View>
                  <View style={[styles.cardActions, { borderTopColor: colors.border }]}>
                    {!item.isDefault ? (
                      <Pressable onPress={() => handleSetDefault(item.id)} style={styles.actionBtn}>
                        <MaterialCommunityIcons name="star-outline" size={16} color={colors.accent.blue} />
                        <Text style={[typography.caption, { color: colors.accent.blue, marginLeft: 4 }]}>
                          设为默认
                        </Text>
                      </Pressable>
                    ) : (
                      <View />
                    )}
                    <Pressable onPress={() => handleDelete(item.id)} style={styles.actionBtn}>
                      <MaterialCommunityIcons name="delete-outline" size={16} color={colors.danger} />
                      <Text style={[typography.caption, { color: colors.danger, marginLeft: 4 }]}>删除</Text>
                    </Pressable>
                  </View>
                </View>
              </Pressable>
            </Animated.View>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 12,
    flexDirection: 'row',
  },
  defaultIndicator: {
    width: 2,
  },
  cardContent: {
    flex: 1,
    padding: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  defaultBadge: {
    marginLeft: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  saveButton: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
});
