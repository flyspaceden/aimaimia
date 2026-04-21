import { useCallback, useRef, useState } from 'react';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  App,
  Button,
  Tag,
  Space,
  Switch,
  Image,
  Alert,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Typography,
  Popconfirm,
  Radio,
  Divider,
  Card,
  Flex,
  Modal,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  GiftOutlined,
  CloseOutlined,
  HolderOutlined,
  CrownOutlined,
} from '@ant-design/icons';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import {
  getVipGiftOptions,
  createVipGiftOption,
  updateVipGiftOption,
  updateVipGiftOptionStatus,
  deleteVipGiftOption,
  getRewardSkus,
  batchSortVipGiftOptions,
  getVipPackages,
  createVipPackage,
  updateVipPackage,
  deleteVipPackage,
} from '@/api/vip-gifts';
import type {
  VipGiftOption,
  VipGiftOptionStatus,
  CreateVipGiftOptionInput,
  CoverMode,
  RewardSkuOption,
  VipPackage,
  UpdateVipPackageInput,
} from '@/api/vip-gifts';
import { getRewardProducts } from '@/api/reward-products';
import type { RewardProduct } from '@/api/reward-products';
import PermissionGate from '@/components/PermissionGate';
import { PERMISSIONS } from '@/constants/permissions';
const { Text, Title } = Typography;

// 赠品方案状态映射
const statusMap: Record<string, { text: string; color: string }> = {
  ACTIVE: { text: '上架', color: 'green' },
  INACTIVE: { text: '下架', color: 'default' },
};

// ========== 每行商品搜索状态 ==========
interface RowProductState {
  keyword: string;
  selectedProductId?: string;
}

// ========== 封面样式预览组件 ==========
const PREVIEW_SIZE = 120;
const PLACEHOLDER_COLORS = ['#ffecd2', '#e8d5f5', '#d5f5e3', '#fce4ec', '#e3f2fd', '#fff9c4'];

function CoverPreview({ mode, images }: { mode: CoverMode; images: string[] }) {
  // 至少需要有占位色块
  const count = Math.max(images.length, 2);
  const slots = Array.from({ length: count }, (_, i) => images[i] || null);

  const renderSlot = (index: number, style: React.CSSProperties) => {
    const url = slots[index];
    return (
      <div
        key={index}
        style={{
          background: url ? `url(${url}) center/cover no-repeat` : PLACEHOLDER_COLORS[index % PLACEHOLDER_COLORS.length],
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#999',
          fontSize: 12,
          ...style,
        }}
      >
        {!url && `商品${index + 1}`}
      </div>
    );
  };

  const containerStyle: React.CSSProperties = {
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
    borderRadius: 8,
    overflow: 'hidden',
    border: '1px solid #e8e8e8',
    position: 'relative',
    flexShrink: 0,
  };

  let content: React.ReactNode;

  if (mode === 'AUTO_GRID') {
    if (count <= 2) {
      content = (
        <div style={{ ...containerStyle, display: 'flex' }}>
          {renderSlot(0, { flex: 1, borderRight: '1px solid #fff' })}
          {renderSlot(1, { flex: 1 })}
        </div>
      );
    } else if (count === 3) {
      content = (
        <div style={{ ...containerStyle, display: 'flex', flexDirection: 'column' }}>
          {renderSlot(0, { flex: 1, borderBottom: '1px solid #fff' })}
          <div style={{ flex: 1, display: 'flex' }}>
            {renderSlot(1, { flex: 1, borderRight: '1px solid #fff' })}
            {renderSlot(2, { flex: 1 })}
          </div>
        </div>
      );
    } else {
      content = (
        <div style={{ ...containerStyle, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, display: 'flex' }}>
            {renderSlot(0, { flex: 1, borderRight: '1px solid #fff', borderBottom: '1px solid #fff' })}
            {renderSlot(1, { flex: 1, borderBottom: '1px solid #fff' })}
          </div>
          <div style={{ flex: 1, display: 'flex' }}>
            {renderSlot(2, { flex: 1, borderRight: '1px solid #fff' })}
            {renderSlot(3, { flex: 1 })}
          </div>
          {count > 4 && (
            <div style={{
              position: 'absolute', bottom: 4, right: 4,
              background: 'rgba(0,0,0,0.5)', color: '#fff',
              borderRadius: 4, padding: '1px 6px', fontSize: 11,
            }}>
              +{count - 4}
            </div>
          )}
        </div>
      );
    }
  } else if (mode === 'AUTO_DIAGONAL') {
    content = (
      <div style={containerStyle}>
        <svg viewBox="0 0 120 120" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <defs>
            <clipPath id="diag-tl"><polygon points="0,0 120,0 0,120" /></clipPath>
            <clipPath id="diag-br"><polygon points="120,0 120,120 0,120" /></clipPath>
          </defs>
          {slots[0] ? (
            <image href={slots[0]} x="0" y="0" width="120" height="120" clipPath="url(#diag-tl)" preserveAspectRatio="xMidYMid slice" />
          ) : (
            <rect clipPath="url(#diag-tl)" width="120" height="120" fill={PLACEHOLDER_COLORS[0]} />
          )}
          {slots[1] ? (
            <image href={slots[1]} x="0" y="0" width="120" height="120" clipPath="url(#diag-br)" preserveAspectRatio="xMidYMid slice" />
          ) : (
            <rect clipPath="url(#diag-br)" width="120" height="120" fill={PLACEHOLDER_COLORS[1]} />
          )}
          <line x1="0" y1="120" x2="120" y2="0" stroke="#fff" strokeWidth="2" />
        </svg>
        {!slots[0] && (
          <div style={{ position: 'absolute', top: 20, left: 16, color: '#999', fontSize: 11 }}>商品1</div>
        )}
        {!slots[1] && (
          <div style={{ position: 'absolute', bottom: 20, right: 16, color: '#999', fontSize: 11 }}>商品2</div>
        )}
      </div>
    );
  } else if (mode === 'AUTO_STACKED') {
    content = (
      <div style={{ ...containerStyle, background: '#f9f9f9' }}>
        {/* 底层大图 */}
        <div style={{
          position: 'absolute', top: 8, left: 8, width: 80, height: 80, borderRadius: 8,
          background: slots[0] ? `url(${slots[0]}) center/cover no-repeat` : PLACEHOLDER_COLORS[0],
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#999', fontSize: 11,
        }}>
          {!slots[0] && '商品1'}
        </div>
        {/* 叠加小图 */}
        <div style={{
          position: 'absolute', bottom: 8, right: 8, width: 64, height: 64, borderRadius: 8,
          background: slots[1] ? `url(${slots[1]}) center/cover no-repeat` : PLACEHOLDER_COLORS[1],
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)', border: '2px solid #fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#999', fontSize: 11,
        }}>
          {!slots[1] && '商品2'}
        </div>
        {count > 2 && (
          <div style={{
            position: 'absolute', top: 16, right: 10, width: 48, height: 48, borderRadius: 8,
            background: slots[2] ? `url(${slots[2]}) center/cover no-repeat` : PLACEHOLDER_COLORS[2],
            boxShadow: '0 2px 6px rgba(0,0,0,0.12)', border: '2px solid #fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#999', fontSize: 10,
          }}>
            {!slots[2] && '商品3'}
          </div>
        )}
      </div>
    );
  } else {
    content = null;
  }

  if (!content) return null;

  return (
    <div style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 16 }}>
      <div>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          封面预览（买家端展示效果）
        </Text>
        {content}
      </div>
      <div style={{ flex: 1, paddingTop: 20 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {mode === 'AUTO_GRID' && '商品图片按宫格排列，2件左右各半，3件上1下2，4件以上2×2网格'}
          {mode === 'AUTO_DIAGONAL' && '取前2件商品图片，沿对角线分割展示'}
          {mode === 'AUTO_STACKED' && '商品图片层叠排列，有礼包视觉效果'}
        </Text>
      </div>
    </div>
  );
}

