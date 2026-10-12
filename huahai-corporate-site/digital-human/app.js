/* 页面交互、音频口型与有依据的公司问答。 */
'use strict';
(async function () {
  const $ = id => document.getElementById(id);
  let dictionary={},locale='zh-CN',localeRequest=0,localeController,lastValidState;
  const tx=s=>dictionary[s]||s;
  const staticTexts=[],staticAttributes=[];
  for(const scope of document.querySelectorAll('main,dialog,footer,.skip-link,.narration-language,title,meta[name=description]')){const walk=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT);let node;while(node=walk.nextNode()){const source=node.nodeValue.trim();if(/[\u4e00-\u9fff]/.test(source))staticTexts.push({node,source,leading:node.nodeValue.match(/^\s*/)[0],trailing:node.nodeValue.match(/\s*$/)[0]});}for(const el of [scope,...scope.querySelectorAll('*')])for(const name of ['aria-label','alt','placeholder','content']){const source=el.getAttribute(name);if(source&&/[\u4e00-\u9fff]/.test(source))staticAttributes.push({el,name,source});}}
  function applyUI(){staticTexts.forEach(({node,source,leading,trailing})=>node.nodeValue=leading+tx(source)+trailing);staticAttributes.forEach(({el,name,source})=>el.setAttribute(name,tx(source)));document.querySelector('main').lang=locale;$('video-dialog').lang=locale;HuahaiVisuals.setTranslator(tx);}
  const avatar = $('avatar'), audio = $('narration'), ctx = avatar.getContext('2d');
  let knowledge, manifest, current = 0, analyser, audioContext, signal, talking = false, busy = false, generation = 0, sprite = null, characterConfig, voiceConfig, selectedPose = 'standing', posePreview = false, utteranceGeneration = 0;
  const portrait = new Image(); portrait.onload = () => { sprite = portrait; }; portrait.onerror = () => error('playback-error', tx('小犀形象未能加载，请检查素材包。'));
  const history = [], reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let audioReady = false;
  function error(id, message) { const el = $(id); el.textContent = message; el.hidden = !message; }
  function stopSpeech() { utteranceGeneration++; talking = false; if ('speechSynthesis' in window) speechSynthesis.cancel(); }
  function updatePoseButtons() { document.querySelectorAll('#pose-buttons button').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.pose === selectedPose))); }
  function selectPose(id) { generation++; posePreview = true; audio.pause(); stopSpeech(); selectedPose = id; updatePoseButtons(); $('presenter-status').textContent = `${tx('姿态预览')} · ${tx(characterConfig.poses.find(p => p.id === id).label)}`; }
  async function digestObject(value) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))); return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join(''); }
  function setupAnalyser() {
    if (analyser) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { audioContext = new AC(); analyser = audioContext.createAnalyser(); analyser.fftSize = 256; const source = audioContext.createMediaElementSource(audio); source.connect(analyser); analyser.connect(audioContext.destination); signal = new Uint8Array(analyser.fftSize); } catch { analyser = null; }
  }
  function animate(ms) {
    if (!document.hidden && !$('video-dialog').open) {
      let mouth = 0;
      if (!audio.paused && analyser) { analyser.getByteTimeDomainData(signal); let sum = 0; for (const v of signal) sum += ((v - 128) / 128) ** 2; mouth = Math.min(1, Math.sqrt(sum / signal.length) * 6); }
      else if (!audio.paused || talking) mouth = .18 + Math.abs(Math.sin(ms / 93)) * .4;
      ctx.clearRect(0, 0, avatar.width, avatar.height);
      let poseFrame = selectedPose === 'standing' ? null : characterConfig?.poses.find(p => p.id === selectedPose)?.frame;
      if (!audio.paused && audio.currentTime < characterConfig?.introPauseSeconds) poseFrame = characterConfig.chapterFrames[current];
      HuahaiVisuals.avatar(ctx, { width: avatar.width, height: avatar.height, t: ms / 1000, mouth, sprite, spriteConfig: characterConfig, poseFrame, still: reducedMotion.matches && audio.paused && !talking });
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
  function setChapter(index) {
    if(!knowledge)return;
    generation++; posePreview = false; stopSpeech(); audio.pause(); current = index; selectedPose = 'standing'; updatePoseButtons();
    const ch = knowledge.chapters[current];
    $('chapter-stage').textContent = ch.stage; $('chapter-title').textContent = ch.title; $('chapter-description').textContent = ch.description;
    $('chapter-points').replaceChildren(...ch.points.map(p => { const li = document.createElement('li'); li.textContent = p; return li; }));
    $('script-text').replaceChildren(...[...(current===0?[knowledge.intro]:[]),...ch.narration,...(current===knowledge.chapters.length-1?[knowledge.outro]:[])].map(p => { const el = document.createElement('p'); el.textContent = p; return el; }));
    $('source-links').replaceChildren(document.createTextNode(tx('内容依据：')), ...ch.sources.map(id => {
      const s = knowledge.sources.find(source => source.id === id);
      const el = document.createElement(s.url ? 'a' : 'span'); el.textContent = s.title;
      if (s.url) { el.href = s.url; el.target = '_blank'; el.rel = 'noopener noreferrer'; }
      return el;
    }));
    document.querySelectorAll('#chapters button').forEach((btn, i) => btn.setAttribute('aria-current', String(i === current)));
    const dc = $('diagram').getContext('2d'); dc.clearRect(0, 0, 900, 260); HuahaiVisuals.diagram(dc, ch.visual, 3, 12, 894, 193); $('diagram').setAttribute('aria-label', ch.points.join('；'));
    if (manifest) { audio.src = manifest.chapters[current].audio; audio.load(); audio.playbackRate = Number($('speed').value); }
    $('next-button').textContent = current === knowledge.chapters.length - 1 ? tx('回到第一主题') : tx('下一主题');
    $('play-button').textContent = audioReady ? tx('开始讲解') : tx('音频尚未就绪');
    $('presenter-status').textContent = tx('等待开始讲解'); $('subtitle').textContent = tx('点击开始讲解，听小犀为你介绍。');
    error('playback-error', manifest ? '' : tx('尚未生成配音。可先阅读讲稿，或生成媒体后再播放。'));
  }
  async function play() {
    if(!audioReady||!knowledge)return;
    const token = generation; stopSpeech(); setupAnalyser(); error('playback-error', '');
    try { if (audioContext) await audioContext.resume(); if (token !== generation) return; await audio.play(); }
    catch { if (token === generation) error('playback-error', tx('音频暂时无法播放，请再次点击开始，或检查媒体文件。')); }
  }
  $('play-button').addEventListener('click', () => audio.paused ? play() : audio.pause());
  $('next-button').addEventListener('click', () => { if(knowledge)setChapter((current + 1) % knowledge.chapters.length); });
  $('speed').addEventListener('change', () => { audio.playbackRate = Number($('speed').value); });
  audio.addEventListener('play', () => { if(!knowledge||!audioReady)return; posePreview = false; selectedPose = 'standing'; updatePoseButtons(); setupAnalyser(); if (audioContext) audioContext.resume().catch(() => {}); $('play-button').textContent = tx('暂停讲解'); $('presenter-status').textContent = `${tx('正在讲解')} · ${knowledge.chapters[current].label}${analyser ? '' : tx('（口型兼容模式）')}`; });
  audio.addEventListener('pause', () => { $('play-button').textContent = audio.currentTime === 0 ? tx('开始讲解') : tx('继续讲解'); $('presenter-status').textContent = posePreview ? `${tx('姿态预览')} · ${tx(characterConfig.poses.find(p => p.id === selectedPose).label)}` : talking ? tx('正在朗读回答') : audio.ended ? tx('本章讲解完成') : audio.currentTime === 0 ? tx('等待开始讲解') : tx('讲解已暂停'); });
  audio.addEventListener('ended', async () => { if(!knowledge||!audioReady)return; if ($('continuous').checked && current < knowledge.chapters.length - 1) { setChapter(current + 1); await play(); } else { $('presenter-status').textContent = tx('讲解已完成'); $('play-button').textContent = tx('再次讲解'); } });
  audio.addEventListener('error', () => { if (audio.src) error('playback-error', tx('音频文件未能加载，请检查媒体包是否完整。')); });
  audio.addEventListener('timeupdate', () => {
    const cues = manifest?.chapters[current]?.cues || [];
    const cue = cues.find(c => audio.currentTime >= c.start && audio.currentTime < c.end);
    $('subtitle').textContent = cue ? cue.text : '';
  });
  function addMessage(role, content, refs = []) {
    $('messages').querySelector('.chat-welcome')?.remove();
    const el = document.createElement('div'); el.className = `message ${role}`;
    const name = document.createElement('strong'); name.textContent = role === 'user' ? tx('你') : tx('小犀'); el.append(name, document.createTextNode(content));
    if (refs.length) { const s = document.createElement('span'); s.className = 'references'; s.textContent = tx('依据：') + refs.join('、'); el.append(s); }
    $('messages').append(el); $('messages').scrollTop = $('messages').scrollHeight;
  }
  function speak(answer) {
    if (!$('read-answer').checked) return;
    if (!('speechSynthesis' in window)) { error('chat-error', tx('当前浏览器不支持回答朗读，可直接阅读文字。')); return; }
    audio.pause(); stopSpeech(); posePreview = false; selectedPose = 'standing'; updatePoseButtons();
    const speechToken = utteranceGeneration;
    const u = new SpeechSynthesisUtterance(answer); u.lang = locale; u.rate = 1;
    const voice = speechSynthesis.getVoices().find(v => v.lang.toLowerCase() === locale.toLowerCase()) || speechSynthesis.getVoices().find(v => v.lang.startsWith(locale.slice(0,2)));
    if (voice) u.voice = voice;
    u.onstart = () => { if (speechToken !== utteranceGeneration) return; talking = true; $('presenter-status').textContent = tx('正在朗读回答'); };
    u.onend = () => { if (speechToken !== utteranceGeneration) return; talking = false; $('presenter-status').textContent = tx('回答朗读完成'); };
    u.onerror = () => { if (speechToken !== utteranceGeneration) return; talking = false; $('presenter-status').textContent = tx('可阅读文字回答'); };
    speechSynthesis.speak(u);
  }
  async function ask(question) {
    if (busy || !knowledge || !question.trim()) return;
    busy = true; $('send-button').disabled = true; $('send-button').textContent = tx('正在回答'); error('chat-error', ''); addMessage('user', question); $('question').value = '';
    try {
      const result = HuahaiFAQs.answer(question, knowledge, tx, locale);
      addMessage('assistant', result.answer, result.sources || []);
      history.push({ role: 'user', content: question }, { role: 'assistant', content: result.answer });
      if (history.length > 12) history.splice(0, history.length - 12);
      speak(result.answer);
    } catch {
      const faq = knowledge.faq.find(item => item.q === question);
      if (faq) { addMessage('assistant', faq.a, [tx('预置知识库问答')]); speak(faq.a); }
      else error('chat-error', tx('资料问答暂未加载。可以查看主题讲稿，或重新打开页面。'));
    } finally { busy = false; $('send-button').disabled = false; $('send-button').textContent = tx('发送问题'); }
  }
  $('chat-form').addEventListener('submit', e => { e.preventDefault(); ask($('question').value.trim()); });
  $('video-button').addEventListener('click', () => { if(!knowledge||!audioReady)return;audio.pause(); stopSpeech(); error('video-error', ''); $('video-dialog').showModal(); $('intro-video').load(); });
  $('close-video').addEventListener('click', () => $('video-dialog').close());
  $('video-dialog').addEventListener('close', () => $('intro-video').pause());
  $('intro-video').addEventListener('error', () => error('video-error', tx('视频未能加载，请检查媒体包是否完整。')));
  $('intro-video').querySelector('source').addEventListener('error', () => error('video-error', tx('视频未能加载，请检查媒体包是否完整。')));
  window.addEventListener('pagehide', () => { audio.pause(); stopSpeech(); });
  async function loadLocale(requested){
    const supported=['zh-CN','en','es','pt','ja'],selected=supported.includes(requested)?requested:'zh-CN';
    if(selected===locale&&knowledge){
      $('guide-language').value=locale;$('language-note').textContent=tx('支持中文、英语、西班牙语、葡萄牙语与日语讲解。');
      if(!supported.includes(requested))$('language-note').textContent+=' '+tx('该语言目前未提供讲解，可选择中文、英语、西班牙语、葡萄牙语或日语。');
      return;
    }
    const previous=knowledge?{locale,dictionary,knowledge,manifest,characterConfig,voiceConfig,current}:lastValidState;
    const token=++localeRequest;localeController?.abort();localeController=new AbortController();const signal=localeController.signal;
    generation++;audio.pause();audio.removeAttribute('src');audio.load();$('intro-video').pause();if($('video-dialog').open)$('video-dialog').close();stopSpeech();audioReady=false;manifest=null;knowledge=null;$('play-button').disabled=true;$('send-button').disabled=true;$('next-button').disabled=true;$('video-button').disabled=true;$('chapter-content').setAttribute('aria-busy','true');$('ai-status').textContent=tx('正在切换讲解语言');
    const prefix=selected==='zh-CN'?'':'locales/'+selected+'/';
    async function json(file){const r=await fetch(file+'?v=20261011-languages1',{signal});if(!r.ok)throw new Error('Guide resource unavailable');return r.json();}
    try{
      const [data,config,voice,media,ui]=await Promise.all([json(prefix+'knowledge.json'),json('character-config.json'),json(prefix+'voice-config.json'),json(prefix+'media-manifest.json'.replace(/^media-manifest/,selected==='zh-CN'?'media/manifest':'media-manifest')),selected==='zh-CN'?Promise.resolve({}):json(prefix+'ui.json')]);
      if(token!==localeRequest)return;
      const [contentHash,configHash,voiceHash]=await Promise.all([digestObject(data),digestObject(config),digestObject(voice)]);if(token!==localeRequest)return;
      const languageNames={'zh-CN':'Chinese',en:'English',es:'Spanish',pt:'Portuguese',ja:'Japanese'};if((data.locale&&data.locale!==selected)||(media.locale&&media.locale!==selected)||voice.language!==languageNames[selected])throw new Error('Guide locale mismatch');
      const ready=media.version===data.version&&media.contentHash===contentHash&&media.characterConfigHash===configHash&&media.voiceConfigHash===voiceHash&&media.chapters?.length===data.chapters.length&&media.chapters.every((ch,i)=>ch.id===data.chapters[i].id);
      if(selected!=='zh-CN'&&media.film?.locale!==selected)throw new Error('Guide film locale mismatch');
      if(!ready||config.columns!==4||config.rows!==2||!Array.isArray(config.poses))throw new Error('Guide media mismatch');
      locale=selected;$('guide-language').value=locale;dictionary=ui;knowledge=data;characterConfig=config;voiceConfig=voice;manifest=media;audioReady=true;applyUI();portrait.src=config.sheet;
      $('pose-buttons').replaceChildren();config.poses.forEach(pose=>{const btn=document.createElement('button');btn.type='button';btn.textContent=tx(pose.label);btn.dataset.pose=pose.id;btn.addEventListener('click',()=>selectPose(pose.id));$('pose-buttons').append(btn);});
      $('chapters').replaceChildren();data.chapters.forEach((ch,i)=>{const btn=document.createElement('button');btn.type='button';btn.textContent=ch.label;btn.addEventListener('click',()=>setChapter(i));$('chapters').append(btn);});
      $('suggestions').replaceChildren();data.faq.forEach(item=>{const btn=document.createElement('button');btn.type='button';btn.textContent=item.q;btn.addEventListener('click',()=>ask(item.q));$('suggestions').append(btn);});
      $('messages').replaceChildren();history.length=0;$('question').value='';$('play-button').disabled=false;$('send-button').disabled=false;$('next-button').disabled=false;$('video-button').disabled=false;$('chapter-content').removeAttribute('aria-busy');setChapter(0);$('ai-status').textContent=tx('常见问题 · 按公司资料回答');
      $ ('language-note').textContent=tx('支持中文、英语、西班牙语、葡萄牙语与日语讲解。');
      if(!supported.includes(requested))$ ('language-note').textContent+=' '+tx('该语言目前未提供讲解，可选择中文、英语、西班牙语、葡萄牙语或日语。');
      const film=media.film||{preview:document.querySelector('#intro-video source').dataset.original,download:document.querySelector('.video-downloads a').dataset.original,poster:'media/brand-film-v2-cover.png',subtitle:'media/huahai-brand-film-v2.srt',duration:427.52,shots:51};
      document.querySelector('#intro-video source').src=film.preview;$('intro-video').poster=film.poster;const downloads=document.querySelectorAll('.video-downloads a');downloads[0].href=film.download;downloads[1].href=film.subtitle;
      $('film-info').textContent=Math.floor(Math.round(film.duration)/60)+':'+String(Math.round(film.duration)%60).padStart(2,'0')+' · '+({'zh-CN':'中文',en:'English',es:'Español',pt:'Português',ja:'日本語'})[locale];
      document.querySelector('.scope-note a').href=prefix+'knowledge.json';
      lastValidState={locale,dictionary,knowledge,manifest,characterConfig,voiceConfig,current};
      if(new URL(location.href).searchParams.get('view')==='film'&&!loadLocale.opened){loadLocale.opened=true;$('video-button').click();}
    }catch(e){
      if(token!==localeRequest||e.name==='AbortError')return;
      if(previous){
        ({locale,dictionary,knowledge,manifest,characterConfig,voiceConfig,current}=previous);audioReady=true;applyUI();
        for(const id of ['play-button','send-button','next-button','video-button'])$(id).disabled=false;
        setChapter(current);$('ai-status').textContent=tx('常见问题 · 按公司资料回答');
        const url=new URL(location.href);url.searchParams.set('lang',locale);window.history.replaceState(null,'',url);window.dispatchEvent(new PopStateEvent('popstate'));
      }else $('chapter-title').textContent=tx('该语言的讲解资料暂未加载，请稍后重试。');
      $('chapter-content').removeAttribute('aria-busy');$('guide-language').value=locale;error('playback-error',tx('该语言的讲解资料暂未加载，请稍后重试。'));
    }
  }
  document.querySelector('#intro-video source').dataset.original=document.querySelector('#intro-video source').src;document.querySelector('.video-downloads a').dataset.original=document.querySelector('.video-downloads a').href;
  $('guide-language').addEventListener('change',()=>{const url=new URL(location.href);url.searchParams.set('lang',$('guide-language').value);window.history.replaceState(null,'',url);window.dispatchEvent(new PopStateEvent('popstate'));});
  window.addEventListener('huahai:languagechange',e=>loadLocale(e.detail.language));
  await loadLocale(new URL(location.href).searchParams.get('lang')||document.documentElement.lang||'zh-CN');
})();
