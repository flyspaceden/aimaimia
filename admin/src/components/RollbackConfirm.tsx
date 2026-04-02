import { Modal, Typography, Alert } from 'antd';
import type { AuditLog } from '@/types';
import AuditDiffViewer from './AuditDiffViewer';

const { Text } = Typography;

interface RollbackConfirmProps {
  open: boolean;
  log: AuditLog | null;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 回滚确认弹窗 */
export default function RollbackConfirm({ open, log, loading, onConfirm, onCancel }: RollbackConfirmProps) {
  if (!log) return null;

  return (
    <Modal
      title="确认回滚操作"
      open={open}
      onOk={onConfirm}
      onCancel={onCancel}
      okText="确认回滚"
      cancelText="取消"
      okButtonProps={{ danger: true, loading }}
      width={640}
    >
      <Alert
        message="回滚将把目标数据恢复到操作前的状态"
        description="此操作不可撤销，请仔细确认变更内容"
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <div style={{ marginBottom: 16 }}>
        <Text strong>操作摘要：</Text>
        <Text>{log.summary || `${log.action} ${log.module}`}</Text>
      </div>
      <div style={{ marginBottom: 16 }}>
        <Text strong>操作人：</Text>
        <Text>{log.adminUser?.realName || log.adminUser?.username || '-'}</Text>
        <Text type="secondary" style={{ marginLeft: 12 }}>
          {log.createdAt}
        </Text>
      </div>
      <AuditDiffViewer before={log.before} after={log.after} diff={log.diff} />
    </Modal>
  );
}
