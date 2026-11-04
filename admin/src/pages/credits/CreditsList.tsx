import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import {
  adminApi,
  type AdminTransaction,
  type CreditSummary,
  type DeviceTransactions,
  type Member,
  type MemberPage,
} from '@/api/admin';
import { useAuth } from '@/store/auth';
import { deltaClass, formatTime, reasonLabel, signed } from '@/utils/format';

type AdjustMode = 'add' | 'deduct' | 'set';

interface AdjustForm {
  amount: number;
  reason?: string;
}

const emptySummary: CreditSummary = { users: 0, totalBalance: 0, blocked: 0, spent: 0, calls: 0 };
const quickAmounts = [100, 500, 1000, 5000];

export default function CreditsList() {
  const [data, setData] = useState<MemberPage>({ total: 0, page: 1, pageSize: 20, items: [] });
  const [summary, setSummary] = useState<CreditSummary>(emptySummary);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [tick, setTick] = useState(0);

  const [adjustTarget, setAdjustTarget] = useState<Member | null>(null);
  const [adjustMode, setAdjustMode] = useState<AdjustMode>('add');
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [adjustForm] = Form.useForm<AdjustForm>();
  const amount = Form.useWatch('amount', adjustForm);

  const [detailTarget, setDetailTarget] = useState<Member | null>(null);
  const [detail, setDetail] = useState<DeviceTransactions | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const can = useAuth((s) => s.can);
  const canManage = can('devices.manage');

  const load = useCallback(async () => {
    const [memberPage, creditSummary] = await Promise.all([
      adminApi.members({ q: keyword || undefined, page, pageSize }),
      adminApi.creditSummary(),
    ]);
    setData(memberPage);
    setSummary(creditSummary);
  }, [keyword, page, pageSize]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [load, tick]);

  const reload = () => setTick((value) => value + 1);

  const openAdjust = (member: Member) => {
    setAdjustTarget(member);
    setAdjustMode('add');
    adjustForm.setFieldsValue({ amount: 100, reason: '' });
  };

  const closeAdjust = () => {
    setAdjustTarget(null);
    adjustForm.resetFields();
  };

  const submitAdjust = async () => {
    if (!adjustTarget) return;
    if (!adjustTarget.accountDeviceId) {
      message.error('该用户还没有积分账号');
      return;
    }
    const values = await adjustForm.validateFields();
    setAdjustSaving(true);
    try {
      const result = await adminApi.adjustCredits({
        deviceId: adjustTarget.accountDeviceId,
        ...(adjustMode === 'set'
          ? { balance: values.amount }
          : { delta: adjustMode === 'deduct' ? -values.amount : values.amount }),
        reason: values.reason?.trim() || undefined,
      });
      message.success(
        result.delta === 0
          ? `余额未变化，当前 ${result.balance} 分`
          : `已调整 ${signed(result.delta)} 分，当前余额 ${result.balance}`,
      );
      closeAdjust();
      reload();
    } finally {
      setAdjustSaving(false);
    }
  };

  const openDetail = async (member: Member) => {
    setDetailTarget(member);
    setDetail(null);
    if (!member.accountDeviceId) return;
    setDetailLoading(true);
    try {
      setDetail(await adminApi.deviceTransactions(member.accountDeviceId));
    } finally {
      setDetailLoading(false);
    }
  };

  const columns: TableColumnsType<Member> = [
    {
      title: '用户',
      key: 'member',
      width: 280,
      render: (_, row) => (
        <div>
          <Typography.Text strong>{row.displayName}</Typography.Text>
          <div className="sub-text mono">
            <Typography.Text className="mono" copyable={{ text: row.email }}>
              {row.email}
            </Typography.Text>
          </div>
        </div>
      ),
    },
    {
      title: '当前余额',
      dataIndex: 'balance',
      width: 120,
      render: (value: number) => (
        <Space size={6}>
          <Typography.Text strong>{value}</Typography.Text>
          {value <= 50 && <Tag color="orange">偏低</Tag>}
        </Space>
      ),
    },
    {
      title: '累计消耗',
      dataIndex: 'spent',
      width: 110,
    },
    {
      title: '调用次数',
      dataIndex: 'calls',
      width: 100,
    },
    {
      title: '登录设备',
      dataIndex: 'deviceCount',
      width: 100,
      render: (value: number) => `${value} 台`,
    },
    {
      title: '状态',
      dataIndex: 'isBlocked',
      width: 90,
      render: (blocked: boolean) =>
        blocked ? <Tag color="red">已封禁</Tag> : <Tag color="green">正常</Tag>,
    },
    {
      title: '最近登录',
      dataIndex: 'lastLoginAt',
      width: 170,
      render: (value: string | null) => formatTime(value),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      fixed: 'right',
      render: (_, row) => (
        <Space size={0}>
          {canManage && (
            <Button type="link" size="small" onClick={() => openAdjust(row)}>
              修改积分
            </Button>
          )}
          <Button
            type="link"
            size="small"
            disabled={!row.accountDeviceId}
            onClick={() => openDetail(row)}
          >
            流水
          </Button>
        </Space>
      ),
    },
  ];

  const txColumns: TableColumnsType<AdminTransaction> = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 165,
      render: (value: string) => formatTime(value),
    },
    {
      title: '变动',
      dataIndex: 'delta',
      width: 90,
      render: (value: number) => <span className={deltaClass(value)}>{signed(value)}</span>,
    },
    {
      title: '类型',
      dataIndex: 'reason',
      width: 110,
      render: (value: string) => <Tag>{reasonLabel(value)}</Tag>,
    },
    { title: '模型', dataIndex: 'modelId', render: (value: string) => value || '-' },
    {
      title: 'Token（入/出）',
      width: 130,
      render: (_, row) => `${row.inputTokens || 0} / ${row.outputTokens || 0}`,
    },
  ];

  const preview = () => {
    if (!adjustTarget || typeof amount !== 'number') return null;
    if (adjustMode === 'set') return Math.max(0, Math.min(amount, 100_000_000));
    return adjustMode === 'deduct'
      ? Math.max(0, adjustTarget.balance - amount)
      : adjustTarget.balance + amount;
  };
  const nextBalance = preview();

  return (
    <div>
      <Typography.Title level={3} className="page-title">
        积分管理
      </Typography.Title>
      <Typography.Paragraph className="page-desc">
        积分跟着用户账号走，不关联设备，多设备登录同一账号共享余额。支持增加、扣减和直接设为指定余额，所有变动都会写入流水；手工调整不计入用户消费统计。
      </Typography.Paragraph>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="用户数"
              value={summary.users}
              suffix={summary.blocked ? `（封禁 ${summary.blocked}）` : ''}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="总余额" value={summary.totalBalance} suffix="分" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="累计消耗" value={summary.spent} suffix="分" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="累计调用" value={summary.calls} suffix="次" />
          </Card>
        </Col>
      </Row>

      <Space style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="搜索邮箱 / 昵称"
          allowClear
          style={{ width: 300 }}
          onSearch={(value) => {
            setPage(1);
            setKeyword(value.trim());
          }}
        />
        <Button icon={<ReloadOutlined />} onClick={reload}>
          刷新
        </Button>
      </Space>

      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={data.items}
        scroll={{ x: 1220 }}
        pagination={{
          current: page,
          pageSize,
          total: data.total,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 位用户`,
          onChange: (nextPage, nextSize) => {
            setPage(nextSize !== pageSize ? 1 : nextPage);
            setPageSize(nextSize);
          },
        }}
      />

      <Modal
        title={`修改积分 · ${adjustTarget?.displayName || adjustTarget?.email || ''}`}
        open={!!adjustTarget}
        onOk={submitAdjust}
        confirmLoading={adjustSaving}
        onCancel={closeAdjust}
        okText="确认修改"
        cancelText="取消"
        forceRender
      >
        <Space style={{ marginBottom: 12 }} wrap>
          <Tag color="blue">当前余额 {adjustTarget?.balance ?? '-'}</Tag>
          {adjustTarget?.email && <Tag>{adjustTarget.email}</Tag>}
          {adjustTarget && adjustTarget.deviceCount > 0 && (
            <Tag>{adjustTarget.deviceCount} 台设备已登录</Tag>
          )}
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          调整记在该用户账号上，所有登录同一账号的设备同步生效。
        </Typography.Paragraph>
        <Form form={adjustForm} layout="vertical">
          <Form.Item label="调整方式">
            <Radio.Group
              value={adjustMode}
              onChange={(event) => {
                setAdjustMode(event.target.value);
                adjustForm.setFieldsValue({ amount: event.target.value === 'set' ? adjustTarget?.balance ?? 0 : 100 });
              }}
              optionType="button"
              buttonStyle="solid"
            >
              <Radio.Button value="add">增加</Radio.Button>
              <Radio.Button value="deduct">扣减</Radio.Button>
              <Radio.Button value="set">设为指定余额</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item
            name="amount"
            label={adjustMode === 'set' ? '目标余额' : adjustMode === 'deduct' ? '扣减数量' : '增加数量'}
            rules={[
              { required: true, message: '请输入积分数' },
              {
                validator: (_, value: number) => {
                  if (typeof value !== 'number' || value < 0) {
                    return Promise.reject(new Error('积分不能为负数'));
                  }
                  if (adjustMode === 'deduct' && adjustTarget && value > adjustTarget.balance) {
                    return Promise.reject(new Error(`不能超过当前余额 ${adjustTarget.balance}`));
                  }
                  if (adjustMode === 'set' && value > 100_000_000) {
                    return Promise.reject(new Error('目标余额不能超过 100000000'));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <InputNumber style={{ width: '100%' }} precision={0} placeholder="请输入积分数量" />
          </Form.Item>

          <Form.Item>
            <Space wrap>
              {quickAmounts.map((value) => (
                <Button key={value} size="small" onClick={() => adjustForm.setFieldsValue({ amount: value })}>
                  {value}
                </Button>
              ))}
              {nextBalance !== null && (
                <Typography.Text type="secondary">
                  调整后余额：<Typography.Text strong>{nextBalance}</Typography.Text>
                </Typography.Text>
              )}
            </Space>
          </Form.Item>

          <Form.Item name="reason" label="原因">
            <Input
              maxLength={40}
              placeholder={
                adjustMode === 'set'
                  ? '例如 人工修正、退款补偿（留空记为后台设为）'
                  : '例如 活动补发、退款补偿（留空记为后台调整）'
              }
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`积分流水 · ${detailTarget?.displayName || detailTarget?.email || ''}`}
        open={!!detailTarget}
        onCancel={() => setDetailTarget(null)}
        footer={null}
        width={900}
      >
        {detailLoading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : !detailTarget?.accountDeviceId ? (
          <Typography.Paragraph type="secondary">该用户还没有积分账号。</Typography.Paragraph>
        ) : (
          <>
            <Space style={{ marginBottom: 12 }} wrap>
              <Tag color="blue">当前余额 {detail?.balance ?? '-'}</Tag>
              {detail?.isBlocked && <Tag color="red">已封禁</Tag>}
              {detailTarget?.email && <Tag>{detailTarget.email}</Tag>}
            </Space>
            <Table
              rowKey="id"
              size="small"
              columns={txColumns}
              dataSource={detail?.items ?? []}
              pagination={{ pageSize: 10, showSizeChanger: false }}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
