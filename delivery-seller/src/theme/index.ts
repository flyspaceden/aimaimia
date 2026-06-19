import type { ThemeConfig } from 'antd';

// 配送中心主题配置
// 主色调：橙色 #EA580C
const theme: ThemeConfig = {
  token: {
    colorPrimary: '#EA580C',
    colorSuccess: '#EA580C',
    colorInfo: '#F97316',
    colorWarning: '#FB923C',
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
      darkItemSelectedBg: '#EA580C',
    },
  },
};

export default theme;
