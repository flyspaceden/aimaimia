import { useMemo, useState } from 'react';
import { App, Alert, Button, Descriptions, Input, Modal, Space, Table, Tabs, Tag, Typography } from 'antd';
import { DownloadOutlined, ImportOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import {
  downloadTemplate,
  importRules,
  importRulesDryRun,
} from '@/api/shipping-rules';
import type {
  ShippingRuleImportError,
  ShippingRuleImportFormat,
  ShippingRuleImportResult,
} from '@/api/shipping-rules';

const { Text } = Typography;

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

const DEFAULT_CSV = [
  'name,regionCodes,firstWeightKg,firstFee,additionalWeightKg,additionalFee,isActive',
  '全国默认,,3,9.1,1,1.3,true',
].join('\n');

const DEFAULT_JSON = JSON.stringify(
  [
    {
      name: '全国默认',
      regionCodes: [],
      firstWeightKg: 3,
      firstFee: 9.1,
      additionalWeightKg: 1,
      additionalFee: 1.3,
      isActive: true,
    },
  ],
  null,
  2,
);

const triggerTextDownload = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export default function ImportDialog({ open, onOpenChange, onSuccess }: ImportDialogProps) {
  const { message } = App.useApp();
  const [format, setFormat] = useState<ShippingRuleImportFormat>('csv');
  const [csvPayload, setCsvPayload] = useState(DEFAULT_CSV);
  const [jsonPayload, setJsonPayload] = useState(DEFAULT_JSON);
  const [dryRunResult, setDryRunResult] = useState<ShippingRuleImportResult | null>(null);
  const [dryRunSnapshot, setDryRunSnapshot] = useState<{
    format: ShippingRuleImportFormat;
    payload: string;
  } | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  const payload = format === 'csv' ? csvPayload : jsonPayload;
  const hasErrors = (dryRunResult?.errors.length ?? 0) > 0;
  const matchesDryRunSnapshot =
    dryRunSnapshot?.format === format && dryRunSnapshot?.payload === payload;
  const canConfirm = Boolean(dryRunResult) &&
    matchesDryRunSnapshot &&
    !hasErrors &&
    (dryRunResult!.toCreate > 0 || dryRunResult!.toUpdate > 0);

  const errorColumns = useMemo(() => [
    {
      title: '行号',
      dataIndex: 'row',
      width: 90,
    },
    {
      title: '问题',
      dataIndex: 'message',
    },
  ], []);

  const reset = () => {
    setDryRunResult(null);
    setDryRunSnapshot(null);
    setDryRunLoading(false);
    setImportLoading(false);
  };

  const handleDryRun = async () => {
    if (!payload.trim()) {
      message.warning('请先粘贴导入内容');
      return;
    }
    const requestFormat = format;
    const requestPayload = payload;
    setDryRunLoading(true);
    try {
      const result = await importRulesDryRun({ format: requestFormat, payload: requestPayload });
      setDryRunResult(result);
      setDryRunSnapshot({ format: requestFormat, payload: requestPayload });
      if (result.errors.length > 0) {
        message.warning('预检查发现错误，请修正后重新检查');
      } else {
        message.success('预检查通过');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '预检查失败');
      setDryRunResult(null);
    } finally {
      setDryRunLoading(false);
    }
  };

  const handleImport = async () => {
    if (!canConfirm || !dryRunSnapshot) return;
    setImportLoading(true);
    try {
      const result = await importRules(dryRunSnapshot);
      if (result.errors.length > 0) {
        setDryRunResult(result);
        message.error('导入前数据发生变化，请处理错误后重试');
        return;
      }
      message.success(`导入完成：新增 ${result.created} 条，更新 ${result.updated} 条`);
      onOpenChange(false);
      reset();
      onSuccess();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导入失败');
    } finally {
      setImportLoading(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const template = await downloadTemplate();
      triggerTextDownload('shipping-rules-template.csv', template);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '模板下载失败');
    }
  };

  return (
    <Modal
      title="批量导入运费规则"
      open={open}
      width={880}
      destroyOnClose
      onCancel={() => {
        onOpenChange(false);
        reset();
      }}
      footer={[
        <Button key="template" icon={<DownloadOutlined />} onClick={handleDownloadTemplate}>
          下载模板
        </Button>,
        <Button key="dryRun" icon={<SafetyCertificateOutlined />} loading={dryRunLoading} onClick={handleDryRun}>
          预检查
        </Button>,
        <Button
          key="cancel"
          onClick={() => {
            onOpenChange(false);
            reset();
          }}
        >
          取消
        </Button>,
        <Button
          key="import"
          type="primary"
          icon={<ImportOutlined />}
          disabled={!canConfirm}
          loading={importLoading}
          onClick={handleImport}
        >
          确认导入
        </Button>,
      ]}
    >
      <Tabs
        activeKey={format}
        onChange={(key) => {
          setFormat(key as ShippingRuleImportFormat);
          setDryRunResult(null);
          setDryRunSnapshot(null);
        }}
        items={[
          {
            key: 'csv',
            label: 'CSV',
            children: (
              <Input.TextArea
                value={csvPayload}
                onChange={(event) => {
                  setCsvPayload(event.target.value);
                  setDryRunResult(null);
                  setDryRunSnapshot(null);
                }}
                autoSize={{ minRows: 10, maxRows: 16 }}
                spellCheck={false}
              />
            ),
          },
          {
            key: 'json',
            label: 'JSON',
            children: (
              <Input.TextArea
                value={jsonPayload}
                onChange={(event) => {
                  setJsonPayload(event.target.value);
                  setDryRunResult(null);
                  setDryRunSnapshot(null);
                }}
                autoSize={{ minRows: 10, maxRows: 16 }}
                spellCheck={false}
              />
            ),
          },
        ]}
      />

      <Alert
        type="info"
        showIcon
        style={{ marginTop: 12 }}
        message="按规则名称匹配已有记录；有错误时不能确认导入。fee 可省略并自动与 firstFee 保持兼容，最低计费重量默认 1kg。"
      />

      {dryRunResult && (
        <Space direction="vertical" style={{ width: '100%', marginTop: 16 }} size={12}>
          <Descriptions bordered size="small" column={4}>
            <Descriptions.Item label="待新增">
              <Tag color="green">{dryRunResult.toCreate}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="待更新">
              <Tag color="blue">{dryRunResult.toUpdate}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="未变化">
              <Tag>{dryRunResult.unchanged}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="错误">
              <Tag color={hasErrors ? 'red' : 'green'}>{dryRunResult.errors.length}</Tag>
            </Descriptions.Item>
          </Descriptions>

          {hasErrors ? (
            <Table<ShippingRuleImportError>
              rowKey={(record) => `${record.row}-${record.message}`}
              size="small"
              columns={errorColumns}
              dataSource={dryRunResult.errors}
              pagination={{ pageSize: 5 }}
            />
          ) : (
            <Text type="secondary">
              {matchesDryRunSnapshot ? '预检查通过，可确认导入。' : '内容已变更，请重新预检查。'}
            </Text>
          )}
        </Space>
      )}
    </Modal>
  );
}
