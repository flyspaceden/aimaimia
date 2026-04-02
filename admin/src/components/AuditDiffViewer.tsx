import { Descriptions, Tag, Empty } from 'antd';

interface AuditDiffViewerProps {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  diff: Record<string, unknown> | null;
}

/** 审计日志 before/after 对比视图 */
export default function AuditDiffViewer({ before, after, diff }: AuditDiffViewerProps) {
  // 如果有 diff 字段，优先展示 diff
  if (diff && Object.keys(diff).length > 0) {
    return (
      <Descriptions column={1} bordered size="small" title="变更详情">
        {Object.entries(diff).map(([key, value]) => {
          const change = value as { from?: unknown; to?: unknown };
          return (
            <Descriptions.Item key={key} label={key}>
              <span style={{ color: '#dc2626', textDecoration: 'line-through', marginRight: 12 }}>
                {formatValue(change.from)}
              </span>
              <span style={{ color: '#2E7D32' }}>
                {formatValue(change.to)}
              </span>
            </Descriptions.Item>
          );
        })}
      </Descriptions>
    );
  }

  // 否则展示 before/after 对比
  if (!before && !after) {
    return <Empty description="无变更数据" />;
  }

  const allKeys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);

  return (
    <Descriptions column={1} bordered size="small" title="数据对比">
      {[...allKeys].map((key) => {
        const bVal = before?.[key];
        const aVal = after?.[key];
        const changed = JSON.stringify(bVal) !== JSON.stringify(aVal);
        return (
          <Descriptions.Item
            key={key}
            label={
              <span>
                {key}
                {changed && <Tag color="orange" style={{ marginLeft: 4 }}>已变更</Tag>}
              </span>
            }
          >
            <div style={{ display: 'flex', gap: 24 }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#999', fontSize: 12, marginBottom: 2 }}>修改前</div>
                <span style={changed ? { color: '#dc2626' } : undefined}>
                  {formatValue(bVal)}
                </span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#999', fontSize: 12, marginBottom: 2 }}>修改后</div>
                <span style={changed ? { color: '#2E7D32' } : undefined}>
                  {formatValue(aVal)}
                </span>
              </div>
            </div>
          </Descriptions.Item>
        );
      })}
    </Descriptions>
  );
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '-';
  if (typeof val === 'object') return JSON.stringify(val, null, 2);
  return String(val);
}
