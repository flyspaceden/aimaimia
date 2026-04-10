import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Input,
  Button,
  Tag,
  Badge,
  Avatar,
  Tooltip,
  Empty,
  Spin,
  message,
  Card,
  Divider,
  Typography,
} from 'antd';
import {
  SendOutlined,
  PaperClipOutlined,
  CloseCircleOutlined,
  SwapOutlined,
  SearchOutlined,
  RobotOutlined,
  UserOutlined,
  MessageOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import {
  getCsSessions,
  getCsSessionDetail,
  getCsQuickReplies,
  type CsSession,
  type CsMessage,
  type CsQuickReply,
} from '@/api/cs';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

// 品牌色
const BRAND_COLOR = '#2E7D32';
const BRAND_BG = '#f0fdf4';
const BRAND_LIGHT = '#dcfce7';

// 类别标签颜色
const categoryColorMap: Record<string, { bg: string; text: string; border?: string }> = {
  ORDER: { bg: '#eff6ff', text: '#1d4ed8' },
  PRODUCT: { bg: '#ecfeff', text: '#0e7490' },
  DELIVERY: { bg: '#fff7ed', text: '#c2410c' },
  PAYMENT: { bg: '#fffbeb', text: '#b45309' },
  REFUND: { bg: '#fef2f2', text: '#dc2626' },
  ACCOUNT: { bg: '#faf5ff', text: '#7c3aed' },
  RETURN: { bg: '#fff7ed', text: '#c2410c' },
  VIP: { bg: '#faf5ff', text: '#7c3aed' },
  COMPLAINT: { bg: '#fef2f2', text: '#dc2626' },
  OTHER: { bg: '#f1f5f9', text: '#475569' },
};

// 类别中文映射
const categoryLabelMap: Record<string, string> = {
  ORDER: '订单',
  PRODUCT: '商品',
  DELIVERY: '物流',
  PAYMENT: '支付',
  REFUND: '退款',
  ACCOUNT: '账号',
  RETURN: '退换货',
  VIP: '会员',
  COMPLAINT: '投诉',
  OTHER: '其他',
};

// 优先级标签
const priorityColorMap: Record<string, { bg: string; text: string }> = {
  LOW: { bg: '#f1f5f9', text: '#64748b' },
  MEDIUM: { bg: '#eff6ff', text: '#2563eb' },
  HIGH: { bg: '#fff7ed', text: '#ea580c' },
  URGENT: { bg: '#fef2f2', text: '#dc2626' },
};

const priorityLabelMap: Record<string, string> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
  URGENT: '紧急',
};

// 头像颜色列表（根据用户名首字符生成稳定颜色）
const avatarColors = [
  '#f43f5e', '#ec4899', '#a855f7', '#8b5cf6', '#6366f1',
  '#3b82f6', '#0ea5e9', '#06b6d4', '#14b8a6', '#10b981',
  '#22c55e', '#84cc16', '#eab308', '#f59e0b', '#f97316',
  '#ef4444',
];

