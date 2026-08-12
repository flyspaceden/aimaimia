import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import './index.scss';

type MiniProgramInfo = { version: string; envVersion: string };
function accountInfo(): MiniProgramInfo {
  try {
    const info = Taro.getAccountInfoSync();
    return { version: info.miniProgram.version || '未发布', envVersion: info.miniProgram.envVersion || 'develop' };
  } catch { return { version: '未发布', envVersion: 'develop' }; }
}

const ENV_LABELS: Record<string, string> = { release: '正式版', trial: '体验版', develop: '开发版' };

export default function AboutPage() {
  const info = accountInfo();
  return <View className='about-page'>
    <View className='about-brand'><View className='about-brand__seal'>爱</View><Text>AI爱买买</Text><Text>AI 赋能农业电商平台</Text><Text>让每一份源头好物，更容易被看见。</Text></View>
    <View className='about-ledger aim-card'><View><Text>小程序版本</Text><Text>{info.version}</Text></View><View><Text>当前环境</Text><Text>{ENV_LABELS[info.envVersion] || info.envVersion}</Text></View><View><Text>版本机制</Text><Text>由微信小程序发布管理</Text></View></View>
    <View className='about-copy'><Text>与 App 的区别</Text><Text>小程序不使用 Expo Runtime 或 App OTA 版本。这里显示的是微信账号信息中的小程序版本与环境，不会把 App 版本号冒充为小程序版本。</Text></View>
    <View className='about-contact aim-card'><View onClick={() => Taro.setClipboardData({ data: 'zwf@huahainongke.com' })}><Text>联系邮箱</Text><Text>zwf@huahainongke.com · 点击复制</Text></View><View><Text>备案信息</Text><Text>粤ICP备2023047684号-6A</Text></View></View>
    <Text className='about-copyright'>© 2026 AI爱买买. All rights reserved.</Text>
  </View>;
}
