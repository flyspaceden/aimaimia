import { RollbackOutlined } from '@ant-design/icons';
import { Button, Tooltip, Typography } from 'antd';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import type { ConfigVersion } from '@/types';
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
  return (
    <div style={{ textAlign: 'right', maxWidth: 220 }}>
      <PermissionGate permission={PERMISSIONS.CONFIG_UPDATE}>
        <Tooltip title={state.reason}>
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
      {state.reason ? (
        <Text type="danger" style={{ display: 'block', fontSize: 11, lineHeight: 1.4 }}>
          {state.reason}
        </Text>
      ) : null}
    </div>
  );
}
