import { useState, useEffect } from 'react';
import { Card, Button, Input, message, Tag, Typography, Space, Empty, Spin } from 'antd';
import { DeleteOutlined, HolderOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getConfig, updateConfig } from '@/api/config';
import { getTags } from '@/api/tags';

const { Title, Text } = Typography;

type FilterItem = { tagId: string; icon: string };
type TagOption = { id: string; name: string; categoryName: string };

/** 可拖拽的筛选项行 */
function SortableFilterItem({
  item,
  tagName,
  onIconChange,
  onRemove,
}: {
  item: FilterItem;
  tagName: string;
  onIconChange: (tagId: string, icon: string) => void;
  onRemove: (tagId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.tagId,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        marginBottom: 4,
        background: '#fafafa',
        borderRadius: 6,
        border: '1px solid #f0f0f0',
      }}
    >
      <HolderOutlined
        {...attributes}
        {...listeners}
        style={{ cursor: 'grab', color: '#999', fontSize: 16 }}
      />
      <Input
        value={item.icon}
        onChange={(e) => onIconChange(item.tagId, e.target.value)}
        style={{ width: 50, textAlign: 'center', fontSize: 18 }}
        maxLength={2}
      />
      <Text style={{ flex: 1 }}>{tagName}</Text>
      <Button
        type="text"
        danger
        size="small"
        icon={<DeleteOutlined />}
        onClick={() => onRemove(item.tagId)}
      />
    </div>
  );
}

export default function DiscoveryFiltersPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<FilterItem[]>([]);
  const [dirty, setDirty] = useState(false);

  // 加载当前配置
  const { data: configData, isLoading: configLoading } = useQuery({
    queryKey: ['admin', 'config', 'DISCOVERY_COMPANY_FILTERS'],
    queryFn: () => getConfig('DISCOVERY_COMPANY_FILTERS').catch(() => null),
  });

  // 加载所有 COMPANY scope 标签
  const { data: allTags = [], isLoading: tagsLoading } = useQuery({
    queryKey: ['admin', 'tags', 'company-scope'],
    queryFn: async () => {
      const tags = await getTags({ scope: 'COMPANY' });
      return (tags as any[]).map((t: any) => ({
        id: t.id,
        name: t.name,
        categoryName: t.category?.name || '',
      })) as TagOption[];
    },
  });

  // 标签 ID → 名称映射
  const tagNameMap = new Map(allTags.map((t) => [t.id, t.name]));

  // 按类别分组（左侧标签池）
  const tagsByCategory = allTags.reduce<Record<string, TagOption[]>>((acc, t) => {
    const cat = t.categoryName || '未分类';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(t);
    return acc;
  }, {});

  // 已选 tagId 集合
  const selectedIds = new Set(filters.map((f) => f.tagId));

  // 初始化
  useEffect(() => {
    if (configData?.value && Array.isArray(configData.value)) {
      setFilters(configData.value as FilterItem[]);
    }
  }, [configData]);

  // 保存
  const saveMutation = useMutation({
    mutationFn: () =>
      updateConfig('DISCOVERY_COMPANY_FILTERS', {
        value: filters,
        changeNote: '更新发现页企业筛选配置',
      }),
    onSuccess: () => {
      message.success('保存成功');
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'config'] });
    },
    onError: (err: any) => {
      message.error(err?.message || '保存失败');
    },
  });

  // 拖拽
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setFilters((prev) => {
        const oldIndex = prev.findIndex((f) => f.tagId === active.id);
        const newIndex = prev.findIndex((f) => f.tagId === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
      setDirty(true);
    }
  };

  const handleAdd = (tag: TagOption) => {
    if (selectedIds.has(tag.id)) return;
    setFilters((prev) => [...prev, { tagId: tag.id, icon: '🏷️' }]);
    setDirty(true);
  };

  const handleRemove = (tagId: string) => {
    setFilters((prev) => prev.filter((f) => f.tagId !== tagId));
    setDirty(true);
  };

  const handleIconChange = (tagId: string, icon: string) => {
    setFilters((prev) => prev.map((f) => (f.tagId === tagId ? { ...f, icon } : f)));
    setDirty(true);
  };

  if (configLoading || tagsLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>发现页企业筛选配置</Title>
        <Button type="primary" onClick={() => saveMutation.mutate()} loading={saveMutation.isPending} disabled={!dirty}>
          保存配置
        </Button>
      </div>

      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        配置买家 App 发现页「企业」标签页顶部的筛选标签。「全部」固定在最前，「附近」固定在最后，不可编辑。
      </Text>

      <div style={{ display: 'flex', gap: 16 }}>
        {/* 左栏：标签池 */}
        <Card title="标签池" style={{ flex: 1 }} size="small">
          {Object.entries(tagsByCategory).map(([category, tags]) => (
            <div key={category} style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>{category}</Text>
              <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {tags.map((tag) => (
                  <Tag
                    key={tag.id}
                    style={{
                      cursor: selectedIds.has(tag.id) ? 'not-allowed' : 'pointer',
                      opacity: selectedIds.has(tag.id) ? 0.4 : 1,
                    }}
                    color={selectedIds.has(tag.id) ? 'default' : 'blue'}
                    onClick={() => handleAdd(tag)}
                  >
                    {tag.name}
                  </Tag>
                ))}
              </div>
            </div>
          ))}
        </Card>

        {/* 右栏：已选筛选项 */}
        <Card title="已选筛选项（拖拽排序）" style={{ flex: 1 }} size="small">
          {/* 固定首项提示 */}
          <div
            style={{
              padding: '8px 12px',
              marginBottom: 4,
              background: '#f6ffed',
              borderRadius: 6,
              border: '1px dashed #b7eb8f',
              color: '#999',
            }}
          >
            🏠 全部（固定首位）
          </div>

          {filters.length === 0 ? (
            <Empty description="点击左侧标签添加筛选项" style={{ margin: '24px 0' }} />
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={filters.map((f) => f.tagId)} strategy={verticalListSortingStrategy}>
                {filters.map((item) => (
                  <SortableFilterItem
                    key={item.tagId}
                    item={item}
                    tagName={tagNameMap.get(item.tagId) || item.tagId}
                    onIconChange={handleIconChange}
                    onRemove={handleRemove}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}

          {/* 固定末项提示 */}
          <div
            style={{
              padding: '8px 12px',
              marginTop: 4,
              background: '#f6ffed',
              borderRadius: 6,
              border: '1px dashed #b7eb8f',
              color: '#999',
            }}
          >
            📍 附近（固定末位）
          </div>
        </Card>
      </div>
    </div>
  );
}