/** 可拖拽的表格行 */
function DraggableRow(props: React.HTMLAttributes<HTMLTableRowElement> & { 'data-row-key'?: string }) {
  const id = props['data-row-key'] || '';
  const { attributes, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <tr
      {...props}
      ref={setNodeRef}
      style={{
        ...props.style,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        cursor: 'default',
      }}
      {...attributes}
    >
      {props.children}
    </tr>
  );
}

/** 拖拽手柄 */
function DragHandle({ id }: { id: string }) {
  const { listeners, setActivatorNodeRef } = useSortable({ id });
  return (
    <HolderOutlined
      ref={setActivatorNodeRef}
      {...listeners}
      style={{ cursor: 'grab', color: '#999', fontSize: 16 }}
    />
  );
}

export default function VipGiftsPage() {
  const { message, modal } = App.useApp();
  const actionRef = useRef<ActionType>(null);
  const queryClient = useQueryClient();

  const showDeleteError = (title: string, err: any) => {
    modal.error({
      title,
      content: (
        <div style={{ fontSize: 16, lineHeight: 1.7, paddingTop: 8 }}>
          {err instanceof Error ? err.message : err?.message || '删除失败'}
        </div>
      ),
      width: 520,
      centered: true,
      okText: '知道了',
    });
  };
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<VipGiftOption | null>(null);
  const [form] = Form.useForm();

  // 拖拽排序相关
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [listData, setListData] = useState<VipGiftOption[]>([]);

  // 每行商品搜索状态（按 Form.List field.key 管理，key 是稳定且不会复用的）
  const [rowStates, setRowStates] = useState<Record<number, RowProductState>>({});

  // 防抖计时器
  const searchTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  // 当前 Form.List fields 快照（index → key 映射），用于 calculateSummary
  const fieldKeysRef = useRef<number[]>([]);

  // VIP 档位管理
  const { data: packages = [], refetch: refetchPackages } = useQuery({
    queryKey: ['admin', 'vip-packages'],
    queryFn: getVipPackages,
  });

  const createPkgMutation = useMutation({
    mutationFn: createVipPackage,
    onSuccess: () => { message.success('档位创建成功'); refetchPackages(); },
    onError: (err: Error) => message.error(err.message),
  });
  const updatePkgMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateVipPackageInput }) => updateVipPackage(id, data),
    onSuccess: () => { message.success('档位更新成功'); refetchPackages(); },
    onError: (err: Error) => message.error(err.message),
  });
  const deletePkgMutation = useMutation({
    mutationFn: deleteVipPackage,
    onSuccess: () => { message.success('档位已删除'); refetchPackages(); },
    onError: (err: Error) => showDeleteError('无法删除档位', err),
  });

  const [pkgModalOpen, setPkgModalOpen] = useState(false);
  const [editingPkg, setEditingPkg] = useState<VipPackage | null>(null);
  const [pkgForm] = Form.useForm();

  // 档位筛选
  const [filterPackageId, setFilterPackageId] = useState<string | undefined>(undefined);

  // 按行获取奖励商品列表（使用 field.key 作为标识）
  const useRowProducts = (rowKey: number) => {
    const keyword = rowStates[rowKey]?.keyword || '';
    const { data, isLoading } = useQuery({
      queryKey: ['reward-products-picker-vip', keyword],
      queryFn: () => getRewardProducts({ page: 1, pageSize: 50, keyword: keyword || undefined }),
    });
    return { products: data?.items ?? [], loading: isLoading };
  };

  // 按行获取 SKU 列表（使用 field.key 作为标识）
  const useRowSkus = (rowKey: number) => {
    const productId = rowStates[rowKey]?.selectedProductId;
    const { data, isLoading } = useQuery({
      queryKey: ['reward-skus', productId],
      queryFn: () => getRewardSkus(productId),
      enabled: !!productId,
    });
    return { skus: data ?? [], loading: isLoading };
  };

  // 创建赠品方案
  const createMutation = useMutation({
    mutationFn: createVipGiftOption,
    onSuccess: () => {
      message.success('赠品方案创建成功');
      closeDrawer();
      actionRef.current?.reload();
      queryClient.invalidateQueries({ queryKey: ['vip-gift-options'] });
    },
    onError: (err: Error) => {
      message.error(err.message || '创建失败');
    },
  });

  // 更新赠品方案
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateVipGiftOption>[1] }) =>
      updateVipGiftOption(id, data),
    onSuccess: () => {
      message.success('赠品方案更新成功');
      closeDrawer();
      actionRef.current?.reload();
      queryClient.invalidateQueries({ queryKey: ['vip-gift-options'] });
    },
    onError: (err: Error) => {
      message.error(err.message || '更新失败');
    },
  });

  // 更新状态
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: VipGiftOptionStatus }) =>
      updateVipGiftOptionStatus(id, status),
    onSuccess: () => {
      message.success('状态更新成功');
      actionRef.current?.reload();
      queryClient.invalidateQueries({ queryKey: ['vip-gift-options'] });
    },
    onError: (err: Error) => {
      message.error(err.message || '状态更新失败');
    },
  });

  // 拖拽排序结束
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = listData.findIndex((item) => item.id === active.id);
    const newIndex = listData.findIndex((item) => item.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = [...listData];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);

    const updates = reordered.map((item, idx) => ({ id: item.id, sortOrder: idx }));

    // 乐观更新 UI
    setListData(reordered.map((item, idx) => ({ ...item, sortOrder: idx })));

    try {
      await batchSortVipGiftOptions(updates);
      actionRef.current?.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '排序保存失败');
      actionRef.current?.reload();
    }
  };

  // 打开新增抽屉
  const openCreateDrawer = () => {
    setEditingRecord(null);
    setRowStates({});
    form.resetFields();
    form.setFieldsValue({
      status: 'ACTIVE',
      coverMode: 'AUTO_GRID',
      items: [{ quantity: 1 }],
    });
    setDrawerOpen(true);
  };

  // 打开编辑抽屉
  const openEditDrawer = (record: VipGiftOption) => {
    setEditingRecord(record);
    // 构建行状态（预填每行的商品/SKU选择）
    // Form.List 初始 key 从 0 开始递增，与 idx 一致
    const newRowStates: Record<number, RowProductState> = {};
    const formItems = record.items.map((item, idx) => {
      newRowStates[idx] = {
        keyword: '',
        selectedProductId: item.sku?.product?.id,
      };
      return {
        productId: item.sku?.product?.id,
        skuId: item.skuId,
        quantity: item.quantity,
      };
    });
    setRowStates(newRowStates);
    form.setFieldsValue({
      title: record.title,
      subtitle: record.subtitle || '',
      badge: record.badge || '',
      status: record.status,
      coverMode: record.coverMode || 'AUTO_GRID',
      coverUrl: record.coverUrl || undefined,
      packageId: record.packageId,
      items: formItems,
    });
    setDrawerOpen(true);
  };

  // 关闭抽屉
  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingRecord(null);
    setRowStates({});
    form.resetFields();
  };

  // 提交表单
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const items = values.items || [];

      // 检查重复 SKU
      const skuIds = items.map((item: { skuId: string }) => item.skuId).filter(Boolean);
      const uniqueSkuIds = new Set(skuIds);
      if (uniqueSkuIds.size < skuIds.length) {
        message.error('不能添加重复的商品规格，请检查');
        return;
      }

      const itemCount = items.length;
      const input: CreateVipGiftOptionInput = {
        title: values.title,
        subtitle: values.subtitle || undefined,
        badge: values.badge || undefined,
        status: values.status ?? 'ACTIVE',
        coverMode: itemCount > 1 ? (values.coverMode ?? 'AUTO_GRID') : undefined,
        coverUrl: values.coverMode === 'CUSTOM' ? values.coverUrl : undefined,
        packageId: values.packageId,
        items: items.map((item: { skuId: string; quantity: number }, idx: number) => ({
          skuId: item.skuId,
          quantity: item.quantity ?? 1,
          sortOrder: idx,
        })),
      };

      if (editingRecord) {
        updateMutation.mutate({ id: editingRecord.id, data: input });
      } else {
        createMutation.mutate(input);
      }
    } catch {
      // 表单校验失败，antd 自动提示
    }
  };

  // 行级别：商品搜索防抖（rowKey = field.key，fieldName = field.name）
  const handleRowProductSearch = useCallback((rowKey: number, val: string) => {
    if (searchTimers.current[rowKey]) {
      clearTimeout(searchTimers.current[rowKey]);
    }
    searchTimers.current[rowKey] = setTimeout(() => {
      setRowStates((prev) => ({
        ...prev,
        [rowKey]: { ...prev[rowKey], keyword: val },
      }));
    }, 400);
  }, []);

  // 行级别：商品选择变更（rowKey = field.key，fieldName = field.name 用于表单操作）
  const handleRowProductChange = useCallback((rowKey: number, fieldName: number, productId: string | undefined, products: RewardProduct[]) => {
    setRowStates((prev) => ({
      ...prev,
      [rowKey]: { ...prev[rowKey], selectedProductId: productId },
    }));
    // 清空该行已选 SKU
    const items = form.getFieldValue('items') || [];
    items[fieldName] = { ...items[fieldName], skuId: undefined };
    form.setFieldsValue({ items });

    // 如果只有一个 SKU，自动选中
    if (productId) {
      const product = products.find((p) => p.id === productId);
      if (product && product.skus.length === 1) {
        items[fieldName] = { ...items[fieldName], skuId: product.skus[0].id };
        form.setFieldsValue({ items });
      }
    }
  }, [form]);

  // 状态切换
  const handleStatusToggle = (record: VipGiftOption, checked: boolean) => {
    statusMutation.mutate({
      id: record.id,
      status: checked ? 'ACTIVE' : 'INACTIVE',
    });
  };

  // 删除赠品方案
  const handleDelete = async (id: string) => {
    try {
      await deleteVipGiftOption(id);
      message.success('删除成功');
      actionRef.current?.reload();
      queryClient.invalidateQueries({ queryKey: ['vip-gift-options'] });
    } catch (err) {
      showDeleteError('无法删除赠品方案', err);
    }
  };

  // 表格列定义
  const columns: ProColumns<VipGiftOption>[] = [
    {
      title: '排序',
      width: 60,
      search: false,
      render: (_: unknown, r: VipGiftOption) => <DragHandle id={r.id} />,
    },
    {
      title: '方案标题',
      dataIndex: 'title',
      width: 160,
      ellipsis: true,
    },
    {
      title: '所属档位',
      dataIndex: ['package', 'price'],
      width: 100,
      search: false,
      render: (_: unknown, record: VipGiftOption) => {
        if (!record.package) return <Tag>未分配</Tag>;
        const p = record.package.price;
        const color = p >= 1500 ? 'purple' : p >= 800 ? 'blue' : 'green';
        return <Tag color={color}>¥{p}</Tag>;
      },
    },
    {
      title: '组合内容',
      dataIndex: 'items',
      width: 260,
      search: false,
      ellipsis: true,
      render: (_: unknown, r: VipGiftOption) => {
        if (!r.items || r.items.length === 0) {
          return <Text type="secondary">-</Text>;
        }
        const summary = r.items
          .map((item) => `${item.sku?.product?.title || '未知商品'}×${item.quantity}`)
          .join(', ');
        return <Text title={summary}>{summary}</Text>;
      },
    },
    {
      title: '组合总价',
      dataIndex: 'totalPrice',
      width: 110,
      search: false,
      render: (_: unknown, r: VipGiftOption) =>
        r.totalPrice != null ? (
          <Text strong>¥{r.totalPrice.toFixed(2)}</Text>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '标签',
      dataIndex: 'badge',
      width: 100,
      search: false,
      render: (_: unknown, r: VipGiftOption) =>
        r.badge ? <Tag color="gold">{r.badge}</Tag> : <Text type="secondary">-</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueType: 'select',
      valueEnum: {
        ACTIVE: { text: '上架', status: 'Success' },
        INACTIVE: { text: '下架', status: 'Default' },
      },
      render: (_: unknown, r: VipGiftOption) => (
        <PermissionGate
          permission={PERMISSIONS.VIP_GIFT_UPDATE}
          fallback={
            <Tag color={statusMap[r.status]?.color}>
              {statusMap[r.status]?.text || r.status}
            </Tag>
          }
        >
          <Switch
            checkedChildren="上架"
            unCheckedChildren="下架"
            checked={r.status === 'ACTIVE'}
            onChange={(checked) => handleStatusToggle(r, checked)}
            loading={statusMutation.isPending}
          />
        </PermissionGate>
      ),
    },
    {
      title: '操作',
      width: 140,
      fixed: 'right',
      search: false,
      render: (_: unknown, r: VipGiftOption) => (
        <Space>
          <PermissionGate permission={PERMISSIONS.VIP_GIFT_UPDATE}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEditDrawer(r)}
            >
              编辑
            </Button>
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.VIP_GIFT_DELETE}>
            <Popconfirm title="确认删除该赠品方案？" onConfirm={() => handleDelete(r.id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </PermissionGate>
        </Space>
      ),
    },
  ];

  // 监听 items 变化以计算统计
  const watchedItems = Form.useWatch('items', form) || [];
  const watchedCoverMode = Form.useWatch('coverMode', form);

  // VIP 档位表单：实时计算奖励绝对金额
  const watchedPkgPrice = Form.useWatch('price', pkgForm);
  const watchedPkgRate = Form.useWatch('referralBonusRate', pkgForm);
  const watchedPkgBonus =
    typeof watchedPkgPrice === 'number' && typeof watchedPkgRate === 'number'
      ? (watchedPkgPrice * watchedPkgRate) / 100
      : null;

  // 计算总价统计（使用 fieldKeysRef 将 index 映射回 field.key 以查找 rowStates）
  const calculateSummary = () => {
    let totalQty = 0;
    let totalPrice = 0;
    const items = watchedItems || [];
    items.forEach((item: { skuId?: string; quantity?: number }, idx: number) => {
      if (!item?.skuId) return;
      const qty = item.quantity ?? 1;
      totalQty += qty;
      // 用 field.key 查找 rowStates
      const fieldKey = fieldKeysRef.current[idx];
      const productId = fieldKey != null ? rowStates[fieldKey]?.selectedProductId : undefined;
      if (productId) {
        // 通过 queryClient 获取已缓存的 SKU 数据
        const cachedSkus = queryClient.getQueryData<RewardSkuOption[]>(['reward-skus', productId]);
        const sku = cachedSkus?.find((s) => s.id === item.skuId);
        if (sku) {
          totalPrice += sku.price * qty;
        }
      }
    });
    return { itemCount: items.length, totalQty, totalPrice };
  };

  const summary = calculateSummary();

  // 收集当前所有已选商品的图片 URL（用于封面预览）
  const getItemImages = useCallback((): string[] => {
    const images: string[] = [];
    const items = form.getFieldValue('items') || [];
    items.forEach((_: unknown, idx: number) => {
      const fieldKey = fieldKeysRef.current[idx];
      const productId = fieldKey != null ? rowStates[fieldKey]?.selectedProductId : undefined;
      if (productId) {
        const cachedProducts = queryClient.getQueryData<{ items: RewardProduct[] }>([
          'reward-products-picker-vip',
          rowStates[fieldKey]?.keyword || '',
        ]);
        const product = cachedProducts?.items?.find((p) => p.id === productId);
        const url = product?.media?.[0]?.url;
        if (url) {
          images.push(url);
        }
      }
    });
    return images;
  }, [form, rowStates, queryClient]);

  return (
    <div style={{ padding: 24 }}>
      {/* 页面标题 */}
      <div style={{ marginBottom: 16 }}>
        <Space align="center">
          <GiftOutlined style={{ fontSize: 24, color: '#C9A96E' }} />
          <div>
            <Title level={4} style={{ margin: 0 }}>购买VIP赠品</Title>
            <Text type="secondary">
              从奖励商品中选择可作为 VIP 开通赠品的商品方案（支持多商品组合）
            </Text>
          </div>
        </Space>
      </div>

      {/* VIP 档位管理 */}
      <Card
        style={{ marginBottom: 16 }}
        title={
          <Space>
            <CrownOutlined style={{ color: '#C9A96E' }} />
            <span>VIP 档位管理</span>
          </Space>
        }
        extra={
          <PermissionGate permission={PERMISSIONS.CONFIG_UPDATE}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingPkg(null);
                pkgForm.resetFields();
                setPkgModalOpen(true);
              }}
            >
              新增档位
            </Button>
          </PermissionGate>
        }
      >
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {[...packages].sort((a, b) => a.price - b.price).map((pkg) => (
            <Card
              key={pkg.id}
              size="small"
              style={{ width: 200, borderColor: pkg.status === 'ACTIVE' ? '#C9A96E' : '#d9d9d9' }}
              actions={[
                <EditOutlined key="edit" onClick={() => {
                  setEditingPkg(pkg);
                  pkgForm.setFieldsValue({
                    price: pkg.price,
                    referralBonusRate: pkg.referralBonusRate * 100,
                    status: pkg.status,
                  });
                  setPkgModalOpen(true);
                }} />,
                <Popconfirm
                  key="delete"
                  title="确定删除此档位？"
                  description="需先移除该档位下所有赠品方案"
                  onConfirm={() => deletePkgMutation.mutate(pkg.id)}
                >
                  <DeleteOutlined />
                </Popconfirm>,
              ]}
            >
              <div style={{ textAlign: 'center' }}>
                <Text strong style={{ fontSize: 24, color: '#C9A96E' }}>¥{pkg.price}</Text>
                <div style={{ marginTop: 4 }}>
                  <Tag>
                    奖励 {(pkg.referralBonusRate * 100).toFixed(0)}%
                    <span style={{ color: '#8c8c8c', marginLeft: 4 }}>
                      (¥{(pkg.price * pkg.referralBonusRate).toFixed(2)})
                    </span>
                  </Tag>
                </div>
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {pkg._count?.giftOptions ?? 0} 个赠品方案
                  </Text>
                </div>
                <div style={{ marginTop: 4 }}>
                  <Tag color={pkg.status === 'ACTIVE' ? 'green' : 'default'}>
                    {pkg.status === 'ACTIVE' ? '上架' : '下架'}
                  </Tag>
                </div>
              </div>
            </Card>
          ))}
          {packages.length === 0 && (
            <Text type="secondary">暂无档位，请先创建</Text>
          )}
        </div>
      </Card>

      {/* 说明卡 */}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="VIP 赠品配置规则"
        description={
          <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
            <li>赠品必须来源于奖励商品，支持多商品组合</li>
            <li>奖励商品可以同时用于 VIP 赠品和抽奖奖品</li>
            <li>用户购买 VIP 后不可退款</li>
            <li>每个账号仅能购买一次 VIP</li>
            <li>VIP 礼包订单包邮</li>
            <li>每个赠品方案关联到对应的 VIP 档位，不同档位有不同的价格和推荐奖励比例</li>
          </ul>
        }
      />

      {/* 赠品方案列表 */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={listData.map((d) => d.id)} strategy={verticalListSortingStrategy}>
          <ProTable<VipGiftOption>
            headerTitle="赠品方案列表"
            actionRef={actionRef}
            columns={columns}
            rowKey="id"
            scroll={{ x: 1100 }}
            dataSource={listData}
            request={async (params) => {
              const res = await getVipGiftOptions({
                page: params.current || 1,
                pageSize: params.pageSize || 20,
                status: params.status || undefined,
                packageId: filterPackageId,
              });
              setListData(res.items);
              return { data: res.items, total: res.total, success: true };
            }}
            pagination={{ defaultPageSize: 20 }}
            search={{ labelWidth: 'auto' }}
            components={{ body: { row: DraggableRow } }}
            toolBarRender={() => [
              <Select
                key="filter-package"
                placeholder="按档位筛选"
                allowClear
                style={{ width: 200 }}
                value={filterPackageId}
                onChange={(val) => {
                  setFilterPackageId(val);
                  actionRef.current?.reload();
                }}
                options={packages.map(p => ({ label: `¥${p.price}`, value: p.id }))}
              />,
              <PermissionGate key="add" permission={PERMISSIONS.VIP_GIFT_CREATE}>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={openCreateDrawer}
                >
                  新增赠品方案
                </Button>
              </PermissionGate>,
            ]}
          />
        </SortableContext>
      </DndContext>

      {/* 新增/编辑抽屉 */}
      <Drawer
        title={editingRecord ? '编辑赠品方案' : '新增赠品方案'}
        width="75vw"
        open={drawerOpen}
        onClose={closeDrawer}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={closeDrawer}>取消</Button>
            <Button
              type="primary"
              onClick={handleSubmit}
              loading={createMutation.isPending || updateMutation.isPending}
            >
              {editingRecord ? '保存修改' : '创建方案'}
            </Button>
          </Space>
        }
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            status: 'ACTIVE',
            coverMode: 'AUTO_GRID',
            items: [{ quantity: 1 }],
          }}
        >
          {/* ===== 基本信息 ===== */}
          <Divider orientation="left">基本信息</Divider>

          <Form.Item
            name="title"
            label="方案标题"
            rules={[
              { required: true, message: '请输入方案标题' },
              { max: 60, message: '方案标题不能超过60个字符' },
            ]}
          >
            <Input placeholder="如：甄选红酒礼遇" maxLength={60} showCount />
          </Form.Item>

          <Form.Item
            name="subtitle"
            label="副标题"
            rules={[{ max: 120, message: '副标题不能超过120个字符' }]}
          >
            <Input placeholder="如：法国波尔多干红 1 瓶，醇厚果香" maxLength={120} showCount />
          </Form.Item>

          <Form.Item
            name="status"
            label="状态"
            rules={[{ required: true, message: '请选择状态' }]}
          >
            <Select
              style={{ width: 200 }}
              options={[
                { label: '上架', value: 'ACTIVE' },
                { label: '下架', value: 'INACTIVE' },
              ]}
            />
          </Form.Item>

          <Form.Item name="packageId" label="所属档位" rules={[{ required: true, message: '请选择档位' }]}>
            <Select
              placeholder="选择档位"
              options={packages.map(p => ({ label: `¥${p.price}`, value: p.id }))}
            />
          </Form.Item>

          {/* ===== 商品列表 ===== */}
          <Divider orientation="left">组合商品</Divider>

          <Form.List
            name="items"
            rules={[
              {
                validator: async (_, items) => {
                  if (!items || items.length === 0) {
                    return Promise.reject(new Error('至少需要添加一件商品'));
                  }
                  if (items.length > 20) {
                    return Promise.reject(new Error('最多添加 20 件商品'));
                  }
                },
              },
            ]}
          >
            {(fields, { add, remove }, { errors }) => {
              // 同步 index → key 映射供 calculateSummary 使用
              fieldKeysRef.current = fields.map((f) => f.key);
              return (
                <>
                  {fields.map((field) => (
                    <ItemRow
                      key={field.key}
                      field={field}
                      rowKey={field.key}
                      rowStates={rowStates}
                      form={form}
                      onProductSearch={handleRowProductSearch}
                      onProductChange={handleRowProductChange}
                      onRemove={fields.length > 1 ? () => {
                        remove(field.name);
                        // 清理行状态（使用 field.key，不受重新索引影响）
                        setRowStates((prev) => {
                          const next = { ...prev };
                          delete next[field.key];
                          return next;
                        });
                      } : undefined}
                      useRowProducts={useRowProducts}
                      useRowSkus={useRowSkus}
                    />
                  ))}
                  <Form.Item>
                    <Button
                      type="dashed"
                      onClick={() => add({ quantity: 1 })}
                      block
                      icon={<PlusOutlined />}
                      disabled={fields.length >= 20}
                    >
                      添加商品{fields.length >= 20 ? '（已达上限）' : ''}
                    </Button>
                    <Form.ErrorList errors={errors} />
                  </Form.Item>
                </>
              );
            }}
          </Form.List>

          {/* 价格统计 */}
          {watchedItems.length > 0 && (
            <Card size="small" style={{ marginBottom: 24, background: '#fafafa' }}>
              <Text>
                {summary.itemCount} 件商品，共 {summary.totalQty} 件，总价{' '}
                <Text strong style={{ color: '#C9A96E', fontSize: 16 }}>
                  ¥{summary.totalPrice.toFixed(2)}
                </Text>
              </Text>
            </Card>
          )}

          {/* ===== 封面样式（仅多商品时显示） ===== */}
          {watchedItems.length > 1 && (
            <>
              <Divider orientation="left">封面样式</Divider>

              <Form.Item name="coverMode" label="封面样式">
                <Radio.Group>
                  <Radio value="AUTO_GRID">宫格拼图</Radio>
                  <Radio value="AUTO_DIAGONAL">对角线分割</Radio>
                  <Radio value="AUTO_STACKED">层叠卡片</Radio>
                  <Radio value="CUSTOM">自定义上传</Radio>
                </Radio.Group>
              </Form.Item>

              {/* 封面预览 */}
              {watchedCoverMode !== 'CUSTOM' && (
                <CoverPreview
                  mode={(watchedCoverMode || 'AUTO_GRID') as CoverMode}
                  images={getItemImages()}
                />
              )}

              {watchedCoverMode === 'CUSTOM' && (
                <Form.Item
                  name="coverUrl"
                  label="自定义封面图片"
                  rules={[{ required: true, message: '请上传封面图片' }]}
                >
                  <Input placeholder="输入封面图片 URL" />
                </Form.Item>
              )}
            </>
          )}
        </Form>
      </Drawer>

      {/* VIP 档位新增/编辑弹窗 */}
      <Modal
        title={editingPkg ? '编辑档位' : '新增档位'}
        open={pkgModalOpen}
        onCancel={() => setPkgModalOpen(false)}
        onOk={async () => {
          const values = await pkgForm.validateFields();
          const data = {
            price: values.price,
            referralBonusRate: values.referralBonusRate / 100,
            status: values.status,
          };
          if (editingPkg) {
            await updatePkgMutation.mutateAsync({ id: editingPkg.id, data });
          } else {
            await createPkgMutation.mutateAsync(data);
          }
          setPkgModalOpen(false);
        }}
        confirmLoading={createPkgMutation.isPending || updatePkgMutation.isPending}
      >
        <Form form={pkgForm} layout="vertical" initialValues={{ referralBonusRate: 15, status: 'ACTIVE' }}>
          <Form.Item name="price" label="价格" rules={[{ required: true, message: '请输入价格' }]}>
            <InputNumber min={0.01} max={99999} precision={2} addonAfter="元" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="referralBonusRate"
            label="推荐奖励比例"
            rules={[{ required: true, message: '请输入比例' }]}
            extra={
              watchedPkgBonus !== null ? (
                <span style={{ color: '#C9A96E' }}>
                  推荐人每单可得奖励：<Text strong style={{ color: '#C9A96E' }}>¥{watchedPkgBonus.toFixed(2)}</Text>
                </span>
              ) : (
                '填入价格和比例后自动计算'
              )
            }
          >
            <InputNumber min={0} max={100} precision={1} addonAfter="%" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Radio.Group>
              <Radio value="ACTIVE">上架</Radio>
              <Radio value="INACTIVE">下架</Radio>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// ========== 每行商品选择器组件 ==========
