import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useQuery } from '@tanstack/react-query';
import { CatalogFeedback } from '@/components/catalog-feedback';
import { logoutMiniapp } from '@/platform/auth';
import { MiniSubscriptionRepo, requestMiniProgramSubscriptions, type MiniSubscriptionKey } from '@/platform/subscriptions';
import { useAuthStore } from '@/store/auth';
import './index.scss';

type SettingRowProps = { mark: string; title: string; description: string; onClick: () => void; muted?: boolean };
function SettingRow({ mark, title, description, onClick, muted }: SettingRowProps) {
  return <View className={muted ? 'settings-row settings-row--muted' : 'settings-row'} onClick={onClick}><View className='settings-row__mark'>{mark}</View><View className='settings-row__copy'><Text>{title}</Text><Text>{description}</Text></View><Text className='settings-row__arrow'>›</Text></View>;
}

export default function SettingsPage() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const loggedIn = useAuthStore((state) => Boolean(state.accessToken));
  const authRevision = useAuthStore((state) => state.revision);
  const templatesQuery = useQuery({
    queryKey: ['mini-program', 'subscription-templates', authRevision],
    queryFn: MiniSubscriptionRepo.templates,
    enabled: hydrated && loggedIn,
  });
  const requestReminder = async (key: MiniSubscriptionKey) => {
    const templates = templatesQuery.data?.ok ? templatesQuery.data.data : undefined;
    if (!templates) {
      await Taro.showToast({ title: '提醒配置尚未加载，请稍后重试', icon: 'none' });
      return;
    }
    const result = await requestMiniProgramSubscriptions([key], templates);
    await Taro.showToast({
      title: result.ok && result.data.accepted.length ? '一次提醒已授权' : result.ok ? '本次未授权' : result.error.displayMessage || '订阅失败',
      icon: 'none',
    });
    void templatesQuery.refetch();
  };
  const openWechatSettings = async () => {
    try { await Taro.openSetting(); } catch { await Taro.showToast({ title: '请在微信的小程序设置中管理权限', icon: 'none' }); }
  };
  const logout = async () => {
    const modal = await Taro.showModal({ title: '退出登录', content: '仅退出当前小程序设备，不会注销账号。', confirmText: '退出', confirmColor: '#A04B42' });
    if (!modal.confirm) return;
    await logoutMiniapp();
    await Taro.switchTab({ url: '/pages/home/index' });
  };
  if (!hydrated) return <View className='aim-page'><CatalogFeedback kind='loading' /></View>;
  return <View className='settings-page'>
    <View className='settings-intro'><Text>小程序服务手册</Text><Text>账号与 App 共用，微信权限则由当前设备单独管理。</Text></View>
    <View className='settings-heading'><Text>账号</Text><Text>{loggedIn ? '已登录' : '未登录'}</Text></View>
    <View className='settings-card aim-card'>
      <SettingRow mark='锁' title='账号与安全' description='登录身份、修改密码、注销账号' onClick={() => Taro.navigateTo({ url: '/packages/account/account-security/index' })} />
      <SettingRow mark='微' title='微信权限设置' description='摄像头、位置等权限由微信管理' onClick={openWechatSettings} />
    </View>
    <View className='settings-heading'><Text>消息能力</Text><Text>按真实接入状态</Text></View>
    <View className='settings-capability aim-card'>
      <View><Text>订单与站内消息</Text><Text>可在小程序消息中心查看</Text></View>
      {templatesQuery.isLoading ? <View><Text>微信订阅通知</Text><Text>正在读取服务通知配置…</Text></View>
        : templatesQuery.data?.ok ? templatesQuery.data.data.map((template) => <View className='settings-subscription' key={template.key}><View><Text>{template.label}</Text><Text>{template.configured ? template.description : '待在微信后台配置模板 ID'}</Text></View><Button disabled={!template.configured} onClick={() => { void requestReminder(template.key); }}>{template.configured ? '授权本次' : '待配置'}</Button></View>)
          : <View><Text>微信订阅通知</Text><Text>{templatesQuery.data?.error.displayMessage || '配置加载失败'}</Text></View>}
    </View>
    <View className='settings-heading'><Text>协议与说明</Text><Text>实时源文本</Text></View>
    <View className='settings-card aim-card'>
      <SettingRow mark='条' title='用户协议' description='查看当前有效版本' onClick={() => Taro.navigateTo({ url: '/packages/account/account-legal/index?document=terms' })} />
      <SettingRow mark='隐' title='隐私政策' description='包含个人信息处理与第三方说明' onClick={() => Taro.navigateTo({ url: '/packages/account/account-legal/index?document=privacy' })} />
      <SettingRow mark='爱' title='关于爱买买' description='小程序版本、联系方式与备案信息' onClick={() => Taro.navigateTo({ url: '/packages/settings/about/index' })} />
    </View>
    <View className='settings-note'><Text>隐私授权说明</Text><Text>App 中“撤回隐私同意”是 App 本地状态。小程序权限依微信平台管理，当前代码没有可同步的小程序隐私同意状态，因此不会做一个无效的“撤回”按钮。</Text></View>
    {loggedIn ? <Button className='settings-logout' onClick={logout}>退出当前设备</Button> : <Button className='settings-login' onClick={() => Taro.navigateTo({ url: '/packages/account/account-login/index' })}>登录爱买买</Button>}
  </View>;
}
