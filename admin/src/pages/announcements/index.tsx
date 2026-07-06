import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Form,
  Input,
  Radio,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  BellOutlined,
  EyeOutlined,
  ReloadOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  createAnnouncement,
  getAnnouncements,
  previewAnnouncement,
  type AnnouncementAudienceType,
  type AnnouncementCategory,
  type AnnouncementPreviewResult,
  type AnnouncementPriority,
  type AnnouncementRecord,
  type AnnouncementType,
  type CreateAnnouncementPayload,
} from '@/api/announcements';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
import './index.css';

const { Text, Title } = Typography;
const { TextArea } = Input;
const DEFAULT_ANNOUNCEMENT_FORM_PANE_WIDTH = 36;
const MIN_ANNOUNCEMENT_FORM_PANE_WIDTH = 28;
const MAX_ANNOUNCEMENT_FORM_PANE_WIDTH = 58;

type AnnouncementFormValues = {
  title: string;
  content: string;
  category: AnnouncementCategory;
  type: AnnouncementType;
  priority: AnnouncementPriority;
  audienceType: AnnouncementAudienceType;
  buyerNoText?: string;
  targetPage?: AnnouncementTargetPage;
};

type AnnouncementTargetPage =
  | 'NONE'
  | 'COUPON_CENTER'
  | 'GROUP_BUY'
  | 'ORDER_LIST'
  | 'CUSTOMER_SERVICE'
  | 'INBOX'
  | 'WALLET'
  | 'COUPONS'
  | 'DIGITAL_ASSETS'
  | 'GROWTH'
  | 'REFERRAL';

const audienceLabels: Record<AnnouncementAudienceType, string> = {
  ALL: '全部买家',
  VIP: 'VIP 买家',
  NORMAL: '普通买家',
  BUYER_NOS: '指定买家',
};

const statusMap: Record<AnnouncementRecord['status'], { text: string; color: string }> = {
  SENDING: { text: '发送中', color: 'processing' },
  SENT: { text: '已发送', color: 'success' },
  PARTIAL_FAILED: { text: '部分失败', color: 'warning' },
  FAILED: { text: '发送失败', color: 'error' },
};

const targetPageOptions: Array<{ value: AnnouncementTargetPage; label: string; route?: string }> = [
  { value: 'NONE', label: '不跳转' },
  { value: 'COUPON_CENTER', label: '领券中心', route: '/coupon-center' },
  { value: 'GROUP_BUY', label: '团购首页', route: '/group-buy' },
  { value: 'ORDER_LIST', label: '订单列表', route: '/orders' },
  { value: 'CUSTOMER_SERVICE', label: '在线客服', route: '/cs' },
  { value: 'INBOX', label: '消息中心', route: '/inbox' },
  { value: 'WALLET', label: '我的财库', route: '/me/wallet' },
  { value: 'COUPONS', label: '我的福利', route: '/me/coupons' },
  { value: 'DIGITAL_ASSETS', label: '数字资产', route: '/me/digital-assets' },
  { value: 'GROWTH', label: '积分成长', route: '/me/growth' },
  { value: 'REFERRAL', label: '推荐中心', route: '/me/referral' },
];

const routeByTargetPage = targetPageOptions.reduce((acc, option) => {
  if (option.route) acc[option.value] = option.route;
  return acc;
}, {} as Partial<Record<AnnouncementTargetPage, string>>);

const targetLabelByRoute = targetPageOptions.reduce((acc, option) => {
  if (option.route) acc[option.route] = option.label;
  return acc;
}, {} as Record<string, string>);

const getTargetPageLabel = (target?: AnnouncementRecord['target'] | null) => {
  if (!target?.route) return '不跳转';
  return targetLabelByRoute[target.route] ?? '历史跳转页面';
};

const clampPaneWidth = (value: number) =>
  Math.min(MAX_ANNOUNCEMENT_FORM_PANE_WIDTH, Math.max(MIN_ANNOUNCEMENT_FORM_PANE_WIDTH, value));

const parseBuyerNos = (value?: string) =>
  Array.from(new Set((value ?? '')
    .split(/[\s,，;；]+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)));

