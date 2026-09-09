import type { ReactNode } from 'react';
import { Button, Space, Typography } from 'antd';
import { money } from './common';
import './workspace.css';

export function FundHeading({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <div className="fund-heading"><div><Typography.Title level={3}>{title}</Typography.Title><Typography.Text type="secondary">{description}</Typography.Text></div><Space wrap>{actions}</Space></div>;
}
export function FundSummary({ items, loading = false, caption }: { items: { label: string; value?: number; warning?: boolean }[]; loading?: boolean; caption: string }) {
  return <section className="fund-summary" aria-label={caption}>{items.map(item => <div key={item.label}><Typography.Text type="secondary">{item.label}</Typography.Text><strong className={item.warning ? 'fund-warning' : ''}>{loading ? '加载中' : money(item.value)}</strong></div>)}</section>;
}
export function FundEmpty({ filtered, onReset }: { filtered: boolean; onReset: () => void }) {
  return <div className="fund-empty"><Typography.Text strong>{filtered ? '没有找到符合条件的记录' : '尚未产生账本记录'}</Typography.Text><Typography.Paragraph type="secondary">{filtered ? '可以缩短关键词，或清除筛选条件。' : '新产业基金从首次计提开始记录，历史个人余额不回填。'}</Typography.Paragraph>{filtered && <Button onClick={onReset}>清除筛选</Button>}</div>;
}
