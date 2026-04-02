import type { ThemeConfig } from 'antd';

// 爱买买卖家中心主题配置
// 主色调：自然绿 #2E7D32
const theme: ThemeConfig = {
  token: {
    colorPrimary: '#2E7D32',
    colorSuccess: '#2E7D32',
    colorInfo: '#1677ff',
    colorWarning: '#F97316',
    colorError: '#dc2626',
    borderRadius: 6,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", sans-serif',
  },
  components: {
    Layout: {
      siderBg: '#001529',
      headerBg: '#fff',
      bodyBg: '#f5f5f5',
    },
    Menu: {
      darkItemBg: '#001529',
      darkSubMenuItemBg: '#000c17',
      darkItemSelectedBg: '#2E7D32',
    },
  },
};

export default theme;
