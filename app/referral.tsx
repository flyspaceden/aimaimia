import { Redirect } from 'expo-router';

// DDL callback 承接页：aimaimai://referral?code=xxx 回跳到 App 时，
// expo-router 会解析到本路由。code 已由 _layout.tsx 的 Linking 订阅统一处理，
// 这里只负责把用户送回首页，避免 +not-found。
export default function ReferralCallback() {
  return <Redirect href="/(tabs)/home" />;
}