export default function AnnouncementsPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<AnnouncementFormValues>();
  const [audienceType, setAudienceType] = useState<AnnouncementAudienceType>('ALL');
  const [previewResult, setPreviewResult] = useState<AnnouncementPreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [announcementFormPaneWidth, setAnnouncementFormPaneWidth] = useState(DEFAULT_ANNOUNCEMENT_FORM_PANE_WIDTH);
  const splitLayoutRef = useRef<HTMLDivElement | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'announcements', page, pageSize],
    queryFn: () => getAnnouncements({ page, pageSize }),
  });

  const splitLayoutStyle = {
    '--announcement-form-pane-width': `${announcementFormPaneWidth}%`,
  } as CSSProperties;

  const updatePaneWidthFromClientX = useCallback((clientX: number) => {
    const rect = splitLayoutRef.current?.getBoundingClientRect();
    if (!rect?.width) return;
    const nextWidth = ((clientX - rect.left) / rect.width) * 100;
    setAnnouncementFormPaneWidth(clampPaneWidth(nextWidth));
  }, []);

  const handlePaneResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    updatePaneWidthFromClientX(event.clientX);

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      updatePaneWidthFromClientX(moveEvent.clientX);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp, { once: true });
  }, [updatePaneWidthFromClientX]);

  const handlePaneResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const delta = event.key === 'ArrowLeft' ? -3 : 3;
      setAnnouncementFormPaneWidth((current) => clampPaneWidth(current + delta));
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setAnnouncementFormPaneWidth(MIN_ANNOUNCEMENT_FORM_PANE_WIDTH);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setAnnouncementFormPaneWidth(MAX_ANNOUNCEMENT_FORM_PANE_WIDTH);
    }
  }, []);

  const buildPayload = (values: AnnouncementFormValues): CreateAnnouncementPayload => {
    const selectedRoute = values.targetPage && values.targetPage !== 'NONE'
      ? routeByTargetPage[values.targetPage]
      : undefined;
    return {
      title: values.title.trim(),
      content: values.content.trim(),
      category: values.category,
      type: values.type,
      priority: values.priority,
      target: selectedRoute ? { route: selectedRoute } : undefined,
      audience: values.audienceType === 'BUYER_NOS'
        ? { type: values.audienceType, buyerNos: parseBuyerNos(values.buyerNoText) }
        : { type: values.audienceType },
    };
  };

  const handlePreview = async () => {
    const values = await form.validateFields();
    const payload = buildPayload(values);
    setPreviewing(true);
    try {
      const result = await previewAnnouncement(payload);
      setPreviewResult(result);
      if (result.invalidBuyerNos.length > 0) {
        message.warning('有买家编号不可发送，请检查后再发布');
      } else {
        message.success(`可发送 ${result.count} 位买家`);
      }
    } catch (err) {
      setPreviewResult(null);
      message.error(err instanceof Error ? err.message : '预览失败');
    } finally {
      setPreviewing(false);
    }
  };

  const handlePublish = async () => {
    const values = await form.validateFields();
    const payload = buildPayload(values);
    modal.confirm({
      title: '确认发布公告',
      content: previewResult
        ? `最近一次预览可发送 ${previewResult.count} 位买家。发布后会写入买家消息中心，不能撤回。`
        : '发布后会写入买家消息中心，不能撤回。建议先预览受众人数。',
      okText: '发布公告',
      cancelText: '取消',
      onOk: async () => {
        setPublishing(true);
        try {
          await createAnnouncement(payload);
          message.success('公告已发布');
          form.resetFields();
          setAudienceType('ALL');
          setPreviewResult(null);
          queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] });
        } catch (err) {
          message.error(err instanceof Error ? err.message : '发布失败');
          throw err;
        } finally {
          setPublishing(false);
        }
      },
    });
  };

  const columns: ColumnsType<AnnouncementRecord> = [
    {
      title: '公告',
      dataIndex: 'title',
      width: 260,
      render: (_: unknown, record) => (
        <Space direction="vertical" size={2}>
          <Text strong>{record.title}</Text>
          <Text type="secondary" ellipsis style={{ maxWidth: 320 }}>{record.content}</Text>
        </Space>
      ),
    },
    {
      title: '受众',
      dataIndex: 'audienceType',
      width: 110,
      render: (value: AnnouncementAudienceType) => audienceLabels[value] ?? value,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (value: AnnouncementRecord['status']) => {
        const status = statusMap[value] ?? { text: value, color: 'default' };
        return <Tag color={status.color}>{status.text}</Tag>;
      },
    },
    {
      title: '发送结果',
      key: 'counts',
      width: 180,
      render: (_: unknown, record) => (
        <Text>
          成功 {record.successCount} / 目标 {record.recipientCount}
          {record.failedCount > 0 ? `，失败 ${record.failedCount}` : ''}
        </Text>
      ),
    },
    {
      title: '跳转',
      dataIndex: 'target',
      width: 180,
      render: (target: AnnouncementRecord['target']) => (
        <Text type={target?.route ? undefined : 'secondary'}>
          {getTargetPageLabel(target)}
        </Text>
      ),
    },
    {
      title: '发送时间',
      dataIndex: 'sentAt',
      width: 170,
      render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm'),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>消息公告</Title>
        <Text type="secondary">向买家消息中心发布平台公告，也可以按 VIP、普通买家或买家编号定向发送</Text>
      </div>

      <div ref={splitLayoutRef} className="announcement-split-layout" style={splitLayoutStyle}>
        <div className="announcement-split-pane announcement-form-pane">
          <Card
            title={<Space><BellOutlined />发布公告</Space>}
            size="small"
            style={{ marginBottom: 16 }}
          >
            <Form<AnnouncementFormValues>
              form={form}
              layout="vertical"
              initialValues={{
                category: 'system',
                type: 'platform_announcement',
                priority: 'NORMAL',
                audienceType: 'ALL',
                targetPage: 'NONE',
              }}
              onValuesChange={(changedValues) => {
                if (changedValues.audienceType) {
                  setAudienceType(changedValues.audienceType);
                }
                setPreviewResult(null);
              }}
            >
              <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入公告标题' }]}>
                <Input maxLength={80} showCount placeholder="例如：本周五晚 8 点平台活动提醒" />
              </Form.Item>
              <Form.Item name="content" label="内容" rules={[{ required: true, message: '请输入公告内容' }]}>
                <TextArea rows={5} maxLength={5000} showCount placeholder="公告会作为消息正文展示在买家 App 消息中心" />
              </Form.Item>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="type" label="消息类型">
                    <Select
                      options={[
                        { value: 'platform_announcement', label: '平台公告' },
                        { value: 'platform_notice', label: '平台通知' },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="priority" label="重要性">
                    <Radio.Group buttonStyle="solid">
                      <Radio.Button value="NORMAL">普通</Radio.Button>
                      <Radio.Button value="IMPORTANT">重要</Radio.Button>
                    </Radio.Group>
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="category" label="消息分类">
                <Select
                  options={[
                    { value: 'system', label: '系统' },
                    { value: 'transaction', label: '交易' },
                    { value: 'interaction', label: '互动' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="audienceType" label="发送范围">
                <Select
                  options={[
                    { value: 'ALL', label: '全部买家' },
                    { value: 'VIP', label: 'VIP 买家' },
                    { value: 'NORMAL', label: '普通买家' },
                    { value: 'BUYER_NOS', label: '指定买家编号' },
                  ]}
                />
              </Form.Item>
              {audienceType === 'BUYER_NOS' ? (
                <Form.Item
                  name="buyerNoText"
                  label="买家编号"
                  rules={[{ required: true, message: '请输入至少一个买家编号' }]}
                >
                  <TextArea rows={4} placeholder="每行一个或用逗号分隔，例如 AIMM202607060001" />
                </Form.Item>
              ) : null}
              <Form.Item name="targetPage" label="跳转页面" tooltip="买家点击消息后打开的页面">
                <Select
                  optionFilterProp="label"
                  showSearch
                  options={targetPageOptions.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                />
              </Form.Item>

              {previewResult ? (
                <Alert
                  style={{ marginBottom: 16 }}
                  type={previewResult.invalidBuyerNos.length > 0 ? 'warning' : 'success'}
                  showIcon
                  message={`预览受众：${previewResult.count} 位可发送买家`}
                  description={previewResult.invalidBuyerNos.length > 0
                    ? `不可发送编号：${previewResult.invalidBuyerNos.join('、')}`
                    : undefined}
                />
              ) : null}

              <Space>
                <Button icon={<EyeOutlined />} loading={previewing} onClick={handlePreview}>
                  预览受众
                </Button>
                <PermissionGate permission={PERMISSIONS.ANNOUNCEMENTS_CREATE}>
                  <Button type="primary" icon={<SendOutlined />} loading={publishing} onClick={handlePublish}>
                    发布公告
                  </Button>
                </PermissionGate>
              </Space>
            </Form>
          </Card>
        </div>

        <div
          role="separator"
          aria-label="调整发布公告和发送历史宽度"
          aria-orientation="vertical"
          aria-valuemin={MIN_ANNOUNCEMENT_FORM_PANE_WIDTH}
          aria-valuemax={MAX_ANNOUNCEMENT_FORM_PANE_WIDTH}
          aria-valuenow={Math.round(announcementFormPaneWidth)}
          className="announcement-pane-resizer"
          onMouseDown={handlePaneResizeStart}
          onKeyDown={handlePaneResizeKeyDown}
          onDoubleClick={() => setAnnouncementFormPaneWidth(DEFAULT_ANNOUNCEMENT_FORM_PANE_WIDTH)}
          style={{ cursor: 'col-resize' }}
          tabIndex={0}
          title="拖动调整宽度"
        />

        <div className="announcement-split-pane announcement-history-pane">
          <Card
            title="发送历史"
            size="small"
            extra={
              <Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()}>
                刷新
              </Button>
            }
          >
            <Row gutter={12} style={{ marginBottom: 16 }}>
              <Col span={8}>
                <Statistic title="历史公告" value={data?.total ?? 0} />
              </Col>
              <Col span={8}>
                <Statistic
                  title="本页成功发送"
                  value={(data?.items ?? []).reduce((sum, item) => sum + item.successCount, 0)}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="本页失败"
                  value={(data?.items ?? []).reduce((sum, item) => sum + item.failedCount, 0)}
                />
              </Col>
            </Row>
            <Table<AnnouncementRecord>
              rowKey="id"
              loading={isLoading}
              columns={columns}
              dataSource={data?.items ?? []}
              scroll={{ x: 980 }}
              pagination={{
                current: page,
                pageSize,
                total: data?.total ?? 0,
                showSizeChanger: true,
              }}
              onChange={(nextPagination) => {
                setPage(nextPagination.current ?? 1);
                setPageSize(nextPagination.pageSize ?? 20);
              }}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