interface ItemRowProps {
  field: { key: number; name: number };
  rowKey: number;
  rowStates: Record<number, RowProductState>;
  form: ReturnType<typeof Form.useForm>[0];
  onProductSearch: (rowKey: number, val: string) => void;
  onProductChange: (rowKey: number, fieldName: number, productId: string | undefined, products: RewardProduct[]) => void;
  onRemove?: () => void;
  useRowProducts: (rowKey: number) => { products: RewardProduct[]; loading: boolean };
  useRowSkus: (rowKey: number) => { skus: RewardSkuOption[]; loading: boolean };
}

function ItemRow({
  field,
  rowKey,
  rowStates,
  form,
  onProductSearch,
  onProductChange,
  onRemove,
  useRowProducts,
  useRowSkus,
}: ItemRowProps) {
  const { products, loading: productsLoading } = useRowProducts(rowKey);
  const { skus, loading: skusLoading } = useRowSkus(rowKey);
  const selectedProductId = rowStates[rowKey]?.selectedProductId;

  // 获取当前行表单值来计算小计（field.name 是当前在数组中的索引）
  const items = Form.useWatch('items', form) || [];
  const currentItem = items[field.name];
  const selectedSkuId = currentItem?.skuId;
  const quantity = currentItem?.quantity ?? 1;

  // 找到选中的 SKU 信息
  const selectedSku = skus.find((s) => s.id === selectedSkuId);
  const subtotal = selectedSku ? selectedSku.price * quantity : 0;

  // 获取商品图片
  const selectedProduct = products.find((p) => p.id === selectedProductId);
  const imageUrl = selectedProduct?.media?.[0]?.url;

  // SKU 下拉选项
  const skuOptions = skus.map((sku) => ({
    label: `${sku.title} - ¥${sku.price.toFixed(2)} (库存: ${sku.stock})`,
    value: sku.id,
  }));

  return (
    <Card
      size="small"
      style={{ marginBottom: 12 }}
      styles={{ body: { padding: '12px 16px' } }}
    >
      <Flex gap={12} align="start">
        {/* 商品缩略图 */}
        <div style={{ flexShrink: 0, width: 48, height: 48, marginTop: 30 }}>
          {imageUrl ? (
            <Image
              src={imageUrl}
              width={48}
              height={48}
              style={{ objectFit: 'cover', borderRadius: 4 }}
              preview={false}
              fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
            />
          ) : (
            <div
              style={{
                width: 48,
                height: 48,
                background: '#f5f5f5',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <GiftOutlined style={{ color: '#ccc' }} />
            </div>
          )}
        </div>

        {/* 奖励商品选择 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Form.Item
            {...field}
            name={[field.name, 'productId']}
            label="奖励商品"
            rules={[{ required: true, message: '请选择奖励商品' }]}
            style={{ marginBottom: 8 }}
          >
            <Select
              showSearch
              allowClear
              placeholder="搜索并选择奖励商品"
              onChange={(val) => onProductChange(rowKey, field.name, val, products)}
              onSearch={(val) => onProductSearch(rowKey, val)}
              filterOption={false}
              loading={productsLoading}
              options={products.map((p) => ({
                label: `${p.title} (¥${p.basePrice.toFixed(2)})`,
                value: p.id,
              }))}
              notFoundContent={productsLoading ? '加载中...' : '暂无奖励商品'}
            />
          </Form.Item>
        </div>

        {/* 商品规格选择 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Form.Item
            {...field}
            name={[field.name, 'skuId']}
            label="商品规格"
            rules={[{ required: true, message: '请选择商品规格' }]}
            style={{ marginBottom: 8 }}
          >
            <Select
              allowClear
              placeholder={selectedProductId ? '请选择商品规格' : '请先选择奖励商品'}
              disabled={!selectedProductId}
              loading={skusLoading}
              options={skuOptions}
              notFoundContent={selectedProductId ? '该商品暂无规格' : '请先选择商品'}
            />
          </Form.Item>
        </div>

        {/* 数量 */}
        <div style={{ width: 100, flexShrink: 0 }}>
          <Form.Item
            {...field}
            name={[field.name, 'quantity']}
            label="数量"
            rules={[{ required: true, message: '请输入数量' }]}
            style={{ marginBottom: 8 }}
          >
            <InputNumber min={1} max={99} style={{ width: '100%' }} />
          </Form.Item>
        </div>

        {/* 价格小计 */}
        <div style={{ width: 140, flexShrink: 0, marginTop: 30 }}>
          {selectedSku ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              ¥{selectedSku.price.toFixed(2)} × {quantity} ={' '}
              <Text strong>¥{subtotal.toFixed(2)}</Text>
            </Text>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              选择规格后显示价格
            </Text>
          )}
        </div>

        {/* 删除按钮 */}
        <div style={{ flexShrink: 0, marginTop: 30 }}>
          {onRemove ? (
            <Button
              type="text"
              danger
              icon={<CloseOutlined />}
              onClick={onRemove}
              size="small"
            />
          ) : (
            <div style={{ width: 24 }} />
          )}
        </div>
      </Flex>
    </Card>
  );
}
