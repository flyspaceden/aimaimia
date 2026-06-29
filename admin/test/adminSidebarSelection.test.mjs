import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('admin sider selected menu item keeps high contrast on dark background', () => {
  const layout = read('src/layouts/AdminLayout.tsx');
  const styles = read('src/layouts/AdminLayout.css');

  assert.match(layout, /import '\.\/AdminLayout\.css';/);
  assert.match(layout, /className="aimm-admin-layout"/);

  assert.match(styles, /\.aimm-admin-layout\s+\.ant-pro-sider[\s\S]*\.ant-menu-item-selected/);
  assert.match(styles, /background:\s*linear-gradient\(90deg,\s*#2563eb\s*0%,\s*#1d4ed8\s*100%\)\s*!important;/i);
  assert.match(styles, /color:\s*#fff\s*!important;/i);
  assert.match(styles, /\.ant-menu-item-selected[\s\S]*\.anticon[\s\S]*color:\s*#fff\s*!important;/i);
  assert.match(styles, /\.ant-menu-item-selected::before[\s\S]*background:\s*#bfdbfe;/i);
});
