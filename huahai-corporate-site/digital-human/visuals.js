/* 原创画布数字人；网页与视频共用同一套绘制函数。 */
(function (root) {
  'use strict';
  const C = { green: '#16734d', deep: '#164735', ink: '#203f34', mint: '#e8f4ec', gold: '#ba8c45', paper: '#fbfdfb', muted: '#627b70' };
  const FONT = '"HuahaiChinese", "PingFang SC", "Microsoft YaHei", sans-serif';
  function shape(ctx, fill, fn, stroke, width = 1) { ctx.beginPath(); fn(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); } }
  function ellipse(ctx, x, y, rx, ry, fill, rotation = 0) { shape(ctx, fill, () => ctx.ellipse(x, y, rx, Math.max(.1, ry), rotation, 0, Math.PI * 2)); }
  function gradient(ctx, x, y, x2, y2, stops) { const g = ctx.createLinearGradient(x, y, x2, y2); stops.forEach(([p, c]) => g.addColorStop(p, c)); return g; }
  function round(ctx, x, y, w, h, r, fill, stroke) { shape(ctx, fill, () => ctx.roundRect(x, y, w, h, r), stroke); }
  function text(ctx, str, x, y, size = 24, color = C.ink, weight = 400, align = 'left') { ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(str, x, y); }
  function wrap(ctx, str, maxWidth, size = 24, weight = 400) { ctx.font = `${weight} ${size}px ${FONT}`; const lines = []; let line = ''; for (const c of str) { if (line && ctx.measureText(line + c).width > maxWidth) { lines.push(line); line = c; } else line += c; } if (line) lines.push(line); return lines; }
  function lines(ctx, str, x, y, width, size = 24, color = C.ink, weight = 400, lineHeight = 1.5) { const ls = wrap(ctx, str, width, size, weight); ls.forEach((s, i) => text(ctx, s, x, y + i * size * lineHeight, size, color, weight)); return ls.length * size * lineHeight; }
  function leaf(ctx, x, y, size, fill, rot = 0) { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); shape(ctx, fill, () => { ctx.moveTo(0, 0); ctx.bezierCurveTo(-size, -size, size * .1, -size * 1.7, size, -size * 1.35); ctx.bezierCurveTo(size * .9, -size * .3, size * .5, size * .1, 0, 0); }); ctx.restore(); }
  function landscape(ctx, w, h) {
    ctx.fillStyle = gradient(ctx, 0, 0, w, h, [[0, '#edf6ef'], [1, '#dceee2']]); ctx.fillRect(0, 0, w, h);
    ellipse(ctx, w * .75, h * .22, w * .095, w * .095, '#fcfcdf');
    for (let j = 0; j < 3; j++) {
      shape(ctx, ['#c0daca', '#a7cebb', '#83bda0'][j], () => { ctx.moveTo(0, h * (.62 + j * .09)); ctx.bezierCurveTo(w * .25, h * (.31 + j * .1), w * .44, h * (.76 - j * .01), w, h * (.48 + j * .17)); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); });
    }
    for (let i = 0; i < 6; i++) shape(ctx, null, () => { ctx.moveTo(-w * .1, h * (.8 + i * .035)); ctx.bezierCurveTo(w * .28, h * (.61 + i * .06), w * .5, h * (.85 + i * .05), w * 1.1, h * (.7 + i * .09)); }, '#c5e5ce', 2);
    leaf(ctx, w * .11, h * .86, w * .07, '#669e7b', -.7); leaf(ctx, w * .88, h * .93, w * .08, '#518c6c', .2);
  }
  function avatar(ctx, { width = 560, height = 650, t = 0, mouth = 0, still = false, background = true, sprite = null } = {}) {
    ctx.save(); if (background) landscape(ctx, width, height);
    if (!sprite) { text(ctx, '小犀正在准备中', width / 2, height / 2, 23, C.green, 500, 'center'); ctx.restore(); return; }
    const blink = !still && t % 5.2 > 4.82 && t % 5.2 < 5.01;
    const frame = blink ? 3 : mouth > .48 ? 2 : mouth > .13 ? 1 : 0;
    const cw = sprite.width / 2, ch = sprite.height / 2;
    const sw = width * .98, sh = sw * ch / cw;
    const sway = still ? 0 : Math.sin(t * .62) * .006;
    ctx.translate(width / 2, height * .98); ctx.rotate(sway);
    ctx.drawImage(sprite, (frame % 2) * cw, Math.floor(frame / 2) * ch, cw, ch, -sw / 2, -sh, sw, sh);
    ctx.restore();
  }
  const DIAGRAMS = {
    vision: [['生产端', '种植 · 养殖 · 品控'], ['流通端', '加工 · 仓储 · 履约'], ['消费端', '选购 · 服务 · 反馈']],
    values: [['科技兴农', '回应现场的实际问题'], ['AI赋能', '数据与专业经验协同'], ['食安为先', '重视源头与过程证据']],
    architecture: [['农业现场', '传感器 / 图像 / 记录'], ['边缘与平台', '连接 / 数据质量 / 分析'], ['辅助决策', '规则 / 建议 / 人工确认']],
    product: [['买家端', 'App / 微信小程序'], ['卖家端', '商品 / 库存 / 履约'], ['平台端', '审核 / 运营 / 服务']],
    chain: [['种养与品控', '生产记录 → 产品批次'], ['商品与交易', '商品信息 → 订单履约'], ['消费与反馈', '需求反馈 → 规划参考']],
    health: [['源头品质', '生产条件与过程记录'], ['食品与研发', '加工 / 品质 / 营养信息'], ['家庭餐桌', '选购与消费服务']]
  };
  function diagram(ctx, type, x, y, w, h) {
    const data = DIAGRAMS[type] || DIAGRAMS.vision;
    const gap = w * .043, bw = (w - 2 * gap) / 3, font = Math.min(26, w / 29);
    data.forEach(([title, sub], i) => {
      const bx = x + i * (bw + gap);
      round(ctx, bx, y, bw, h, 14, i === 1 ? '#e3f0e7' : '#f3f8f3', '#d3e5d8');
      // 生长纹理，与每个真实业务阶段对应。
      leaf(ctx, bx + bw / 2, y + h * .34, h * .105, i === 1 ? C.green : '#719b7e', -.35);
      text(ctx, title, bx + bw / 2, y + h * .53, font, C.deep, 600, 'center');
      wrap(ctx, sub, bw - 24, font * .65).forEach((l, k) => text(ctx, l, bx + bw / 2, y + h * .75 + k * font * .9, font * .65, C.muted, 400, 'center'));
      if (i < 2) shape(ctx, null, () => { const ax = bx + bw + gap * .16, ay = y + h / 2; ctx.moveTo(ax, ay); ctx.lineTo(ax + gap * .66, ay); ctx.moveTo(ax + gap * .45, ay - 5); ctx.lineTo(ax + gap * .66, ay); ctx.lineTo(ax + gap * .45, ay + 5); }, '#78977f', 1.6);
    });
    if (type === 'chain') { text(ctx, '消费反馈辅助下一轮规划 · 协同建设方向', x + w / 2, y + h + 28, font * .7, C.muted, 400, 'center'); }
  }
  function video(ctx, knowledge, chapter, subtitle, { t = 0, mouth = 0, progress = 0, chapterIndex = 0, logo = null, sprite = null } = {}) {
    const w = 1920, h = 1080; ctx.clearRect(0, 0, w, h); ctx.fillStyle = C.paper; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.beginPath(); ctx.roundRect(48, 142, 640, 810, 32); ctx.clip(); ctx.translate(48, 142); avatar(ctx, { width: 640, height: 810, t, mouth, sprite }); ctx.restore();
    if (logo) ctx.drawImage(logo, 54, 42, 66, 66);
    else { leaf(ctx, 89, 94, 27, C.green, .2); }
    text(ctx, '华海农科', 143, 73, 32, C.deep, 600); text(ctx, '深圳华海农业科技集团有限公司', 356, 73, 23, C.muted);
    round(ctx, 67, 164, 386, 73, 12, '#f8fff2ed');
    text(ctx, '小犀 · 数字讲解员', 83, 191, 27, C.deep, 600);
    text(ctx, '3D卡通形象 · 语音驱动', 83, 221, 17, '#476a55');
    text(ctx, chapter.label, 760, 184, 28, C.green, 600);
    const titleHeight = lines(ctx, chapter.title, 760, 260, 1060, 56, C.deep, 600, 1.38);
    const descY = Math.max(380, 265 + titleHeight); lines(ctx, chapter.description, 760, descY, 1020, 27, C.muted, 400, 1.6);
    diagram(ctx, chapter.visual, 760, 510, 1064, 207);
    chapter.points.forEach((p, i) => { ellipse(ctx, 773, 782 + i * 43, 4, 4, C.gold); text(ctx, p, 796, 782 + i * 43, 24, C.ink); });
    text(ctx, chapter.stage, 760, 939, 18, C.muted);
    round(ctx, 32, 978, 1856, 72, 14, '#174735');
    const subLines = wrap(ctx, subtitle, 1780, 30, 400).slice(0, 2);
    subLines.forEach((s, i) => text(ctx, s, 960, subLines.length === 1 ? 1013 : 995 + i * 34, 30, '#ffffff', 400, 'center'));
    ctx.fillStyle = '#d8e7dc'; ctx.fillRect(0, 1074, 1920, 6); ctx.fillStyle = C.green; ctx.fillRect(0, 1074, 1920 * progress, 6);
    knowledge.chapters.forEach((ch, i) => text(ctx, ch.label, 944 + i * 153, 74, 18, i === chapterIndex ? C.green : '#6e8679', i === chapterIndex ? 600 : 400));
  }
  root.HuahaiVisuals = { avatar, diagram, video, wrap, colors: C };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.HuahaiVisuals;
})(typeof globalThis !== 'undefined' ? globalThis : this);
