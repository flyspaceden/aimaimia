/** AI 溯源助手（演示）：只用预设问答与关键词匹配，不调用任何模型或网络。 */
import { aiAnswers, findBatch, generalQuestions, type Batch } from './data.js';
import { icon } from './svg.js';

interface QA { q: string; a: string }
const KEYWORDS: [RegExp, number][] = [[/哪|来源|产地|基地|塘/, 0], [/药|检测|残留|安全|合格/, 1], [/水|溶氧|温度|pH|氨/i, 2], [/饲料|吃|喂/, 3], [/多久|天|捕|时间/, 4], [/可信|真|确权|改/, 5]];

export class Assistant {
  private batch: Batch | undefined;
  private timer = 0;
  private pending: [HTMLElement, string] | undefined;
  constructor(private panel: HTMLElement, private log: HTMLElement, private chips: HTMLElement, private title: HTMLElement, private reduced: () => boolean) {}

  private get qas(): QA[] { return this.batch ? aiAnswers(this.batch) : generalQuestions; }

  setContext(batchCode: string | undefined): void {
    const next = findBatch(batchCode);
    if (next?.code === this.batch?.code && this.log.childElementCount) return;
    this.batch = next;
    this.title.textContent = next ? `AI 溯源助手 · ${next.species} ${next.code}` : 'AI 溯源助手';
    this.log.replaceChildren();
    this.say('a', next ? `你好，我已读取批次 ${next.code} 的档案。可以问我它的来源、检测、水质、饲料或养殖时间。` : '你好，我可以介绍溯源档案怎么看。打开任一商品或批次后，我会针对那一批货回答。', true);
    this.chips.innerHTML = this.qas.map((x, i) => `<button class="chip chip-q" data-ai-q="${i}">${x.q}</button>`).join('');
  }
  open(batchCode?: string, ask?: number): void {
    this.setContext(batchCode ?? this.batch?.code);
    this.panel.hidden = false;
    this.panel.querySelector<HTMLInputElement>('#ai-input')?.focus();
    if (ask !== undefined) this.ask(ask);
  }
  close(): void { this.panel.hidden = true; this.flush(); }
  /** 立即补全正在逐字显示的回答，避免被下一条消息截断。 */
  private flush(): void {
    window.clearInterval(this.timer);
    if (this.pending) { this.pending[0].textContent = this.pending[1]; this.pending = undefined; }
  }
  ask(index: number): void {
    const qa = this.qas[index];
    if (!qa) return;
    this.say('q', qa.q, true);
    this.say('a', qa.a, false);
  }
  askText(text: string): void {
    const value = text.trim().slice(0, 200);
    if (!value) return;
    this.say('q', value, true);
    const hit = this.batch ? KEYWORDS.find(([re]) => re.test(value)) : undefined;
    const qa = hit ? this.qas[hit[1]] : undefined;
    this.say('a', qa ? qa.a : this.batch ? '演示版只能回答档案里已有的问题，例如来源、检测、水质、饲料、养殖时间和数据可信度。请点击下方问题试试。' : '请先打开一个商品或批次档案，我就能针对那一批货回答。', false);
  }
  /** 文本节点逐字显示；减少动态效果时直接显示全文。 */
  private say(who: 'q' | 'a', text: string, instant: boolean): void {
    const row = document.createElement('div');
    row.className = `bubble bubble-${who}`;
    if (who === 'a') row.insertAdjacentHTML('afterbegin', icon('spark', 'ic ic-xs'));
    const span = document.createElement('span');
    row.append(span);
    this.flush();
    this.log.append(row);
    if (instant || this.reduced()) { span.textContent = text; this.log.scrollTop = this.log.scrollHeight; return; }
    let i = 0;
    this.pending = [span, text];
    this.timer = window.setInterval(() => {
      i = Math.min(text.length, i + 3);
      span.textContent = text.slice(0, i);
      this.log.scrollTop = this.log.scrollHeight;
      if (i >= text.length) { window.clearInterval(this.timer); this.pending = undefined; }
    }, 16);
  }
}
