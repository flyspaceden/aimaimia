(function () {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  const current = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav a[data-route]').forEach((link) => {
    if (link.getAttribute('data-route') === current) {
      link.classList.add('active');
    }
  });

  // 译文来自本站静态文件，切换时保留原有链接、图标和中文原文。
  const languages = {
    'zh-CN': '简体中文', en: 'English', ar: 'العربية', fr: 'Français',
    de: 'Deutsch', ja: '日本語', it: 'Italiano', pt: 'Português',
    es: 'Español', 'zh-TW': '繁體中文',
  };
  const supported = (value) => Object.hasOwn(languages, value);
  const storageKey = 'huahai-language';
  const assetBase = new URL('.', document.currentScript.src);
  const assetVersion = new URL(document.currentScript.src).search;
  const assetUrl = (path) => {
    const url = new URL(path, assetBase);
    url.search = assetVersion;
    return url;
  };
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = assetUrl('language.css').href;
  document.head.append(stylesheet);

  const languageLabel = document.createElement('label');
  languageLabel.className = 'language-switch';
  const caption = document.createElement('span');
  caption.textContent = '语言';
  const selector = document.createElement('select');
  selector.setAttribute('aria-label', '选择语言');
  Object.entries(languages).forEach(([code, name]) => {
    const option = document.createElement('option');
    option.value = code;
    option.lang = code;
    option.textContent = name;
    selector.append(option);
  });
  languageLabel.append(caption, selector);
  const header = document.querySelector('.header-inner, .app-header');
  if (header) header.insertBefore(languageLabel, toggle || null);

  const status = document.createElement('p');
  status.className = 'language-status';
  status.setAttribute('role', 'status');
  status.hidden = true;
  header?.after(status);

  const legalPage = document.querySelector('[data-legal-format]');
  if (legalPage) {
    const notice = document.createElement('aside');
    notice.className = 'translation-notice';
    notice.hidden = true;
    const text = document.createElement('span');
    text.textContent = '以下为参考译文；法律条款以中文原文为准。';
    const original = document.createElement('button');
    original.type = 'button';
    original.textContent = '中文原文';
    original.addEventListener('click', () => changeLanguage('zh-CN'));
    notice.append(text, original);
    document.querySelector('.app-scroll').prepend(notice);
  }

  const hasChinese = (text) => /[\u4e00-\u9fff]/.test(text);
  const regulatoryNumber = (text) => /^粤(?:ICP备|公网安备).*号$/.test(text);
  const texts = [];
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement.closest('script, style, option')) continue;
    const source = node.nodeValue.trim();
    if (!hasChinese(source) || regulatoryNumber(source)) continue;
    const leading = node.nodeValue.match(/^\s*/)[0];
    const trailing = node.nodeValue.match(/\s*$/)[0];
    texts.push({ node, source, leading, trailing });
  }
  const attributes = [];
  document.querySelectorAll('[alt], [aria-label], [title], meta[name="description"], meta[name="keywords"]').forEach((element) => {
    const names = element.tagName === 'META' ? ['content'] : ['alt', 'aria-label', 'title'];
    names.forEach((name) => {
      const source = element.getAttribute(name);
      if (source && hasChinese(source)) attributes.push({ element, name, source });
    });
  });
  const pageLinks = [...document.querySelectorAll('a[href]')].filter((link) => {
    const url = new URL(link.href);
    return url.origin === location.origin && /\/(index|about|business|technology|industry|contact|privacy|terms)\.html$/.test(url.pathname);
  });
  const dictionaries = new Map();
  let activeLanguage = 'zh-CN';
  let requestId = 0;
  let controller;

  function updateUrl(language) {
    const url = new URL(location.href);
    url.searchParams.set('lang', language);
    history.replaceState(null, '', url);
    pageLinks.forEach((link) => {
      const destination = new URL(link.href);
      destination.searchParams.set('lang', language);
      link.href = destination.href;
    });
  }

  async function changeLanguage(language) {
    if (!supported(language)) language = 'zh-CN';
    const id = ++requestId;
    controller?.abort();
    controller = new AbortController();
    status.hidden = true;
    selector.value = language;
    languageLabel.setAttribute('aria-busy', 'true');
    try {
      let dictionary = {};
      if (language !== 'zh-CN') {
        dictionary = dictionaries.get(language);
        if (!dictionary) {
          const response = await fetch(assetUrl(`locales/${language}.json`), { signal: controller.signal });
          if (!response.ok) throw new Error('Locale unavailable');
          dictionary = await response.json();
          // 缺少任何页面译文时不进行半完成切换。
          if ([...texts, ...attributes].some(({ source }) => typeof dictionary[source] !== 'string' || !dictionary[source].trim())) {
            throw new Error('Incomplete locale');
          }
          dictionaries.set(language, dictionary);
        }
      }
      if (id !== requestId) return;
      texts.forEach(({ node, source, leading, trailing }) => {
        node.nodeValue = leading + (dictionary[source] || source) + trailing;
      });
      attributes.forEach(({ element, name, source }) => element.setAttribute(name, dictionary[source] || source));
      document.documentElement.lang = language;
      document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
      document.documentElement.dataset.language = language;
      document.querySelector('.translation-notice')?.toggleAttribute('hidden', language === 'zh-CN');
      activeLanguage = language;
      updateUrl(language);
      try { localStorage.setItem(storageKey, language); } catch { /* 禁用存储时仍通过 URL 跨页保持语言。 */ }
    } catch (error) {
      if (id !== requestId || error.name === 'AbortError') return;
      selector.value = activeLanguage;
      status.textContent = (dictionaries.get(activeLanguage)?.['语言加载失败，请重试。'] || '语言加载失败，请重试。') + ' / Could not load language. Please retry.';
      status.hidden = false;
    } finally {
      if (id === requestId) languageLabel.removeAttribute('aria-busy');
    }
  }

  function preferredLanguage() {
    const query = new URL(location.href).searchParams.get('lang');
    if (query !== null) return supported(query) ? query : 'zh-CN';
    try {
      const saved = localStorage.getItem(storageKey);
      if (supported(saved)) return saved;
    } catch { /* 存储不可用时默认中文。 */ }
    return 'zh-CN';
  }
  selector.addEventListener('change', () => changeLanguage(selector.value));
  window.addEventListener('popstate', () => changeLanguage(preferredLanguage()));
  changeLanguage(preferredLanguage());
})();
