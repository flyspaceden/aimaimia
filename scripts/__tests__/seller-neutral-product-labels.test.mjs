import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const PRODUCT_FORM_PATHS = [
  'seller/src/pages/products/edit.tsx',
  'delivery-seller/src/pages/products/edit.tsx',
  'admin/src/pages/products/edit.tsx',
].filter((path) => existsSync(new URL(`../../${path}`, import.meta.url)));

test('当前分支已有后台的商品语义字段使用跨品类中性名称', async () => {
  assert.ok(PRODUCT_FORM_PATHS.length >= 2);
  for (const path of PRODUCT_FORM_PATHS) {
    const source = await read(path);
    assert.doesNotMatch(source, /口味标签|饮食属性|应季月份|适用场景|产地 \/ 产区/);
    assert.match(source, /label="标签"/);
    assert.match(source, /label="属性"/);
    assert.match(source, /label="月份（选填）"/);
    assert.match(source, /label="场景"/);
    assert.match(source, /来源地 \/ 生产地/);
  }
});

test('卖家端其他商品与企业提示不再限定农业或食品', async () => {
  const sellerProduct = await read('seller/src/pages/products/edit.tsx');
  const deliveryPath = 'delivery-seller/src/pages/products/edit.tsx';
  const deliveryProduct = existsSync(new URL(`../../${deliveryPath}`, import.meta.url))
    ? await read(deliveryPath)
    : '';
  const company = await read('seller/src/pages/company/index.tsx');
  const trace = await read('seller/src/pages/trace/index.tsx');
  const combined = `${sellerProduct}\n${deliveryProduct}\n${company}\n${trace}`;

  assert.doesNotMatch(
    combined,
    /商品特点、产地、种植方式、口感|属性名（如：种植方式）|属性值（如：有机种植）|种植理念|种植\/养殖方式/,
  );
  assert.match(trace, /label: '生产方式'/);
  assert.match(trace, /label: '原料 \/ 组成'/);
});
