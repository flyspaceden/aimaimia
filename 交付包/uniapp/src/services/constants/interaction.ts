// 互动类型与状态流转字典（消息中心/互动详情复用）
export type InteractionAction = 'expert' | 'reward' | 'coop' | 'group' | 'like' | 'system';

export const ACTION_LABELS: Record<InteractionAction, string> = {
  expert: '专家提问',
  reward: '打赏',
  coop: '合作意向',
  group: '组团通知',
  like: '互动点赞',
  system: '系统通知',
};

export const ACTION_DESCS: Record<InteractionAction, string> = {
  expert: '专家会在 1-3 个工作日内回复',
  reward: '打赏成功后可在订单中查看记录',
  coop: '企业收到意向后将与你联系',
  group: '成团后可进入支付流程确认',
  like: '互动数据已记录',
  system: '系统通知与提醒',
};

export const ACTION_STEPS: Record<InteractionAction, { title: string; desc: string }[]> = {
  expert: [
    { title: '已提交', desc: '问题已进入专家处理队列' },
    { title: '专家处理中', desc: '等待专家回复' },
    { title: '已回复', desc: '可在详情查看答复' },
  ],
  reward: [
    { title: '已提交', desc: '打赏订单创建中' },
    { title: '支付处理中', desc: '等待支付结果' },
    { title: '已完成', desc: '打赏记录可在订单查看' },
  ],
  coop: [
    { title: '已提交', desc: '合作意向已送达' },
    { title: '企业处理中', desc: '等待企业确认' },
    { title: '已达成', desc: '后续将进入合同/沟通' },
  ],
  group: [
    { title: '已报名', desc: '已加入考察团' },
    { title: '成团中', desc: '等待人数达标' },
    { title: '已成团', desc: '进入支付确认' },
  ],
  like: [
    { title: '已触发', desc: '点赞提醒已生成' },
    { title: '已送达', desc: '消息已通知对方' },
    { title: '完成', desc: '互动已记录' },
  ],
  system: [
    { title: '已提交', desc: '系统已记录' },
    { title: '处理中', desc: '等待系统处理' },
    { title: '完成', desc: '结果已回执' },
  ],
};

const STATUS_HINTS: Record<InteractionAction, { done: string[]; processing: string[] }> = {
  expert: { done: ['已回复'], processing: ['待回复', '处理中'] },
  reward: { done: ['已完成'], processing: ['处理中', '支付'] },
  coop: { done: ['已达成', '已回复'], processing: ['待处理', '处理中'] },
  group: { done: ['已成团'], processing: ['成团中'] },
  like: { done: ['完成'], processing: ['送达'] },
  system: { done: ['完成', '已通知'], processing: ['处理中'] },
};

export const getActiveStep = (action: InteractionAction, status: string) => {
  const hints = STATUS_HINTS[action];
  if (hints.done.some((key) => status.includes(key))) return 2;
  if (hints.processing.some((key) => status.includes(key))) return 1;
  return 0;
};

export const getResultTitle = (action: InteractionAction, status: string) => {
  if (action === 'expert') return status.includes('已回复') ? '专家已回复' : '等待专家答复';
  if (action === 'reward') return status.includes('已完成') ? '打赏成功' : '打赏处理中';
  if (action === 'coop') return status.includes('已达成') ? '合作意向已确认' : '企业处理中';
  if (action === 'group') return status.includes('已成团') ? '已成团，请支付' : '等待成团';
  return '系统通知';
};

export const getResultDesc = (action: InteractionAction) => {
  if (action === 'expert') return '回复内容将在此显示（占位）';
  if (action === 'reward') return '可在订单中查看打赏记录（占位）';
  if (action === 'coop') return '企业将通过站内信与你联系（占位）';
  if (action === 'group') return '成团后请在 24 小时内完成支付';
  return '系统处理结果会同步通知';
};

export const getResultActionLabel = (action: InteractionAction) => {
  if (action === 'group') return '去支付';
  if (action === 'reward') return '查看订单';
  if (action === 'expert') return '查看帖子';
  return '';
};