function getAvatarColor(name: string): string {
  if (!name) return avatarColors[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

function getAvatarInitial(name: string | null | undefined): string {
  if (!name) return '?';
  return name.charAt(0);
}

function formatTime(dateStr: string): string {
  const d = dayjs(dateStr);
  const now = dayjs();
  if (d.isSame(now, 'day')) {
    return d.format('HH:mm');
  }
  return d.format('MM-DD HH:mm');
}

function formatRelativeTime(dateStr: string): string {
  return dayjs(dateStr).fromNow();
}

// 来源中文映射
function formatSource(source: string, sourceId: string | null): string {
  const sourceMap: Record<string, string> = {
    HOME: '首页',
    ORDER_DETAIL: '订单详情页',
    ORDER_LIST: '订单列表',
    PRODUCT_DETAIL: '商品详情页',
    PROFILE: '个人中心',
    VOICE: '语音助手',
  };
  const label = sourceMap[source] || source;
  if (sourceId) return `来源：${label} · #${sourceId.slice(0, 16)}`;
  return `来源：${label}`;
}

// ===== 子组件 =====

/** 会话列表项 */
function SessionItem({
  session,
  isActive,
  onClick,
  onAccept,
}: {
  session: CsSession;
  isActive: boolean;
  onClick: () => void;
  onAccept?: () => void;
}) {
  const nickname = session.user?.profile?.nickname || '未知用户';
  const initial = getAvatarInitial(nickname);
  const color = getAvatarColor(nickname);
  const category = session.ticket?.category || 'OTHER';
  const catColor = categoryColorMap[category] || categoryColorMap.OTHER;
  const catLabel = categoryLabelMap[category] || category;
  const lastMsg = session.messages?.length
    ? session.messages[session.messages.length - 1]
    : null;
  const isQueuing = session.status === 'QUEUING';
  const isClosed = session.status === 'CLOSED';
  const isHandling = session.status === 'AGENT_HANDLING' || session.status === 'AI_HANDLING';

  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 12px',
        borderBottom: '1px solid #f1f5f9',
        cursor: 'pointer',
        transition: 'all 0.15s',
        backgroundColor: isActive ? BRAND_BG : 'transparent',
        borderLeft: isActive ? `3px solid ${BRAND_COLOR}` : '3px solid transparent',
        opacity: isClosed ? 0.55 : 1,
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.backgroundColor = '#f8fafc';
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {/* 头像 */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              backgroundColor: `${color}18`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              fontWeight: 500,
              color,
            }}
          >
            {initial}
          </div>
          {isHandling && !isClosed && (
            <span
              style={{
                position: 'absolute',
                bottom: -1,
                right: -1,
                width: 10,
                height: 10,
                backgroundColor: '#22c55e',
                border: '2px solid #fff',
                borderRadius: '50%',
              }}
            />
          )}
        </div>

        {/* 信息 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? BRAND_COLOR : '#0f172a',
              }}
            >
              {nickname}
            </span>
            {isQueuing ? (
              <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 500 }}>
                {formatRelativeTime(session.createdAt)}
              </span>
            ) : lastMsg ? (
              <span style={{ fontSize: 11, color: '#94a3b8' }}>
                {formatTime(lastMsg.createdAt)}
              </span>
            ) : null}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <span
              style={{
                padding: '1px 6px',
                borderRadius: 3,
                fontSize: 10,
                fontWeight: 500,
                backgroundColor: catColor.bg,
                color: catColor.text,
              }}
            >
              {catLabel}
            </span>
            <span
              style={{
                fontSize: 12,
                color: isClosed ? '#94a3b8' : '#64748b',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}
            >
              {isClosed
                ? `${session.status === 'CLOSED' ? 'AI已解决' : ''} · ${catLabel}`
                : lastMsg?.content?.slice(0, 30) || '暂无消息'}
            </span>
          </div>
          {isHandling && !isClosed && !isQueuing && (
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
              对话中 · {formatRelativeTime(session.agentJoinedAt || session.createdAt)}
            </div>
          )}
        </div>
      </div>

      {/* 排队中的"接入"按钮 */}
      {isQueuing && onAccept && (
        <div style={{ marginTop: 8, marginLeft: 46 }}>
          <Button
            type="primary"
            size="small"
            style={{
              backgroundColor: BRAND_COLOR,
              borderColor: BRAND_COLOR,
              fontSize: 12,
              height: 26,
              borderRadius: 6,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onAccept();
            }}
          >
            接入
          </Button>
        </div>
      )}
    </div>
  );
}

