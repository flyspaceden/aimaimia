import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Button, Tag, Drawer, message } from 'antd';
import { EyeOutlined, UndoOutlined } from '@ant-design/icons';
import { getAuditLogs, getAuditLog } from '@/api/audit';
import { rollbackAuditLog } from '@/api/audit';
import AuditDiffViewer from '@/components/AuditDiffViewer';
import RollbackConfirm from '@/components/RollbackConfirm';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import type { AuditLog } from '@/types';
import { auditActionColors as actionColors } from '@/constants/statusMaps';
import dayjs from 'dayjs';

/**
 * 根据目标类型和ID生成跳转URL
 * 返回 null 表示无可跳转页面
 */
function getTargetUrl(targetType: string | null, targetId: string | null): string | null {
  if (!targetType || !targetId) return null;
  const routes: Record<string, string> = {
    product: `/products/${targetId}/edit`,
    order: `/orders/${targetId}`,
    company: `/companies/${targetId}`,
    user: `/users`, // 暂无用户详情页，跳转列表
    admin_user: `/admin/users`,
    role: `/admin/roles`,
    config: `/config`,
    trace: `/trace`,
    bonus_member: `/bonus/members/${targetId}`,
    withdrawal: `/bonus/withdrawals`,
    coupon_campaign: `/coupons`,
    lottery: `/lottery`,
  };
  return routes[targetType] ?? null;
}

export default function AuditLogPage() {
  const navigate = useNavigate();
  const actionRef = useRef<ActionType>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentLog, setCurrentLog] = useState<AuditLog | null>(null);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rollbackLoading, setRollbackLoading] = useState(false);

  const handleViewDetail = async (id: string) => {
    try {
      const detail = await getAuditLog(id);
      setCurrentLog(detail);
      setDrawerOpen(true);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载详情失败');
    }
  };

  const handleRollback = async () => {
    if (!currentLog) return;
    setRollbackLoading(true);
    try {
      await rollbackAuditLog(currentLog.id);
      message.success('回滚成功');
      setRollbackOpen(false);
      setDrawerOpen(false);
      actionRef.current?.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '回滚失败');
    } finally {
      setRollbackLoading(false);
    }
  };

  const columns: ProColumns<AuditLog>[] = [
    {
      // 修复：使用 adminUser 而非 admin，优先显示 realName
      title: '操作人',
      width: 100,
      search: false,
      render: (_: unknown, r: AuditLog) => r.adminUser?.realName || r.adminUser?.username || '-',
    },
    {
      title: '操作',
      dataIndex: 'action',
      width: 100,
      valueType: 'select',
      valueEnum: {
        CREATE: { text: '创建' },
        UPDATE: { text: '更新' },
        DELETE: { text: '删除' },
        STATUS_CHANGE: { text: '状态变更' },
        APPROVE: { text: '审核通过' },
        REJECT: { text: '审核拒绝' },
        REFUND: { text: '退款' },
        SHIP: { text: '发货' },
        CONFIG_CHANGE: { text: '配置变更' },
        ROLLBACK: { text: '回滚' },
      },
      render: (_: unknown, r: AuditLog) => (
        <Tag color={actionColors[r.action]}>{r.action}</Tag>
      ),
    },
    {
      title: '模块',
      dataIndex: 'module',
      width: 100,
      valueType: 'select',
      valueEnum: {
        products: { text: '商品' },
        orders: { text: '订单' },
        companies: { text: '企业' },
        admin_users: { text: '管理员' },
        admin_roles: { text: '角色' },
        bonus: { text: '会员' },
        trace: { text: '溯源' },
        config: { text: '配置' },
      },
    },
    { title: '摘要', dataIndex: 'summary', ellipsis: true, search: false },
    {
      // 目标列：可点击跳转到目标实体详情页
      title: '目标',
      key: 'target',
      width: 160,
      ellipsis: true,
      search: false,
      render: (_: unknown, r: AuditLog) => {
        const url = getTargetUrl(r.targetType, r.targetId);
        const label = r.targetType ? `${r.targetType}/${r.targetId?.slice(0, 8)}...` : r.targetId || '-';
        if (url) {
          return <a onClick={() => navigate(url)}>{label}</a>;
        }
        return label;
      },
    },
    {
      title: '可回滚',
      dataIndex: 'isReversible',
      width: 80,
      search: false,
      render: (_: unknown, r: AuditLog) =>
        r.isReversible ? (
          r.rolledBackAt ? <Tag>已回滚</Tag> : <Tag color="green">可回滚</Tag>
        ) : (
          <Tag color="default">不可逆</Tag>
        ),
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 160,
      valueType: 'dateRange',
      render: (_: unknown, r: AuditLog) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm'),
      search: {
        transform: (value: [string, string]) => ({
          startDate: value[0],
          endDate: value[1],
        }),
      },
    },
    {
      title: '操作',
      key: 'action_col',
      width: 100,
      search: false,
      render: (_: unknown, record: AuditLog) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleViewDetail(record.id)}>
          详情
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <ProTable<AuditLog>
        headerTitle="审计日志"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        scroll={{ x: 900 }}
        request={async (params) => {
          const { current, pageSize, action, module, startDate, endDate } = params;
          const res = await getAuditLogs({ page: current, pageSize, action, module, startDate, endDate });
          return { data: res.items, total: res.total, success: true };
        }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 20 }}
      />

      {/* 详情抽屉 */}
      <Drawer
        title="审计日志详情"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={600}
        extra={
          currentLog?.isReversible && !currentLog?.rolledBackAt ? (
            <PermissionGate permission={PERMISSIONS.AUDIT_ROLLBACK}>
              <Button danger icon={<UndoOutlined />} onClick={() => setRollbackOpen(true)}>
                回滚此操作
              </Button>
            </PermissionGate>
          ) : null
        }
      >
        {currentLog && (
          <div>
            <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div><strong>操作人：</strong>{currentLog.adminUser?.realName || currentLog.adminUser?.username || '-'}</div>
              <div><strong>操作：</strong><Tag color={actionColors[currentLog.action]}>{currentLog.action}</Tag></div>
              <div><strong>模块：</strong>{currentLog.module}</div>
              <div>
                <strong>目标：</strong>
                {currentLog.targetType} / {currentLog.targetId}
                {(() => {
                  const url = getTargetUrl(currentLog.targetType, currentLog.targetId);
                  return url ? (
                    <Button type="link" size="small" onClick={() => { setDrawerOpen(false); navigate(url); }}>
                      查看 →
                    </Button>
                  ) : null;
                })()}
              </div>
              <div><strong>摘要：</strong>{currentLog.summary || '-'}</div>
              <div><strong>IP：</strong>{currentLog.ip || '-'}</div>
              <div><strong>时间：</strong>{dayjs(currentLog.createdAt).format('YYYY-MM-DD HH:mm:ss')}</div>
            </div>
            <AuditDiffViewer before={currentLog.before} after={currentLog.after} diff={currentLog.diff} />
          </div>
        )}
      </Drawer>

      {/* 回滚确认 */}
      <RollbackConfirm
        open={rollbackOpen}
        log={currentLog}
        loading={rollbackLoading}
        onConfirm={handleRollback}
        onCancel={() => setRollbackOpen(false)}
      />
    </div>
  );
}
