(() => {
  const library = document.querySelector('.nav-library'), trigger = library?.querySelector('button'), panel = library?.querySelector('.nav-library-menu')
  function closeLibrary(restore = false) { if (!panel) return; panel.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if (restore) trigger.focus() }
  if (trigger && panel) {
    if (panel.querySelector('a.active')) library.classList.add('active')
    trigger.addEventListener('click', () => { const open = panel.hidden; panel.hidden = !open; trigger.setAttribute('aria-expanded', String(open)) })
    library.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeLibrary(true) } })
    document.addEventListener('pointerdown', event => { if (!library.contains(event.target)) closeLibrary() })
    library.addEventListener('focusout', () => setTimeout(() => { if (!library.contains(document.activeElement)) closeLibrary() }, 0))
    document.querySelector('.nav-toggle')?.addEventListener('click', () => closeLibrary())
    document.querySelector('.language-trigger')?.addEventListener('click', () => closeLibrary())
  }
  const header = document.querySelector('.header-inner')
  if (header && library) {
    // 语言或窗口改变后，按实际栏目宽度决定折叠，保留可容纳的电脑单行导航。
    function fitNavigation() {
      header.classList.remove('library-nav-collapsed')
      if (innerWidth <= 900) return
      const nav = header.querySelector('.nav'), brand = header.querySelector('.brand'), language = header.querySelector('.language-switch')
      if (!nav || !brand || !language) return
      const style = getComputedStyle(header)
      const needed = nav.scrollWidth + brand.getBoundingClientRect().width + language.getBoundingClientRect().width + parseFloat(style.columnGap || '0') * 2 + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      header.classList.toggle('library-nav-collapsed', needed > header.clientWidth + 1)
    }
    addEventListener('resize', fitNavigation)
    new MutationObserver(fitNavigation).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    document.querySelector('link[href*="/language.css"]')?.addEventListener('load', fitNavigation)
    document.fonts?.ready.then(fitNavigation)
    fitNavigation()
  }
  const herbs = [...document.querySelectorAll('[data-herb]')]
  if (herbs.length) {
    const search = document.querySelector('[data-herb-search]'), year = document.querySelector('[data-herb-year]'), temperature = document.querySelector('[data-herb-temperature]')
    const previous = document.querySelector('[data-herb-prev]'), next = document.querySelector('[data-herb-next]'), size = 16
    let page = 0
    const alias = value => value.replaceAll('陈皮','橘皮').replaceAll('枸杞子','枸杞').replaceAll('山柰','山奈').replaceAll('藏红花','西红花').trim()
    function render(reset = false) {
      if (reset) page = 0
      const query = alias(search.value)
      const matches = herbs.filter(row => alias(row.dataset.name).includes(query) && (!year.value || row.dataset.year === year.value) && (!temperature.value || row.dataset.temperature === temperature.value))
      const pages = Math.max(1, Math.ceil(matches.length / size)); page = Math.max(0, Math.min(page, pages - 1))
      const shown = new Set(matches.slice(page * size, (page + 1) * size))
      herbs.forEach(row => { row.hidden = !shown.has(row); if (row.hidden) row.open = false })
      document.querySelector('[data-herb-status]').textContent = `找到${matches.length}种 · 点击条目展开资料`
      document.querySelector('[data-herb-page]').textContent = `第${page + 1} / ${pages}页`
      document.querySelector('[data-herb-empty]').hidden = matches.length > 0
      previous.disabled = page === 0; next.disabled = page >= pages - 1
    }
    search.addEventListener('input', () => render(true)); year.addEventListener('change', () => render(true)); temperature.addEventListener('change', () => render(true))
    const focusFirst = () => herbs.find(row => !row.hidden)?.querySelector('summary').focus()
    previous.addEventListener('click', () => { page--; render(); focusFirst() }); next.addEventListener('click', () => { page++; render(); focusFirst() })
    document.querySelector('[data-herb-reset]').addEventListener('click', () => { search.value = ''; year.value = ''; temperature.value = ''; render(true); search.focus() })
    document.querySelector('[data-herb-tools]').hidden = false; document.querySelector('[data-herb-pagination]').hidden = false; render()
  }
  const meals = document.querySelector('[data-meal-list]')
  if (meals) {
    const source = new URL('healthy-recipes.json?v=20261011-v1', new URL('.', document.currentScript.src)), button = document.querySelector('[data-recipe-next]')
    const beijing = () => { const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const value=type=>parts.find(p=>p.type===type).value;return `${value('year')}-${value('month')}-${value('day')}` }
    let key = '', offset = 0, menus
    const element = (tag, value, className) => { const el = document.createElement(tag); if (value) el.textContent = value; if (className) el.className = className; return el }
    function render() {
      const today = beijing(); if (today !== key) { key = today; offset = 0 }
      const ordinal = Math.floor(Date.parse(key+'T00:00:00Z') / 86400000), index = ((ordinal + offset) % menus.length + menus.length) % menus.length, menu = menus[index]
      const [y,m,d] = key.split('-')
      document.querySelector('[data-recipe-date]').textContent = `北京时间 · ${y}年${Number(m)}月${Number(d)}日 · 搭配${index+1}/${menus.length}`
      document.querySelector('[data-recipe-title]').textContent = menu.title; meals.replaceChildren()
      menu.meals.forEach((meal, i) => {
        const article = element('article', '', 'meal-entry'), label = element('div', '', 'meal-label'), body = element('div', '', 'meal-body')
        label.append(element('span', '0'+(i+1)), element('h3', meal.name)); body.append(element('h4', meal.dishes))
        const details = element('details'), list = element('ul'); meal.ingredients.forEach(item => list.append(element('li',item)))
        details.append(element('summary','食材与做法'),list,element('p',meal.method)); body.append(details,element('p',`已列食材的过敏原：${meal.allergens.length ? meal.allergens.join('、') : '无已列主要过敏原；调味料仍需看标签'}`, 'meal-allergens'))
        article.append(label,body); meals.append(article)
      })
      document.querySelector('[data-recipe-extra]').textContent = menu.extra
      document.querySelector('[data-recipe-extra-allergens]').textContent = `加餐过敏原：${menu.extraAllergens.length ? menu.extraAllergens.join('、') : '按具体食材和包装核对'}`
      const shopping = document.querySelector('[data-recipe-shopping]'); shopping.replaceChildren();
      [...new Set([...menu.meals.flatMap(m=>m.ingredients),...menu.extraIngredients])].forEach(item=>shopping.append(element('li', item)))
    }
    fetch(source).then(response=>{if(!response.ok)throw new Error('recipe-load');return response.json()}).then(data=>{
      if (!Array.isArray(data.menus) || data.menus.length !== 7 || data.menus.some(menu=>menu.meals?.length !== 3)) throw new Error('recipe-shape')
      menus=data.menus; render(); button.hidden=false; button.addEventListener('click',()=>{offset++;render()})
      setInterval(()=>{if(beijing()!==key)render()},60000); document.addEventListener('visibilitychange',()=>{if(!document.hidden && beijing()!==key)render()})
    }).catch(()=>{ document.querySelector('[data-recipe-title]').textContent='食谱暂时未能读取'; const status=document.querySelector('[data-recipe-status]'); status.textContent='请刷新重试，或阅读下方的日常搭配说明。';status.hidden=false })
  }
})()
