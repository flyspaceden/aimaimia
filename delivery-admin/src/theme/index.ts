import type { ThemeConfig } from 'antd';

const theme: ThemeConfig = {
  token: {
    colorPrimary: '#3B9EFF',
    colorSuccess: '#16a34a',
    colorInfo: '#0ea5e9',
    colorWarning: '#eab308',
    colorError: '#dc2626',
    borderRadius: 6,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", sans-serif',
  },
  components: {
    Layout: {
      siderBg: '#E6F4FF',
      headerBg: '#fff',
      bodyBg: '#f3f8fd',
    },
    Menu: {
      itemBg: '#E6F4FF',
      itemColor: '#1F4E79',
      itemHoverColor: '#0B5CAD',
      itemSelectedColor: '#0B5CAD',
      itemSelectedBg: '#BAE0FF',
      itemHoverBg: '#D6EEFF',
    },
  },
};

export default theme;
