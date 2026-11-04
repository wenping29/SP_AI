import { useEffect, useState } from 'react';
import {
  Card,
  Col,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  ApiOutlined,
  DesktopOutlined,
  FireOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { adminApi, type AdminStats, type AdminTransaction } from '@/api/admin';
import { deltaClass, formatTime, reasonLabel, shortDevice, signed } from '@/utils/format';

export default function Dashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi
      .stats()
      .then(setStats)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const columns: TableColumnsType<AdminTransaction> = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (value: string) => formatTime(value),
    },
    {
      title: '设备',
      dataIndex: 'deviceId',
      render: (value: string) => (
        <Typography.Text className="mono" copyable={{ text: value }}>
          {shortDevice(value)}
        </Typography.Text>
      ),
    },
    {
      title: '变动',
      dataIndex: 'delta',
      width: 90,
      render: (value: number) => (
        <span className={deltaClass(value)}>{signed(value)}</span>
      ),
    },
    {
      title: '类型',
      dataIndex: 'reason',
      width: 100,
      render: (value: string) => <Tag>{reasonLabel(value)}</Tag>,
    },
    { title: '模型', dataIndex: 'modelId', render: (value: string) => value || '-' },
    {
      title: 'Token（入/出）',
      width: 140,
      render: (_: unknown, row) => `${row.inputTokens || 0} / ${row.outputTokens || 0}`,
    },
  ];

  return (
    <div>
      <Typography.Title level={3} className="page-title">
        仪表盘
      </Typography.Title>
      <Typography.Paragraph className="page-desc">
        设备、积分消耗与模型状态总览，统计口径为近 24 小时。
      </Typography.Paragraph>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <Card loading={loading}>
            <Statistic
              title="设备总数"
              value={stats?.accounts ?? 0}
              prefix={<DesktopOutlined style={{ color: '#2563eb' }} />}
              suffix="台"
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              近 24 小时活跃 {stats?.active24h ?? 0} 台
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card loading={loading}>
            <Statistic
              title="积分总余额"
              value={stats?.totalBalance ?? 0}
              prefix={<WalletOutlined style={{ color: '#16a34a' }} />}
              suffix="分"
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              封禁设备 {stats?.blocked ?? 0} 台
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card loading={loading}>
            <Statistic
              title="近 24 小时消耗"
              value={stats?.consumed24h ?? 0}
              prefix={<FireOutlined style={{ color: '#dc2626' }} />}
              suffix="分"
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              共 {stats?.calls24h ?? 0} 次扣分调用
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card loading={loading}>
            <Statistic
              title="启用模型"
              value={stats?.enabledModels ?? 0}
              prefix={<ApiOutlined style={{ color: '#7c3aed' }} />}
              suffix={`/ ${stats?.modelCount ?? 0}`}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              未启用的模型不会下发给插件
            </Typography.Text>
          </Card>
        </Col>
      </Row>

      <Card
        title="最近积分流水"
        style={{ marginTop: 16 }}
        extra={<Space size={4}>仅展示最近 10 条</Space>}
      >
        <Table
          rowKey="id"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={stats?.recent ?? []}
          pagination={false}
        />
      </Card>
    </div>
  );
}