/** 消息气泡 */
function MessageBubble({ msg, isAiPhase }: { msg: CsMessage; isAiPhase?: boolean }) {
  const isUser = msg.senderType === 'USER';
  const isAI = msg.senderType === 'AI';
  const isAgent = msg.senderType === 'AGENT';
  const isSystem = msg.senderType === 'SYSTEM';

  // 系统消息
  if (isSystem) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
        <span
          style={{
            padding: '4px 12px',
            borderRadius: 20,
            backgroundColor: msg.content.includes('接入') ? '#f0fdf4' : '#f1f5f9',
            color: msg.content.includes('接入') ? '#16a34a' : '#64748b',
            fontSize: 11,
            border: msg.content.includes('接入') ? '1px solid #dcfce7' : 'none',
          }}
        >
          {msg.content}
        </span>
      </div>
    );
  }

  // 用户消息：右对齐，绿色
  if (isUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, margin: '8px 0' }}>
        {msg.contentType === 'IMAGE' ? (
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: 8,
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PaperClipOutlined style={{ fontSize: 24, color: '#fca5a5' }} />
          </div>
        ) : (
          <div
            style={{
              maxWidth: '75%',
              padding: '8px 14px',
              borderRadius: '12px 12px 4px 12px',
              backgroundColor: BRAND_COLOR,
              color: '#fff',
              fontSize: 13,
              lineHeight: 1.5,
              boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
            }}
          >
            {msg.content}
          </div>
        )}
      </div>
    );
  }

  // AI 消息：左对齐，绿色 AI 头像
  if (isAI) {
    return (
      <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            backgroundColor: BRAND_COLOR,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
        </div>
        <div style={{ maxWidth: '75%' }}>
          <div
            style={{
              padding: '8px 14px',
              borderRadius: '4px 12px 12px 12px',
              backgroundColor: '#fff',
              color: '#334155',
              fontSize: 13,
              lineHeight: 1.5,
              boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
            }}
          >
            {msg.content}
          </div>
          {/* ACTION_CONFIRM 类型显示操作卡片 */}
          {msg.contentType === 'ACTION_CONFIRM' && msg.metadata && (
            <div
              style={{
                marginTop: 8,
                padding: 10,
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                backgroundColor: '#fff',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              }}
            >
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                <ThunderboltOutlined style={{ fontSize: 12 }} />
                建议操作
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {(msg.metadata.actions as string[] | undefined)?.map((action, i) => (
                  <Button
                    key={i}
                    size="small"
                    type={i === 0 ? 'primary' : 'default'}
                    style={i === 0 ? {
                      backgroundColor: BRAND_COLOR,
                      borderColor: BRAND_COLOR,
                      fontSize: 12,
                      flex: 1,
                    } : { fontSize: 12, flex: 1 }}
                  >
                    {action}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {/* ACTION_RESULT 类型显示结果卡片 */}
          {msg.contentType === 'ACTION_RESULT' && (
            <div
              style={{
                marginTop: 8,
                padding: 8,
                borderRadius: 8,
                backgroundColor: '#f0fdf4',
                border: '1px solid #dcfce7',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircleOutlined style={{ color: '#16a34a', fontSize: 14 }} />
                <span style={{ fontSize: 12, fontWeight: 500, color: '#15803d' }}>
                  操作完成
                </span>
              </div>
              {msg.metadata && (
                <div style={{ fontSize: 11, color: '#16a34a', marginTop: 4 }}>
                  {JSON.stringify(msg.metadata)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 客服消息：左对齐，白色 + 边框
  if (isAgent) {
    return (
      <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            backgroundColor: '#e0e7ff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 500, color: '#4338ca' }}>客</span>
        </div>
        <div
          style={{
            maxWidth: '75%',
            padding: '8px 14px',
            borderRadius: '4px 12px 12px 12px',
            backgroundColor: '#fff',
            color: '#334155',
            fontSize: 13,
            lineHeight: 1.5,
            boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
            border: '1px solid #f1f5f9',
          }}
        >
          {msg.content}
        </div>
      </div>
    );
  }

  return null;
}

/** 输入指示器（对方正在输入） */
function TypingIndicator() {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, margin: '8px 0' }}>
      <div
        style={{
          padding: '8px 16px',
          borderRadius: 12,
          backgroundColor: '#e2e8f0',
          display: 'flex',
          gap: 4,
          alignItems: 'center',
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: '#64748b',
              animation: 'typing 1.2s ease-in-out infinite',
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ===== 主组件 =====

export default function CsWorkstationPage() {
  // 状态
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [localMessages, setLocalMessages] = useState<Map<string, CsMessage[]>>(new Map());
  const [inputValue, setInputValue] = useState('');
  const [typingSessionId, setTypingSessionId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // 查询：会话列表
  const { data: sessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ['admin', 'cs', 'sessions'],
    queryFn: () => getCsSessions(),
    refetchInterval: 10000, // 每 10 秒刷新（作为 WebSocket 降级方案）
  });

  // 查询：当前选中会话详情
  const { data: sessionDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['admin', 'cs', 'session', activeSessionId],
    queryFn: () => getCsSessionDetail(activeSessionId!),
    enabled: !!activeSessionId,
  });

  // 查询：快捷回复
  const { data: quickReplies = [] } = useQuery({
    queryKey: ['admin', 'cs', 'quick-replies'],
    queryFn: () => getCsQuickReplies(),
  });

  // Socket.IO 连接
  useEffect(() => {
    const socket = io(
      `${import.meta.env.VITE_WS_BASE_URL || 'http://localhost:3000'}/cs`,
      {
        auth: { token: localStorage.getItem('admin_token') },
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
      },
    );

    socket.on('connect', () => {
      console.log('[CS Workstation] Socket 已连接');
    });

    socket.on('disconnect', (reason) => {
      console.log('[CS Workstation] Socket 断开:', reason);
    });

    socket.on('connect_error', (err) => {
      console.warn('[CS Workstation] Socket 连接失败:', err.message);
    });

    // 收到新消息
    socket.on('cs:message', (msg: CsMessage) => {
      setLocalMessages((prev) => {
        const next = new Map(prev);
        const existing = next.get(msg.sessionId) || [];
        // 避免重复
        if (existing.some((m) => m.id === msg.id)) return prev;
        next.set(msg.sessionId, [...existing, msg]);
        return next;
      });
      // 刷新会话列表以更新最后消息预览
      queryClient.invalidateQueries({ queryKey: ['admin', 'cs', 'sessions'] });
    });

    // 新工单进入排队
    socket.on('cs:new_ticket', () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'cs', 'sessions'] });
      message.info('有新的客户咨询排队中');
    });

    // 客服接入
    socket.on('cs:agent_joined', (data: { sessionId: string }) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'cs', 'sessions'] });
      queryClient.invalidateQueries({
        queryKey: ['admin', 'cs', 'session', data.sessionId],
      });
    });

    // 会话关闭（强制结束 或 买家端关闭 或 超时自动关闭）
    socket.on('cs:session_closed', (data: { sessionId: string }) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'cs', 'sessions'] });
      queryClient.invalidateQueries({
        queryKey: ['admin', 'cs', 'session', data.sessionId],
      });
      // 如果当前正在查看该会话，自动取消选中
      setActiveSessionId((prev) => (prev === data.sessionId ? null : prev));
    });

    // 坐席完成处理（柔性脱身：会话退回 AI_HANDLING）
    socket.on('cs:agent_released', (data: { sessionId: string }) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'cs', 'sessions'] });
      queryClient.invalidateQueries({
        queryKey: ['admin', 'cs', 'session', data.sessionId],
      });
      // 如果当前正在查看该会话，自动取消选中（其他坐席视角）
      setActiveSessionId((prev) => (prev === data.sessionId ? null : prev));
    });

    // 服务端错误反馈
    socket.on('cs:error', (data: { message: string }) => {
      message.error(data?.message || '操作失败');
    });

    // 对方正在输入
    socket.on('cs:typing', (data: { sessionId: string }) => {
      setTypingSessionId(data.sessionId);
      // 3 秒后自动清除
      setTimeout(() => {
        setTypingSessionId((prev) => (prev === data.sessionId ? null : prev));
      }, 3000);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, [queryClient]);

  // 当 sessionDetail 返回时，用 server 消息覆盖 local
  useEffect(() => {
    if (sessionDetail?.messages && activeSessionId) {
      setLocalMessages((prev) => {
        const next = new Map(prev);
        const serverMsgs = sessionDetail.messages;
        const localMsgs = prev.get(activeSessionId) || [];
        // 合并：server 为基础，追加本地独有的消息
        const serverIds = new Set(serverMsgs.map((m) => m.id));
        const merged = [
          ...serverMsgs,
          ...localMsgs.filter((m) => !serverIds.has(m.id)),
        ];
        merged.sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        next.set(activeSessionId, merged);
        return next;
      });
    }
  }, [sessionDetail, activeSessionId]);

  // 滚动到最新消息
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [localMessages, activeSessionId]);

  // 获取当前会话的消息
  const currentMessages = useMemo(() => {
    if (!activeSessionId) return [];
    return localMessages.get(activeSessionId) || [];
  }, [localMessages, activeSessionId]);

  // 获取当前选中的 session 对象
  const activeSession = useMemo(() => {
    if (!activeSessionId) return null;
    return sessions.find((s) => s.id === activeSessionId) || sessionDetail || null;
  }, [sessions, activeSessionId, sessionDetail]);

  // 按状态分组的会话列表
  const groupedSessions = useMemo(() => {
    const filtered = searchText
      ? sessions.filter((s) => {
          const name = s.user?.profile?.nickname || '';
          return name.includes(searchText);
        })
      : sessions;

    const queuing = filtered.filter((s) => s.status === 'QUEUING');
    const handling = filtered.filter(
      (s) => s.status === 'AGENT_HANDLING' || s.status === 'AI_HANDLING',
    );
    const closed = filtered.filter((s) => s.status === 'CLOSED');

    return { queuing, handling, closed };
  }, [sessions, searchText]);

  // 发送消息
  const handleSend = useCallback(() => {
    if (!inputValue.trim() || !activeSessionId) return;

    const tempMsg: CsMessage = {
      id: `temp-${Date.now()}`,
      sessionId: activeSessionId,
      senderType: 'AGENT',
      senderId: null,
      contentType: 'TEXT',
      content: inputValue.trim(),
      metadata: null,
      routeLayer: null,
      createdAt: new Date().toISOString(),
    };

    // 乐观更新：立即显示
    setLocalMessages((prev) => {
      const next = new Map(prev);
      const existing = next.get(activeSessionId) || [];
      next.set(activeSessionId, [...existing, tempMsg]);
      return next;
    });

    // 通过 Socket 发送
    socketRef.current?.emit('cs:send', {
      sessionId: activeSessionId,
      content: inputValue.trim(),
      contentType: 'TEXT',
    });

    setInputValue('');
  }, [inputValue, activeSessionId]);

  // 接入排队会话
  const handleAccept = useCallback(
    (sessionId: string) => {
      socketRef.current?.emit('cs:accept_ticket', { sessionId });
      setActiveSessionId(sessionId);
      queryClient.invalidateQueries({ queryKey: ['admin', 'cs', 'sessions'] });
      message.success('已接入会话');
    },
    [queryClient],
  );

  // 完成处理（柔性脱身）：仅释放自己，会话保留供用户继续咨询
  const handleRelease = useCallback(() => {
    if (!activeSessionId) return;
    socketRef.current?.emit('cs:release_session', { sessionId: activeSessionId });
    // 清除当前选中 + 刷新列表
    setActiveSessionId(null);
    setLocalMessages((prev) => {
      const next = new Map(prev);
      next.delete(activeSessionId);
      return next;
    });
    queryClient.invalidateQueries({ queryKey: ['admin', 'cs', 'sessions'] });
    message.success('已完成处理');
  }, [activeSessionId, queryClient]);

  // 强制关闭（特殊情况：恶意/违规，需要二次确认）
  const handleForceClose = useCallback(() => {
    if (!activeSessionId) return;
    if (!window.confirm('强制结束会话会立即关闭对话，用户将无法继续。仅在异常情况（违规/恶意）使用。确定继续吗？')) return;
    socketRef.current?.emit('cs:close_session', { sessionId: activeSessionId });
    setActiveSessionId(null);
    setLocalMessages((prev) => {
      const next = new Map(prev);
      next.delete(activeSessionId);
      return next;
    });
    queryClient.invalidateQueries({ queryKey: ['admin', 'cs', 'sessions'] });
    message.success('会话已强制关闭');
  }, [activeSessionId, queryClient]);

  // 转接
  const handleTransfer = useCallback(() => {
    message.info('转接功能开发中');
  }, []);

  // 快捷回复插入
  const handleQuickReply = useCallback((content: string) => {
    setInputValue(content);
  }, []);

  // 键盘快捷键
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // 将消息分成 AI 阶段和人工阶段
  const messageGroups = useMemo(() => {
    const groups: Array<{ type: 'ai_phase' | 'normal'; messages: CsMessage[] }> = [];
    let currentGroup: CsMessage[] = [];
    let isAiPhase = true; // 开始默认是 AI 阶段

    for (const msg of currentMessages) {
      if (msg.senderType === 'SYSTEM' && msg.content.includes('接入')) {
        // 系统消息"已接入"标志 AI 阶段结束
        if (currentGroup.length > 0) {
          groups.push({ type: 'ai_phase', messages: currentGroup });
          currentGroup = [];
        }
        isAiPhase = false;
        groups.push({ type: 'normal', messages: [msg] });
        continue;
      }

      if (isAiPhase) {
        currentGroup.push(msg);
      } else {
        if (msg.senderType === 'SYSTEM') {
          groups.push({ type: 'normal', messages: [msg] });
        } else {
          // 合并连续的非系统消息到一个 group
          const lastGroup = groups[groups.length - 1];
          if (lastGroup && lastGroup.type === 'normal' && lastGroup.messages[lastGroup.messages.length - 1]?.senderType !== 'SYSTEM') {
            lastGroup.messages.push(msg);
          } else {
            groups.push({ type: 'normal', messages: [msg] });
          }
        }
      }
    }

    if (currentGroup.length > 0) {
      groups.push({ type: isAiPhase ? 'ai_phase' : 'normal', messages: currentGroup });
    }

    return groups;
  }, [currentMessages]);

  // ===== 渲染 =====
  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 96px)', gap: 16, padding: '0 0 16px' }}>
      {/* 全局动画样式 */}
      <style>{`
        @keyframes typing {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        @keyframes pulseDot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/* ===== 左列：会话列表 ===== */}
      <div
        style={{
          width: 280,
          flexShrink: 0,
          backgroundColor: '#fff',
          borderRadius: 12,
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* 搜索 */}
        <div style={{ padding: 12, borderBottom: '1px solid #f1f5f9' }}>
          <Input
            placeholder="搜索用户..."
            prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{
              backgroundColor: '#f8fafc',
              borderColor: '#e2e8f0',
              borderRadius: 8,
            }}
            allowClear
          />
        </div>

        {/* 会话列表 */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {sessionsLoading ? (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <Spin />
            </div>
          ) : (
            <>
              {/* 排队中 */}
              <div
                style={{
                  padding: '8px 12px',
                  backgroundColor: '#f8fafc',
                  borderBottom: '1px solid #f1f5f9',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>
                  排队中
                </span>
                {groupedSessions.queuing.length > 0 && (
                  <Badge
                    count={groupedSessions.queuing.length}
                    style={{ backgroundColor: '#fecaca', color: '#b91c1c' }}
                  />
                )}
              </div>
              {groupedSessions.queuing.length === 0 ? (
                <div style={{ padding: '12px 16px', color: '#94a3b8', fontSize: 12 }}>
                  暂无排队
                </div>
              ) : (
                groupedSessions.queuing.map((s) => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    isActive={activeSessionId === s.id}
                    onClick={() => setActiveSessionId(s.id)}
                    onAccept={() => handleAccept(s.id)}
                  />
                ))
              )}

              {/* 处理中 */}
              <div
                style={{
                  padding: '8px 12px',
                  backgroundColor: '#f8fafc',
                  borderBottom: '1px solid #f1f5f9',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>
                  处理中
                </span>
                {groupedSessions.handling.length > 0 && (
                  <Badge
                    count={groupedSessions.handling.length}
                    style={{ backgroundColor: BRAND_LIGHT, color: BRAND_COLOR }}
                  />
                )}
              </div>
              {groupedSessions.handling.length === 0 ? (
                <div style={{ padding: '12px 16px', color: '#94a3b8', fontSize: 12 }}>
                  暂无处理中会话
                </div>
              ) : (
                groupedSessions.handling.map((s) => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    isActive={activeSessionId === s.id}
                    onClick={() => setActiveSessionId(s.id)}
                  />
                ))
              )}

              {/* 今日已结束 */}
              <div
                style={{
                  padding: '8px 12px',
                  backgroundColor: '#f8fafc',
                  borderBottom: '1px solid #f1f5f9',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>
                  今日已结束
                </span>
                {groupedSessions.closed.length > 0 && (
                  <Badge
                    count={groupedSessions.closed.length}
                    style={{ backgroundColor: '#e2e8f0', color: '#64748b' }}
                  />
                )}
              </div>
              {groupedSessions.closed.length === 0 ? (
                <div style={{ padding: '12px 16px', color: '#94a3b8', fontSize: 12 }}>
                  暂无已结束会话
                </div>
              ) : (
                groupedSessions.closed.map((s) => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    isActive={activeSessionId === s.id}
                    onClick={() => setActiveSessionId(s.id)}
                  />
                ))
              )}
            </>
          )}
        </div>
      </div>

      {/* ===== 中列：聊天区域 ===== */}
      <div
        style={{
          flex: 1,
          backgroundColor: '#fff',
          borderRadius: 12,
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {!activeSession ? (
          // 未选中会话
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94a3b8',
            }}
          >
            <MessageOutlined style={{ fontSize: 48, marginBottom: 16, color: '#cbd5e1' }} />
            <div style={{ fontSize: 16, fontWeight: 500, color: '#64748b' }}>
              选择一个会话开始对话
            </div>
            <div style={{ fontSize: 13, marginTop: 8, color: '#94a3b8' }}>
              从左侧列表选择或接入排队中的用户
            </div>
          </div>
        ) : (
          <>
            {/* 聊天头部 */}
            <div
              style={{
                padding: '12px 20px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    backgroundColor: `${getAvatarColor(activeSession.user?.profile?.nickname || '')}18`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    fontWeight: 500,
                    color: getAvatarColor(activeSession.user?.profile?.nickname || ''),
                  }}
                >
                  {getAvatarInitial(activeSession.user?.profile?.nickname)}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
                      {activeSession.user?.profile?.nickname || '未知用户'}
                    </span>
                    {activeSession.ticket?.category && (
                      <span
                        style={{
                          padding: '1px 6px',
                          borderRadius: 3,
                          fontSize: 10,
                          fontWeight: 500,
                          backgroundColor:
                            (categoryColorMap[activeSession.ticket.category] || categoryColorMap.OTHER)
                              .bg,
                          color:
                            (categoryColorMap[activeSession.ticket.category] || categoryColorMap.OTHER)
                              .text,
                        }}
                      >
                        {categoryLabelMap[activeSession.ticket.category] || activeSession.ticket.category}咨询
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                    {formatSource(activeSession.source, activeSession.sourceId)}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                {activeSession.status === 'CLOSED' ? (
                  <span
                    style={{
                      padding: '6px 12px',
                      borderRadius: 8,
                      fontSize: 12,
                      backgroundColor: '#f1f5f9',
                      color: '#94a3b8',
                    }}
                  >
                    会话已结束
                  </span>
                ) : activeSession.status === 'AGENT_HANDLING' ? (
                  <>
                    <Button
                      size="small"
                      icon={<SwapOutlined />}
                      onClick={handleTransfer}
                      style={{
                        borderRadius: 8,
                        fontSize: 12,
                        height: 32,
                        color: '#475569',
                        backgroundColor: '#f1f5f9',
                        borderColor: '#f1f5f9',
                      }}
                    >
                      转接
                    </Button>
                    <Button
                      size="small"
                      icon={<CheckCircleOutlined />}
                      onClick={handleRelease}
                      type="primary"
                      style={{
                        borderRadius: 8,
                        fontSize: 12,
                        height: 32,
                        backgroundColor: '#2E7D32',
                        borderColor: '#2E7D32',
                      }}
                      title="完成本次服务，会话保留供用户继续咨询"
                    >
                      完成处理
                    </Button>
                    <Button
                      size="small"
                      icon={<CloseCircleOutlined />}
                      onClick={handleForceClose}
                      danger
                      style={{
                        borderRadius: 8,
                        fontSize: 12,
                        height: 32,
                      }}
                      title="强制关闭（仅违规情况使用）"
                    >
                      强制结束
                    </Button>
                  </>
                ) : activeSession.status === 'AI_HANDLING' ? (
                  <span
                    style={{
                      padding: '6px 12px',
                      borderRadius: 8,
                      fontSize: 12,
                      backgroundColor: '#e0f2fe',
                      color: '#0369a1',
                    }}
                  >
                    AI 自助中（坐席未接入）
                  </span>
                ) : activeSession.status === 'QUEUING' ? (
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => {
                      socketRef.current?.emit('cs:accept_ticket', { sessionId: activeSession.id });
                      message.success('已接入');
                    }}
                    style={{
                      borderRadius: 8,
                      fontSize: 12,
                      height: 32,
                      backgroundColor: '#2E7D32',
                      borderColor: '#2E7D32',
                    }}
                  >
                    接入会话
                  </Button>
                ) : null}
              </div>
            </div>

            {/* 消息列表 */}
            <div
              style={{
                flex: 1,
                overflow: 'auto',
                padding: '16px 20px',
                backgroundColor: '#fafbfc',
              }}
            >
              {detailLoading ? (
                <div style={{ padding: 40, textAlign: 'center' }}>
                  <Spin tip="加载消息中..." />
                </div>
              ) : currentMessages.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                  暂无消息
                </div>
              ) : (
                <>
                  {messageGroups.map((group, gi) => {
                    if (group.type === 'ai_phase') {
                      return (
                        <div
                          key={`group-${gi}`}
                          style={{
                            backgroundColor: 'rgba(241, 245, 249, 0.6)',
                            borderRadius: 12,
                            padding: 16,
                            marginBottom: 12,
                            border: '1px solid rgba(226, 232, 240, 0.6)',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              marginBottom: 8,
                            }}
                          >
                            <RobotOutlined style={{ fontSize: 12, color: '#94a3b8' }} />
                            <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>
                              AI 接待阶段
                            </span>
                          </div>
                          {group.messages.map((msg) => (
                            <MessageBubble key={msg.id} msg={msg} isAiPhase />
                          ))}
                        </div>
                      );
                    }
                    return group.messages.map((msg) => (
                      <MessageBubble key={msg.id} msg={msg} />
                    ));
                  })}
                  {/* 输入指示器 */}
                  {typingSessionId === activeSessionId && <TypingIndicator />}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* 输入区域 */}
            <div style={{ borderTop: '1px solid #e2e8f0', padding: 16 }}>
              {/* 快捷回复 */}
              {quickReplies.length > 0 && (
                <div
                  style={{
                    marginBottom: 12,
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap',
                    alignItems: 'center',
                  }}
                >
                  <span
                    style={{
                      padding: '4px 8px',
                      fontSize: 12,
                      fontWeight: 500,
                      color: '#64748b',
                      backgroundColor: '#f1f5f9',
                      borderRadius: 6,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <ThunderboltOutlined style={{ fontSize: 12 }} />
                    快捷回复
                  </span>
                  {quickReplies.slice(0, 5).map((qr) => (
                    <Button
                      key={qr.id}
                      size="small"
                      onClick={() => handleQuickReply(qr.content)}
                      style={{
                        fontSize: 12,
                        borderRadius: 6,
                        color: '#64748b',
                        borderColor: '#e2e8f0',
                        backgroundColor: '#f8fafc',
                      }}
                    >
                      {qr.title}
                    </Button>
                  ))}
                </div>
              )}

              {/* 输入框 + 发送 */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                <Tooltip title="发送图片">
                  <Button
                    type="text"
                    icon={<PaperClipOutlined />}
                    style={{ color: '#94a3b8', flexShrink: 0 }}
                  />
                </Tooltip>
                <div
                  style={{
                    flex: 1,
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 12,
                    padding: '8px 16px',
                  }}
                >
                  <TextArea
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="输入回复内容...（Enter 发送，Shift+Enter 换行）"
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    bordered={false}
                    style={{
                      padding: 0,
                      backgroundColor: 'transparent',
                      resize: 'none',
                      fontSize: 13,
                    }}
                  />
                </div>
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={handleSend}
                  disabled={
                    !inputValue.trim() ||
                    !activeSessionId ||
                    activeSession?.status !== 'AGENT_HANDLING'
                  }
                  style={{
                    backgroundColor: BRAND_COLOR,
                    borderColor: BRAND_COLOR,
                    borderRadius: 12,
                    height: 40,
                    paddingInline: 20,
                    flexShrink: 0,
                  }}
                >
                  发送
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ===== 右列：信息面板 ===== */}
      <div
        style={{
          width: 280,
          flexShrink: 0,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {!activeSession ? (
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: 12,
              border: '1px solid #e2e8f0',
              padding: 32,
              textAlign: 'center',
              color: '#94a3b8',
            }}
          >
            <UserOutlined style={{ fontSize: 32, marginBottom: 12, color: '#cbd5e1' }} />
            <div style={{ fontSize: 13 }}>选择会话查看用户信息</div>
          </div>
        ) : (
          <>
            {/* 用户信息卡片 */}
            <div
              style={{
                backgroundColor: '#fff',
                borderRadius: 12,
                border: '1px solid #e2e8f0',
                padding: 16,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  marginBottom: 12,
                }}
              >
                用户信息
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    backgroundColor: `${getAvatarColor(activeSession.user?.profile?.nickname || '')}18`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 18,
                    fontWeight: 500,
                    color: getAvatarColor(activeSession.user?.profile?.nickname || ''),
                  }}
                >
                  {getAvatarInitial(activeSession.user?.profile?.nickname)}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
                    {activeSession.user?.profile?.nickname || '未知用户'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <span
                      style={{
                        padding: '1px 6px',
                        borderRadius: 3,
                        fontSize: 10,
                        fontWeight: 500,
                        backgroundColor: '#fef3c7',
                        color: '#92400e',
                      }}
                    >
                      注册用户
                    </span>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      ID: {activeSession.userId?.slice(0, 8)}
                    </span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#94a3b8' }}>用户 ID</span>
                  <Text copyable={{ text: activeSession.userId }} style={{ fontSize: 12 }}>
                    {activeSession.userId?.slice(0, 12)}...
                  </Text>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#94a3b8' }}>会话来源</span>
                  <span style={{ color: '#334155', fontWeight: 500 }}>{activeSession.source}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#94a3b8' }}>发起时间</span>
                  <span style={{ color: '#334155' }}>{formatTime(activeSession.createdAt)}</span>
                </div>
              </div>
            </div>

            {/* 关联订单卡片（仅 ORDER_DETAIL 来源时显示） */}
            {activeSession.sourceId && (
              <div
                style={{
                  backgroundColor: '#fff',
                  borderRadius: 12,
                  border: '1px solid #e2e8f0',
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#64748b',
                    textTransform: 'uppercase',
                    letterSpacing: 1,
                    marginBottom: 12,
                  }}
                >
                  关联订单
                </div>
                <div
                  style={{
                    backgroundColor: '#f8fafc',
                    borderRadius: 8,
                    padding: 12,
                    border: '1px solid #f1f5f9',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#64748b' }}>
                      #{activeSession.sourceId.slice(0, 16)}
                    </span>
                    <Tag color="blue" style={{ fontSize: 10, margin: 0 }}>
                      关联
                    </Tag>
                  </div>
                  <Button
                    size="small"
                    type="link"
                    style={{ padding: 0, fontSize: 12, color: BRAND_COLOR }}
                    onClick={() => {
                      window.open(`/orders?id=${activeSession.sourceId}`, '_blank');
                    }}
                  >
                    查看订单详情
                  </Button>
                </div>
              </div>
            )}

            {/* AI 摘要卡片 */}
            <div
              style={{
                backgroundColor: '#fff',
                borderRadius: 12,
                border: '1px solid #e2e8f0',
                padding: 16,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  marginBottom: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <RobotOutlined style={{ color: BRAND_COLOR, fontSize: 13 }} />
                AI 摘要
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: '#475569',
                  lineHeight: 1.6,
                  backgroundColor: `${BRAND_BG}80`,
                  borderRadius: 8,
                  padding: 12,
                  border: `1px solid ${BRAND_LIGHT}80`,
                }}
              >
                {/* 从 AI 消息中提取摘要 */}
                {(() => {
                  const aiMsgs = currentMessages.filter((m) => m.senderType === 'AI');
                  const userMsgs = currentMessages.filter((m) => m.senderType === 'USER');
                  if (aiMsgs.length === 0 && userMsgs.length === 0) {
                    return '暂无 AI 摘要';
                  }
                  const userQuery = userMsgs[0]?.content?.slice(0, 50) || '未知问题';
                  const nickname = activeSession.user?.profile?.nickname || '用户';
                  const category = categoryLabelMap[activeSession.ticket?.category || ''] || '咨询';
                  return `${nickname}发起${category}咨询。用户描述：「${userQuery}」。AI 已进行初步接待${aiMsgs.length > 1 ? '并提供了建议操作' : ''}。`;
                })()}
              </div>
            </div>

            {/* 工单信息卡片 */}
            {activeSession.ticket && (
              <div
                style={{
                  backgroundColor: '#fff',
                  borderRadius: 12,
                  border: '1px solid #e2e8f0',
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#64748b',
                    textTransform: 'uppercase',
                    letterSpacing: 1,
                    marginBottom: 12,
                  }}
                >
                  工单信息
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: '#94a3b8' }}>工单号</span>
                    <span style={{ color: '#334155', fontFamily: 'monospace' }}>
                      #{activeSession.ticket.id.slice(0, 12)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: '#94a3b8' }}>类别</span>
                    <span
                      style={{
                        padding: '1px 6px',
                        borderRadius: 3,
                        fontSize: 10,
                        fontWeight: 500,
                        backgroundColor:
                          (categoryColorMap[activeSession.ticket.category] || categoryColorMap.OTHER)
                            .bg,
                        color:
                          (categoryColorMap[activeSession.ticket.category] || categoryColorMap.OTHER)
                            .text,
                      }}
                    >
                      {categoryLabelMap[activeSession.ticket.category] || activeSession.ticket.category}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: '#94a3b8' }}>优先级</span>
                    <span
                      style={{
                        padding: '1px 6px',
                        borderRadius: 3,
                        fontSize: 10,
                        fontWeight: 500,
                        backgroundColor:
                          (priorityColorMap[activeSession.ticket.priority] || priorityColorMap.MEDIUM)
                            .bg,
                        color:
                          (priorityColorMap[activeSession.ticket.priority] || priorityColorMap.MEDIUM)
                            .text,
                      }}
                    >
                      {priorityLabelMap[activeSession.ticket.priority] || activeSession.ticket.priority}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: '#94a3b8' }}>状态</span>
                    <Tag
                      color={
                        activeSession.status === 'AGENT_HANDLING'
                          ? 'processing'
                          : activeSession.status === 'CLOSED'
                            ? 'default'
                            : activeSession.status === 'QUEUING'
                              ? 'warning'
                              : 'blue'
                      }
                      style={{ margin: 0, fontSize: 10 }}
                    >
                      {activeSession.status === 'AGENT_HANDLING'
                        ? '处理中'
                        : activeSession.status === 'CLOSED'
                          ? '已关闭'
                          : activeSession.status === 'QUEUING'
                            ? '排队中'
                            : activeSession.status === 'AI_HANDLING'
                              ? 'AI 处理中'
                              : activeSession.status}
                    </Tag>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: '#94a3b8' }}>创建时间</span>
                    <span style={{ color: '#334155' }}>{formatTime(activeSession.createdAt)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* 历史工单 */}
            <div
              style={{
                backgroundColor: '#fff',
                borderRadius: 12,
                border: '1px solid #e2e8f0',
                padding: 16,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  marginBottom: 12,
                }}
              >
                历史工单
              </div>
              <div style={{ color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: '8px 0' }}>
                {/* 历史工单需要后端提供单独 API，此处作为占位 */}
                暂无历史工单
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
