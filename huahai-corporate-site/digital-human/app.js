/* 页面交互、音频口型与有依据的公司问答。 */
'use strict';
(async function () {
  const $ = id => document.getElementById(id);
  const avatar = $('avatar'), audio = $('narration'), ctx = avatar.getContext('2d');
  let knowledge, manifest, current = 0, analyser, audioContext, signal, talking = false, busy = false, generation = 0, sprite = null, characterConfig, voiceConfig, selectedPose = 'standing', posePreview = false, utteranceGeneration = 0;
  const portrait = new Image(); portrait.onload = () => { sprite = portrait; }; portrait.onerror = () => error('playback-error', '小犀形象未能加载，请检查素材包。');
  const history = [], reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let audioReady = false, liveAI = false;
  function error(id, message) { const el = $(id); el.textContent = message; el.hidden = !message; }
  function stopSpeech() { utteranceGeneration++; talking = false; if ('speechSynthesis' in window) speechSynthesis.cancel(); }
  function updatePoseButtons() { document.querySelectorAll('#pose-buttons button').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.pose === selectedPose))); }
  function selectPose(id) { generation++; posePreview = true; audio.pause(); stopSpeech(); selectedPose = id; updatePoseButtons(); $('presenter-status').textContent = `姿态预览 · ${characterConfig.poses.find(p => p.id === id).label}`; }
  async function digestObject(value) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))); return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join(''); }
  function setupAnalyser() {
    if (analyser) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { audioContext = new AC(); analyser = audioContext.createAnalyser(); analyser.fftSize = 256; const source = audioContext.createMediaElementSource(audio); source.connect(analyser); analyser.connect(audioContext.destination); signal = new Uint8Array(analyser.fftSize); } catch { analyser = null; }
  }
  function animate(ms) {
    if (!document.hidden) {
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
    generation++; posePreview = false; stopSpeech(); audio.pause(); current = index; selectedPose = 'standing'; updatePoseButtons();
    const ch = knowledge.chapters[current];
    $('chapter-stage').textContent = ch.stage; $('chapter-title').textContent = ch.title; $('chapter-description').textContent = ch.description;
    $('chapter-points').replaceChildren(...ch.points.map(p => { const li = document.createElement('li'); li.textContent = p; return li; }));
    $('script-text').replaceChildren(...ch.narration.map(p => { const el = document.createElement('p'); el.textContent = p; return el; }));
    $('source-links').replaceChildren(document.createTextNode('内容依据：'), ...ch.sources.map(id => {
      const s = knowledge.sources.find(source => source.id === id);
      const el = document.createElement(s.url ? 'a' : 'span'); el.textContent = s.title;
      if (s.url) { el.href = s.url; el.target = '_blank'; el.rel = 'noopener noreferrer'; }
      return el;
    }));
    document.querySelectorAll('#chapters button').forEach((btn, i) => btn.setAttribute('aria-current', String(i === current)));
    const dc = $('diagram').getContext('2d'); dc.clearRect(0, 0, 900, 260); HuahaiVisuals.diagram(dc, ch.visual, 3, 12, 894, 193); $('diagram').setAttribute('aria-label', ch.points.join('；'));
    if (manifest) { audio.src = manifest.chapters[current].audio; audio.load(); audio.playbackRate = Number($('speed').value); }
    $('next-button').textContent = current === knowledge.chapters.length - 1 ? '回到第一主题' : '下一主题';
    $('play-button').textContent = audioReady ? '开始讲解' : '音频尚未就绪';
    $('presenter-status').textContent = '等待开始讲解'; $('subtitle').textContent = '点击开始讲解，听小犀为你介绍。';
    error('playback-error', manifest ? '' : '尚未生成配音。可先阅读讲稿，或生成媒体后再播放。');
  }
  async function play() {
    const token = generation; stopSpeech(); setupAnalyser(); error('playback-error', '');
    try { if (audioContext) await audioContext.resume(); if (token !== generation) return; await audio.play(); }
    catch { if (token === generation) error('playback-error', '音频暂时无法播放，请再次点击开始，或检查媒体文件。'); }
  }
  $('play-button').addEventListener('click', () => audio.paused ? play() : audio.pause());
  $('next-button').addEventListener('click', () => setChapter((current + 1) % knowledge.chapters.length));
  $('speed').addEventListener('change', () => { audio.playbackRate = Number($('speed').value); });
  audio.addEventListener('play', () => { posePreview = false; selectedPose = 'standing'; updatePoseButtons(); setupAnalyser(); if (audioContext) audioContext.resume().catch(() => {}); $('play-button').textContent = '暂停讲解'; $('presenter-status').textContent = `正在讲解 · ${knowledge.chapters[current].label}${analyser ? '' : '（口型兼容模式）'}`; });
  audio.addEventListener('pause', () => { $('play-button').textContent = audio.currentTime === 0 ? '开始讲解' : '继续讲解'; $('presenter-status').textContent = posePreview ? `姿态预览 · ${characterConfig.poses.find(p => p.id === selectedPose).label}` : talking ? '正在朗读回答' : audio.ended ? '本章讲解完成' : audio.currentTime === 0 ? '等待开始讲解' : '讲解已暂停'; });
  audio.addEventListener('ended', async () => { if ($('continuous').checked && current < knowledge.chapters.length - 1) { setChapter(current + 1); await play(); } else { $('presenter-status').textContent = '讲解已完成'; $('play-button').textContent = '再次讲解'; } });
  audio.addEventListener('error', () => { if (audio.src) error('playback-error', '音频文件未能加载，请检查媒体包是否完整。'); });
  audio.addEventListener('timeupdate', () => {
    const cues = manifest?.chapters[current]?.cues || [];
    const cue = cues.find(c => audio.currentTime >= c.start && audio.currentTime < c.end);
    $('subtitle').textContent = cue ? cue.text : '';
  });
  function addMessage(role, content, refs = []) {
    $('messages').querySelector('.chat-welcome')?.remove();
    const el = document.createElement('div'); el.className = `message ${role}`;
    const name = document.createElement('strong'); name.textContent = role === 'user' ? '你' : '小犀'; el.append(name, document.createTextNode(content));
    if (refs.length) { const s = document.createElement('span'); s.className = 'references'; s.textContent = '依据：' + refs.join('、'); el.append(s); }
    $('messages').append(el); $('messages').scrollTop = $('messages').scrollHeight;
  }
  function speak(answer) {
    if (!$('read-answer').checked) return;
    if (!('speechSynthesis' in window)) { error('chat-error', '当前浏览器不支持回答朗读，可直接阅读文字。'); return; }
    audio.pause(); stopSpeech(); posePreview = false; selectedPose = 'standing'; updatePoseButtons();
    const speechToken = utteranceGeneration;
    const u = new SpeechSynthesisUtterance(answer); u.lang = 'zh-CN'; u.rate = 1;
    const voice = speechSynthesis.getVoices().find(v => v.lang.toLowerCase() === 'zh-cn') || speechSynthesis.getVoices().find(v => v.lang.startsWith('zh'));
    if (voice) u.voice = voice;
    u.onstart = () => { if (speechToken !== utteranceGeneration) return; talking = true; $('presenter-status').textContent = '正在朗读回答'; };
    u.onend = () => { if (speechToken !== utteranceGeneration) return; talking = false; $('presenter-status').textContent = '回答朗读完成'; };
    u.onerror = () => { if (speechToken !== utteranceGeneration) return; talking = false; $('presenter-status').textContent = '可阅读文字回答'; };
    speechSynthesis.speak(u);
  }
  async function ask(question) {
    if (busy || !question.trim()) return;
    busy = true; $('send-button').disabled = true; $('send-button').textContent = '正在回答'; error('chat-error', ''); addMessage('user', question); $('question').value = '';
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, history: history.slice(-6), topic: knowledge.chapters[current].id }), signal: AbortSignal.timeout(35000) });
      if (!response.ok) throw new Error('api');
      const result = await response.json();
      addMessage('assistant', result.answer, result.sources || []);
      history.push({ role: 'user', content: question }, { role: 'assistant', content: result.answer });
      if (history.length > 12) history.splice(0, history.length - 12);
      if (result.mode === 'knowledge' && liveAI) $('ai-status').textContent = '本次按知识库回答';
      speak(result.answer);
    } catch {
      const faq = knowledge.faq.find(item => item.q === question);
      if (faq) { addMessage('assistant', faq.a, ['预置知识库问答']); speak(faq.a); }
      else error('chat-error', '实时问答暂不可用。可以点选上方常见问题，或稍后重试。');
    } finally { busy = false; $('send-button').disabled = false; $('send-button').textContent = '发送问题'; }
  }
  $('chat-form').addEventListener('submit', e => { e.preventDefault(); ask($('question').value.trim()); });
  $('video-button').addEventListener('click', () => { audio.pause(); stopSpeech(); $('video-dialog').showModal(); $('intro-video').load(); });
  $('close-video').addEventListener('click', () => $('video-dialog').close());
  $('video-dialog').addEventListener('close', () => $('intro-video').pause());
  $('intro-video').addEventListener('error', () => error('video-error', '视频未能加载，请检查媒体包是否完整。'));
  $('intro-video').querySelector('source').addEventListener('error', () => error('video-error', '视频未能加载，请检查媒体包是否完整。'));
  window.addEventListener('pagehide', () => { audio.pause(); stopSpeech(); });
  try {
    const response = await fetch('knowledge.json'); if (!response.ok) throw new Error('knowledge'); knowledge = await response.json();
    const configResponse = await fetch('character-config.json'); if (!configResponse.ok) throw new Error('character'); characterConfig = await configResponse.json();
    const voiceResponse = await fetch('voice-config.json'); if (!voiceResponse.ok) throw new Error('voice'); voiceConfig = await voiceResponse.json();
    if (characterConfig.columns !== 4 || characterConfig.rows !== 2 || !Array.isArray(characterConfig.poses)) throw new Error('character');
    portrait.src = characterConfig.sheet;
    characterConfig.poses.forEach(pose => { const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = pose.label; btn.dataset.pose = pose.id; btn.setAttribute('aria-pressed', String(pose.id === selectedPose)); btn.addEventListener('click', () => selectPose(pose.id)); $('pose-buttons').append(btn); });
    const media = await fetch('media/manifest.json').catch(() => null);
    if (media?.ok) {
      const candidate = await media.json();
      const hash = await digestObject(knowledge), configHash = await digestObject(characterConfig), voiceHash = await digestObject(voiceConfig);
      audioReady = candidate.version === knowledge.version && candidate.contentHash === hash && candidate.characterConfigHash === configHash && candidate.voiceConfigHash === voiceHash && candidate.chapters?.length === knowledge.chapters.length && candidate.chapters.every((ch, i) => ch.id === knowledge.chapters[i].id);
      if (audioReady) manifest = candidate;
    }
    knowledge.chapters.forEach((ch, i) => { const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = ch.label; btn.addEventListener('click', () => setChapter(i)); $('chapters').append(btn); });
    [0, 2, 3, 7].forEach(i => { const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = knowledge.faq[i].q; btn.addEventListener('click', () => ask(knowledge.faq[i].q)); $('suggestions').append(btn); });
    $('play-button').disabled = !audioReady; setChapter(0);
    const status = await fetch('/api/status', { signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r.json() : null).catch(() => null);
    liveAI = status?.configured === true; $('ai-status').textContent = liveAI ? '通义AI问答 · 根据公司资料回答' : '知识库问答 · 实时AI未配置';
  } catch { $('chapter-title').textContent = '讲解资料暂未加载'; error('playback-error', '请通过本地服务打开，并确认knowledge.json文件完整。'); $('ai-status').textContent = '讲解资料不可用'; }
})();
