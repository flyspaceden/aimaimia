import { App, Badge, Button, Card, Empty, List, Space, Spin, Tag, Typography } from 'antd';
import { CheckCircleOutlined, RightOutlined } from '@ant-design/icons';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { NotificationsApi, type NotificationAction, type NotificationItem } from '@/api/notifications';

const categoryLabels: Record<string, string> = {
  after_sale: '售后',
  invoice: '发票',
  risk: '风险',
  service: '客服',
  wallet: '资金',
};

function resolveAdminNotificationRoute(action?: NotificationAction): string | null {
  if (!action?.routeKey) return null;
  const id = action.params?.id;

  switch (action.routeKey) {
    case 'ADMIN_AFTER_SALE_DETAIL':
      return id ? `/after-sale?afterSaleId=${encodeURIComponent(id)}` : '/after-sale';
    case 'ADMIN_INVOICE_DETAIL':
      return id ? `/invoices/${id}` : '/invoices';
    case 'ADMIN_WITHDRAW_DETAIL':
      return '/bonus/withdrawals';
    case 'ADMIN_CS_WORKSTATION':
      return '/cs/workstation';
    default:
      return null;
  }
}

export default function AdminNotificationsPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const PAGE_SIZE = 20;

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['admin-notifications'],
    queryFn: ({ pageParam = 1 }) => NotificationsApi.list({ page: pageParam as number, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (
      lastPage.length === PAGE_SIZE ? allPages.length + 1 : undefined
    ),
  });
  const notifications = data?.pages.flatMap((page) => page) ?? [];
  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['admin-notification-unread-count'],
    queryFn: NotificationsApi.unreadCount,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const markReadMutation = useMutation({
    mutationFn: NotificationsApi.markRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['admin-notification-unread-count'] });
    },
  });

  const handleOpen = async (item: NotificationItem) => {
    const action = item.action ?? item.target;
    const route = resolveAdminNotificationRoute(action);

    if (item.unread) {
      await markReadMutation.mutateAsync(item.id);
    }

    if (!route) {
      message.info('该消息暂无可跳转页面');
      return;
    }

    navigate(route);
  };

  return (
    <Card
      title="通知中心"
      extra={
        <Typography.Text type="secondary">
          未读 {unreadCount}
        </Typography.Text>
      }
    >
      {isLoading ? (
        <Spin />
      ) : (
        <>
          <List
            dataSource={notifications}
            locale={{ emptyText: <Empty description="暂无通知" /> }}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button
                    key="open"
                    type="link"
                    icon={item.unread ? undefined : <CheckCircleOutlined />}
                    onClick={() => void handleOpen(item)}
                    loading={markReadMutation.isPending && markReadMutation.variables === item.id}
                  >
                    查看 <RightOutlined />
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  avatar={<Badge status={item.unread ? 'processing' : 'default'} />}
                  title={
                    <Space size={8} wrap>
                      <Typography.Text strong={item.unread}>{item.title}</Typography.Text>
                      <Tag color={item.unread ? 'blue' : 'default'}>
                        {categoryLabels[item.category] || item.category}
                      </Tag>
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={4}>
                      <Typography.Text type="secondary">{item.content}</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {dayjs(item.createdAt).format('YYYY-MM-DD HH:mm')}
                      </Typography.Text>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
          {hasNextPage ? (
            <Button block onClick={() => fetchNextPage()} loading={isFetchingNextPage}>
              加载更多
            </Button>
          ) : null}
        </>
      )}
    </Card>
  );
}
