import { RollbackOutlined } from '@ant-design/icons';
import { Button, Tooltip, Typography } from 'antd';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import type { ConfigVersion } from '@/types';
import { sanitizeAdminErrorMessage } from '@/utils/adminErrorMessage';
import { getConfigRollbackState } from './captainProfitV3';

const { Text } = Typography;

export default function ConfigVersionRollbackButton({
  version,
  onRollback,
}: {
  version: ConfigVersion;
  onRollback: () => void;
}) {
  const state = getConfigRollbackState(version);
  const reason = state.reason ? sanitizeAdminErrorMessage(state.reason, '当前版本暂不允许回滚') : null;
  return (
    <div style={{ textAlign: 'right', maxWidth: 220 }}>
      <PermissionGate permission={PERMISSIONS.CONFIG_UPDATE}>
        <Tooltip title={reason}>
          <span>
            <Button
              type="text"
              size="small"
              danger
              disabled={state.disabled}
              icon={<RollbackOutlined />}
              onClick={onRollback}
              style={{ fontSize: 12 }}
            >
              回滚
            </Button>
          </span>
        </Tooltip>
      </PermissionGate>
      {reason ? (
        <Text type="danger" style={{ display: 'block', fontSize: 11, lineHeight: 1.4 }}>
          {reason}
        </Text>
      ) : null}
    </div>
  );
}
