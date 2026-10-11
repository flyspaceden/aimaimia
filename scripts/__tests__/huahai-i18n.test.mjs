import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = 'huahai-corporate-site';
const locales = ['en', 'ar', 'fr', 'de', 'ja', 'it', 'pt', 'es', 'zh-TW'];
const read = (path) => readFileSync(path, 'utf8');
const decode = (text) => text.replace(/&(quot|apos|amp|lt|gt|#39|#\d+|#x[\da-f]+);/gi, (match, name) => {
  const entities = { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', '#39': "'" };
  if (entities[name]) return entities[name];
  return String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
});

test('all nine translated catalogs cover every public page and its accessible metadata', () => {
  const sources = new Set(['语言', '选择语言', '中文原文', '以下为参考译文；法律条款以中文原文为准。', '语言加载失败，请重试。', '证书预览', '查看原图', '关闭预览']);
  const add = (value) => {
    const text = decode(value).trim();
    if (/[\u4e00-\u9fff]/.test(text) && !/^粤(?:ICP备|公网安备).*号$/.test(text)) sources.add(text);
  };
  for (const file of readdirSync(root).filter((name) => name.endsWith('.html'))) {
    const html = read(`${root}/${file}`).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<main\b[^>]*data-translation-ignore[^>]*>[\s\S]*?<\/main>/gi, '');
    for (const match of html.matchAll(/>([^<>]+)</g)) add(match[1]);
    for (const match of html.matchAll(/\b(?:alt|aria-label|title|content)="([^"]*)"/g)) add(match[1]);
    const scriptVersion = '20261011-health1';
    assert.ok(read(`${root}/${file}`).includes(`src="assets/script.js?v=${scriptVersion}"`), file);
  }
  for (const locale of locales) {
    const dictionary = JSON.parse(read(`${root}/assets/locales/${locale}.json`));
    for (const source of sources) {
      assert.equal(typeof dictionary[source], 'string', `${locale}: missing ${source}`);
      assert.ok(dictionary[source].trim(), `${locale}: empty ${source}`);
    }
    if (!['ja', 'zh-TW'].includes(locale)) {
      for (const [source, translation] of Object.entries(dictionary)) {
        assert.doesNotMatch(translation, /[\u4e00-\u9fff]/, `${locale}: untranslated ${source}`);
      }
    }
  }
});

test('certificate gallery publishes four records and only the requested five image pages', () => {
  const html = read(`${root}/technology.html`);
  assert.equal([...html.matchAll(/class="certificate-card"/g)].length, 4);
  const files = readdirSync(`${root}/assets/ip`);
  assert.equal(files.filter((file) => file.endsWith('.jpg')).length, 5);
  assert.equal(files.filter((file) => file.endsWith('.webp')).length, 5);
  assert.equal(files.some((file) => file.endsWith('.pdf')), false);
  assert.equal(files.filter((file) => file.startsWith('patent-')).length, 2);
  assert.equal(files.some((file) => file.startsWith('patent-') && file.includes('page-2')), false);
  for (const match of html.matchAll(/(?:src|href)="(assets\/ip\/[^" ]+)"/g)) {
    assert.ok(existsSync(`${root}/${match[1]}`), match[1]);
  }
  const pages = [...html.matchAll(/data-pages="([^"]+)"/g)].flatMap((match) => match[1].split(','));
  assert.equal(pages.length, 5);
  for (const page of pages) assert.ok(existsSync(`${root}/${page}`), page);
  for (const number of ['ZL 2024 1 1507905.8', '2026SR0818352', '2026SR0787776', 'R20260000049977']) assert.ok(html.includes(number));
});

test('public contact information and protected dashboard targets remain intact', () => {
  for (const locale of locales) {
    const dictionary = JSON.parse(read(`${root}/assets/locales/${locale}.json`));
    for (const [source, translation] of Object.entries(dictionary)) {
      for (const email of source.match(/[\w.+-]+@[\w.-]+\.[a-z]+/gi) || []) {
        assert.ok(translation.includes(email), `${locale} must retain ${email}`);
      }
      if (source.includes('13641421263')) assert.ok(translation.includes('13641421263'), locale);
      if (source.includes('5RE2070')) assert.ok(translation.includes('5RE2070'), locale);
    }
  }
  assert.match(read(`${root}/technology.html`), /href="https:\/\/iot-admin\.huahainongke\.com\/screens"/);
});

test('food catalog uses the specified official batches and recipes provide complete everyday menus', () => {
  const catalog = JSON.parse(read(`${root}/assets/food-medicine.json`));
  const batches = catalog.records.reduce((groups, row) => { (groups[row.year] ||= []).push(row); return groups; }, {});
  assert.equal(catalog.records.length, 106);
  assert.equal(new Set(catalog.records.map(row => row.name)).size, 106);
  assert.equal(batches['2002'].length, 87);
  assert.deepEqual(batches['2019'].map(row => row.name), ['当归','山柰','西红花','草果','姜黄','荜茇']);
  assert.deepEqual(batches['2023'].map(row => row.name), ['党参','肉苁蓉（荒漠）','铁皮石斛','西洋参','黄芪','灵芝','山茱萸','天麻','杜仲叶']);
  assert.deepEqual(batches['2024'].map(row => row.name), ['地黄','麦冬','天冬','化橘红']);
  for (const row of catalog.records) {
    assert.equal(new URL(row.source).hostname, 'www.nhc.gov.cn');
    assert.ok(row.useNote);
    if(row.year==='2019')assert.match(row.useNote,/仅作为香辛料和调味品/);
  }
  assert.equal(catalog.records.some(row=>['山银花','芦荟'].includes(row.name)),false);
  for(const name of ['党参','西洋参'])assert.match(catalog.records.find(row=>row.name===name).useNote,/不宜与藜芦同用/);
  const recipes = JSON.parse(read(`${root}/assets/healthy-recipes.json`));
  assert.equal(recipes.menus.length, 7);
  for (const menu of recipes.menus) {
    assert.deepEqual(menu.meals.map(meal=>meal.name), ['早餐','午餐','晚餐']);
    for(const meal of menu.meals){assert.ok(meal.ingredients.length);assert.ok(meal.method);assert.ok(Array.isArray(meal.allergens))}
    assert.ok(menu.extraIngredients.length);assert.ok(Array.isArray(menu.extraAllergens));
  }
});
