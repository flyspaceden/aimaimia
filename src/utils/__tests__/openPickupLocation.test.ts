/// <reference types="jest" />
jest.mock('react-native', () => ({ Alert: { alert: jest.fn() }, Linking: { openURL: jest.fn() }, Platform: { OS: 'android' } }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
import { Alert, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { openPickupLocation } from '../openPickupLocation';
it('handles clipboard rejection after navigation fails', async () => {
  (Linking.openURL as jest.Mock).mockRejectedValue(new Error('no map'));
  (Clipboard.setStringAsync as jest.Mock).mockRejectedValue(new Error('clipboard unavailable'));
  await openPickupLocation({ name: '中心仓', regionText: '市区', detail: '路1号' });
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
  await buttons.find((button: { text: string }) => button.text === '复制地址').onPress();
  expect(Alert.alert).toHaveBeenLastCalledWith('复制失败', '请手动记录自提地址');
});
