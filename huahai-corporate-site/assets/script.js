(function () {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  const current = /\/digital-human(?:\/|$)/.test(location.pathname) ? 'digital-human' : location.pathname.split('/').pop() || 'index.html';
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

  const languageLabel = document.createElement('div');
  languageLabel.className = 'language-switch';
  const selector = document.createElement('button');
  selector.type = 'button';
  selector.className = 'language-trigger';
  selector.setAttribute('aria-label', '选择语言');
  selector.setAttribute('aria-haspopup', 'listbox');
  selector.setAttribute('aria-expanded', 'false');
  selector.setAttribute('aria-controls', 'huahai-language-list');
  // 图标为固定 SVG；语言名使用文字节点更新，避免丢失图标或注入 HTML。
  selector.innerHTML = '<svg class="language-globe" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18Z"/></svg><span data-language-name dir="auto"></span><svg class="language-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';
  const selectedName = selector.querySelector('[data-language-name]');
  selectedName.id = 'huahai-current-language';
  selector.setAttribute('aria-describedby', selectedName.id);
  const panel = document.createElement('div');
  panel.className = 'language-panel';
  panel.hidden = true;
  const caption = document.createElement('p');
  caption.className = 'language-panel-title';
  caption.id = 'huahai-language-title';
  caption.textContent = '选择语言';
  const list = document.createElement('div');
  list.id = 'huahai-language-list';
  list.className = 'language-options';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-labelledby', caption.id);
  const languageDescriptions = {
    'zh-CN': 'Chinese · Simplified', en: 'English', ar: 'Arabic', fr: 'French',
    de: 'German', ja: 'Japanese', it: 'Italian', pt: 'Portuguese',
    es: 'Spanish', 'zh-TW': 'Chinese · Traditional',
  };
  const options = [];
  Object.entries(languages).forEach(([code, name]) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'language-option';
    option.dataset.code = code;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    option.tabIndex = -1;
    const nativeName = document.createElement('span');
    nativeName.className = 'language-native-name';
    nativeName.lang = code;
    nativeName.dir = 'auto';
    nativeName.textContent = name;
    const description = document.createElement('span');
    description.className = 'language-description';
    description.lang = 'en';
    description.dir = 'ltr';
    description.textContent = languageDescriptions[code];
    option.append(nativeName, description);
    option.addEventListener('click', () => {
      closeLanguages(true);
      changeLanguage(code);
    });
    options.push(option);
    list.append(option);
  });
  panel.append(caption, list);
  languageLabel.append(selector, panel);

  function closeLanguages(restoreFocus = false) {
    panel.hidden = true;
    selector.setAttribute('aria-expanded', 'false');
    if (restoreFocus) selector.focus();
  }
  function focusOption(index) {
    options.forEach((option, i) => { option.tabIndex = i === index ? 0 : -1; });
    options[index].focus();
  }
  function openLanguages() {
    if (nav?.classList.contains('open')) {
      nav.classList.remove('open');
      toggle?.setAttribute('aria-expanded', 'false');
    }
    panel.hidden = false;
    selector.setAttribute('aria-expanded', 'true');
    focusOption(Math.max(0, options.findIndex((option) => option.dataset.code === activeLanguage)));
  }
  selector.addEventListener('click', () => panel.hidden ? openLanguages() : closeLanguages());
  selector.addEventListener('keydown', (event) => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      openLanguages();
    }
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeLanguages(true);
      return;
    }
    const index = options.indexOf(document.activeElement);
    const previous = event.key === 'ArrowUp' || event.key === (document.documentElement.dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft');
    const next = event.key === 'ArrowDown' || event.key === (document.documentElement.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
    if (previous || next || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const destination = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (previous ? -1 : 1) + options.length) % options.length;
      focusOption(destination);
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!languageLabel.contains(event.target)) closeLanguages();
  });
  languageLabel.addEventListener('focusout', () => {
    // 等待下一焦点落定，让 Tab 正常离开控件。
    setTimeout(() => { if (!languageLabel.contains(document.activeElement)) closeLanguages(); }, 0);
  });
  toggle?.addEventListener('click', () => closeLanguages());
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

  const certificateLinks = [...document.querySelectorAll('.certificate-open')];
  if (certificateLinks.length) {
    const dialog = document.createElement('dialog');
    dialog.className = 'certificate-dialog';
    dialog.setAttribute('aria-labelledby', 'certificate-preview-title');
    const toolbar = document.createElement('div');
    toolbar.className = 'certificate-toolbar';
    const previewTitle = document.createElement('h2');
    previewTitle.id = 'certificate-preview-title';
    previewTitle.textContent = '证书预览';
    const originalImage = document.createElement('a');
    originalImage.className = 'certificate-original';
    originalImage.target = '_blank';
    originalImage.rel = 'noopener';
    originalImage.textContent = '查看原图';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'certificate-close';
    close.setAttribute('aria-label', '关闭预览');
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>';
    const viewer = document.createElement('div');
    viewer.className = 'certificate-viewer-body';
    toolbar.append(previewTitle, originalImage, close);
    dialog.append(toolbar, viewer);
    document.body.append(dialog);
    let opener;
    let previousOverflow;
    let scrollLocked = false;
    function restoreCertificatePage() {
      if (!scrollLocked) return;
      document.body.style.overflow = previousOverflow;
      scrollLocked = false;
      opener?.focus({ preventScroll: true });
    }
    function closeCertificate() {
      dialog.close();
      restoreCertificatePage();
    }
    certificateLinks.forEach((link) => {
      link.addEventListener('click', (event) => {
        // 保留新标签页、下载及不支持 dialog 时的原始图片链接。
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || typeof dialog.showModal !== 'function') return;
        event.preventDefault();
        const pages = link.dataset.pages.split(',');
        const title = link.closest('.certificate-card').querySelector('h3').textContent;
        previewTitle.textContent = title;
        originalImage.href = link.href;
        viewer.replaceChildren();
        pages.forEach((page, index) => {
          const img = document.createElement('img');
          img.src = page;
          img.alt = `${title} (${index + 1}/${pages.length})`;
          img.decoding = 'async';
          viewer.append(img);
        });
        opener = link;
        previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        scrollLocked = true;
        dialog.showModal();
        viewer.scrollTop = 0;
        close.focus();
      });
    });
    close.addEventListener('click', closeCertificate);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeCertificate();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeCertificate();
    });
    dialog.addEventListener('close', () => {
      // 原生 close 事件异步到达，不能解除随后重新打开的预览滚动锁。
      if (!dialog.open) restoreCertificatePage();
    });
  }

  const hasChinese = (text) => /[\u4e00-\u9fff]/.test(text);
  const regulatoryNumber = (text) => /^粤(?:ICP备|公网安备).*号$/.test(text);
  const texts = [];
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement.closest('script, style, [data-language-name], [role="option"], [data-translation-ignore]')) continue;
    const source = node.nodeValue.trim();
    if (!hasChinese(source) || regulatoryNumber(source)) continue;
    const leading = node.nodeValue.match(/^\s*/)[0];
    const trailing = node.nodeValue.match(/\s*$/)[0];
    texts.push({ node, source, leading, trailing });
  }
  const attributes = [];
  document.querySelectorAll('[alt], [aria-label], [title], meta[name="description"], meta[name="keywords"]').forEach((element) => {
    if (element.closest('[data-translation-ignore]')) return;
    const names = element.tagName === 'META' ? ['content'] : ['alt', 'aria-label', 'title'];
    names.forEach((name) => {
      const source = element.getAttribute(name);
      if (source && hasChinese(source)) attributes.push({ element, name, source });
    });
  });
  const pageLinks = [...document.querySelectorAll('a[href]')].filter((link) => {
    const url = new URL(link.href);
    return url.origin === location.origin && (/\/(index|about|business|technology|industry|contact|privacy|terms)\.html$/.test(url.pathname) || /\/digital-human\/(?:index\.html)?$/.test(url.pathname));
  });
  const dictionaries = new Map();
  let activeLanguage = 'zh-CN';
  let requestId = 0;
  let controller;

  function showLanguage(language) {
    selector.dataset.language = language;
    selectedName.textContent = languages[language];
    options.forEach((option) => {
      const selected = option.dataset.code === language;
      option.setAttribute('aria-selected', String(selected));
      option.tabIndex = selected ? 0 : -1;
    });
  }

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
    selectedName.textContent = languages[language];
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
      showLanguage(language);
      updateUrl(language);
      try { localStorage.setItem(storageKey, language); } catch { /* 禁用存储时仍通过 URL 跨页保持语言。 */ }
    } catch (error) {
      if (id !== requestId || error.name === 'AbortError') return;
      showLanguage(activeLanguage);
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
  window.addEventListener('popstate', () => changeLanguage(preferredLanguage()));
  showLanguage('zh-CN');
  changeLanguage(preferredLanguage());
})();
