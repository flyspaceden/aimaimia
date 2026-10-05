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
    const html = read(`${root}/${file}`).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    for (const match of html.matchAll(/>([^<>]+)</g)) add(match[1]);
    for (const match of html.matchAll(/\b(?:alt|aria-label|title|content)="([^"]*)"/g)) add(match[1]);
    assert.match(read(`${root}/${file}`), /src="assets\/script\.js\?v=20261005-nav1"/, file);
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
