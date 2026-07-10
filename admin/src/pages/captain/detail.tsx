import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Descriptions, Spin, Table, Typography } from 'antd';
import dayjs from 'dayjs';
import { getCaptainProfile, getCaptainTeam } from '@/api/captain';
import type { CaptainProfile, CaptainRelation } from '@/types';
import { CaptainUser, StatusTag, captainProfileStatusMap, money } from './common';

export default function CaptainDetailPage() {
  const { userId = '' } = useParams();
  const [profile, setProfile] = useState<CaptainProfile | null>(null);
  const [team, setTeam] = useState<CaptainRelation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([getCaptainProfile(userId), getCaptainTeam(userId)])
      .then(([profileData, teamData]) => {
        setProfile(profileData);
        setTeam(teamData.items);
      })
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) return <Spin style={{ margin: 24 }} />;
  if (!profile) return <div style={{ padding: 24 }}>团长不存在</div>;
  const account = profile.account || profile.user?.captainAccounts?.[0];
  const metric = profile.user?.captainMonthlyMetrics?.[0];

  return (
    <div style={{ padding: 24 }}>
      <Descriptions title="团长详情" bordered column={3} size="small">
        <Descriptions.Item label="团长"><CaptainUser user={profile.user} /></Descriptions.Item>
        <Descriptions.Item label="团长码">
          <Typography.Text copyable={{ text: profile.captainCode }}>{profile.captainCode}</Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="状态">
          <StatusTag value={profile.status} map={captainProfileStatusMap} />
        </Descriptions.Item>
        <Descriptions.Item label="可用余额">{money(account?.balance)}</Descriptions.Item>
        <Descriptions.Item label="冻结余额">{money(account?.frozen)}</Descriptions.Item>
        <Descriptions.Item label="待追扣">{money(account?.clawback)}</Descriptions.Item>
        <Descriptions.Item label="直接客户有效 GMV">{money(metric?.personalGmv)}</Descriptions.Item>
        <Descriptions.Item label="有效直接客户">{metric?.directEffectiveBuyers ?? 0} 人</Descriptions.Item>
        <Descriptions.Item label="开通时间">
          {profile.createdAt ? dayjs(profile.createdAt).format('YYYY-MM-DD HH:mm') : '-'}
        </Descriptions.Item>
      </Descriptions>

      <Table<CaptainRelation>
        style={{ marginTop: 16 }}
        title={() => '直接客户'}
        rowKey="id"
        dataSource={team}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: '客户', render: (_, record) => <CaptainUser user={record.buyer} /> },
          { title: '绑定来源', dataIndex: 'source', width: 140, render: (value) => value || '-' },
          { title: '绑定时间', dataIndex: 'boundAt', width: 180, render: (value) => dayjs(value).format('YYYY-MM-DD HH:mm') },
        ]}
      />
    </div>
  );
}
