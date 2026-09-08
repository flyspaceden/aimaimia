import { Alert, Linking, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { openPickupLocation } from '../openPickupLocation';

jest.mock('react-native', () => ({ Alert: { alert: jest.fn() }, Linking: { openURL: jest.fn() }, Platform: { OS: 'ios' } }));

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(undefined) }));

const point = { name: '中心仓', regionText: '广东省深圳市', detail: '农业路 1 号', location: { lng: 114, lat: 22, provider: 'unknown' } };

describe('自提点地图地址搜索', () => {
  afterEach(() => jest.restoreAllMocks());
  it('未知坐标来源按地址搜索，不将未知坐标直接传给地图', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await openPickupLocation(point);
    const url = open.mock.calls[0][0];
    expect(decodeURIComponent(url)).toContain('广东省深圳市 农业路 1 号 中心仓');
    expect(url).not.toContain('114');
    expect(url).toContain(Platform.OS === 'ios' ? 'maps.apple.com' : 'uri.amap.com');
  });
  it('无法打开地图时提供复制地址兜底', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('unavailable'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await openPickupLocation(point);
    const copy = alert.mock.calls[0][2]?.find((button) => button.text === '复制地址');
    copy?.onPress?.();
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('广东省深圳市 农业路 1 号');
  });
});

it('handles clipboard rejection after navigation fails', async () => {
  jest.clearAllMocks();
  (Linking.openURL as jest.Mock).mockRejectedValue(new Error('no map'));
  (Clipboard.setStringAsync as jest.Mock).mockRejectedValue(new Error('clipboard unavailable'));
  await openPickupLocation({ name: '中心仓', regionText: '市区', detail: '路1号' });
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
  await buttons.find((button: { text: string }) => button.text === '复制地址').onPress();
  expect(Alert.alert).toHaveBeenLastCalledWith('复制失败', '请手动记录自提地址');
});
