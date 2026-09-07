import { Alert, Linking, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';

/** Search by address: point providers do not yet guarantee a coordinate system. */
export async function openPickupLocation(point: {
  name: string;
  regionText: string;
  detail: string;
  location?: unknown;
}): Promise<void> {
  const address = `${point.regionText} ${point.detail}`.trim();
  const query = encodeURIComponent(`${address} ${point.name}`.trim());
  const url = Platform.OS === 'ios'
    ? `https://maps.apple.com/?q=${query}`
    : `https://uri.amap.com/search?keyword=${query}&callnative=0`;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('无法打开地图', address || point.name, [
      { text: '取消', style: 'cancel' },
      { text: '复制地址', onPress: () => { void Clipboard.setStringAsync(address || point.name); } },
    ]);
  }
}
