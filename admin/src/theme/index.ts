import type { ThemeConfig } from 'antd';

// 爱买买管理后台主题配置
// 主色调：管理蓝 #1E40AF，区分卖家端绿色
const theme: ThemeConfig = {
  token: {
    colorPrimary: '#1E40AF',
    colorSuccess: '#52c41a',
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
      darkItemSelectedBg: '#1E40AF',
    },
  },
};

export default theme;
