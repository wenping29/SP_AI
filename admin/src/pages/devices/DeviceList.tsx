import { useEffect, useState } from 'react';
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Spin,
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
  type Device,
  type DevicePage,
  type DeviceTransactions,
} from '@/api/admin';
import { deltaClass, formatTime, reasonLabel, shortDevice, signed } from '@/utils/format';

interface GrantForm {
  delta: number;
  reason?: string;
}

export default function DeviceList() {
  const [data, setData] = useState<DevicePage>({ total: 0, page: 1, pageSize: 20, items: [] });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [tick, setTick] = useState(0);

  const [grantTarget, setGrantTarget] = useState<Device | null>(null);
  const [grantSaving, setGrantSaving] = useState(false);
  const [grantForm] = Form.useForm<GrantForm>();

  const [detailTarget, setDetailTarget] = useState<Device | null>(null);
  const [detail, setDetail] = useState<DeviceTransactions | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminApi
      .devices({ q: keyword || undefined, page, pageSize })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [keyword, page, pageSize, tick]);

  const reload = () => setTick((value) => value + 1);

  const openGrant = (device: Device) => {
    setGrantTarget(device);
    grantForm.setFieldsValue({ delta: 100, reason: 'admin_grant' });
  };

  const submitGrant = async () => {
    if (!grantTarget) return;
    const values = await grantForm.validateFields();
    setGrantSaving(true);
    try {
      const result = await adminApi.grant({
        deviceId: grantTarget.deviceId,
        delta: values.delta,
        reason: values.reason,
      });
      message.success(`已调整 ${signed(values.delta)} 分，当前余额 ${result.balance}`);
      setGrantTarget(null);
      reload();
    } finally {
      setGrantSaving(false);
    }
  };

  const openDetail = async (device: Device) => {
    setDetailTarget(device);
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(await adminApi.deviceTransactions(device.deviceId));
    } finally {
      setDetailLoading(false);
    }
  };

  const toggleBlock = async (device: Device) => {
    const result = await adminApi.setBlocked(device.deviceId, !device.isBlocked);
    message.success(result.isBlocked ? '设备已封禁' : '设备已解封');
    reload();
  };

  const columns: TableColumnsType<Device> = [
    {
      title: '设备',
      dataIndex: 'deviceId',
      width: 300,
      render: (value: string, row) => (
        <div>
          <Typography.Text className="mono" copyable={{ text: value }}>
            {value}
          </Typography.Text>
          {row.label && <div className="sub-text">{row.label}</div>}
        </div>
      ),
    },
    {
      title: '余额',
      dataIndex: 'balance',
      width: 100,
      render: (value: number) => <Typography.Text strong>{value}</Typography.Text>,
    },
    {
      title: '累计消耗',
      dataIndex: 'spent',
      width: 110,
      render: (value: number) => value,
    },
    {
      title: '调用次数',
      dataIndex: 'calls',
      width: 100,
    },
    {
      title: '状态',
      dataIndex: 'isBlocked',
      width: 90,
      render: (blocked: boolean) =>
        blocked ? <Tag color="red">已封禁</Tag> : <Tag color="green">正常</Tag>,
    },
    {
      title: '最近使用',
      dataIndex: 'lastUsedAt',
      width: 170,
      render: (value: string) => formatTime(value),
    },
    {
      title: '注册时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (value: string) => formatTime(value),
    },
    {
      title: '操作',
      key: 'actions',
      width: 190,
      fixed: 'right',
      render: (_, row) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => openGrant(row)}>
            调分
          </Button>
          <Button type="link" size="small" onClick={() => openDetail(row)}>
            流水
          </Button>
          <Popconfirm
            title={row.isBlocked ? '确认解封该设备？' : '确认封禁该设备？'}
            description={row.isBlocked ? '解封后可继续使用插件。' : '封禁后该设备无法调用模型。'}
            onConfirm={() => toggleBlock(row)}
            okText="确认"
            cancelText="取消"
          >
            <Button type="link" size="small" danger={!row.isBlocked}>
              {row.isBlocked ? '解封' : '封禁'}
            </Button>
          </Popconfirm>
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

  return (
    <div>
      <Typography.Title level={3} className="page-title">
        设备管理
      </Typography.Title>
      <Typography.Paragraph className="page-desc">
        按设备 ID 或备注查询，调整积分、查看流水、封禁异常设备。
      </Typography.Paragraph>

      <Space style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="搜索设备 ID / 备注"
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
        rowKey="deviceId"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={data.items}
        scroll={{ x: 1250 }}
        pagination={{
          current: page,
          pageSize,
          total: data.total,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 台设备`,
          onChange: (nextPage, nextSize) => {
            setPage(nextSize !== pageSize ? 1 : nextPage);
            setPageSize(nextSize);
          },
        }}
      />

      <Modal
        title={`调整积分 · ${shortDevice(grantTarget?.deviceId ?? '')}`}
        open={!!grantTarget}
        onOk={submitGrant}
        confirmLoading={grantSaving}
        onCancel={() => setGrantTarget(null)}
        okText="确认调整"
        cancelText="取消"
        forceRender
      >
        <Form form={grantForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="delta"
            label="调整数量"
            extra="正数增加积分，负数扣减积分"
            rules={[{ required: true, message: '请输入调整数量' }]}
          >
            <InputNumber style={{ width: '100%' }} precision={0} placeholder="例如 500 或 -100" />
          </Form.Item>
          <Form.Item name="reason" label="原因">
            <Input maxLength={40} placeholder="例如 admin_grant、活动补发、退款补偿" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`积分流水 · ${shortDevice(detailTarget?.deviceId ?? '')}`}
        open={!!detailTarget}
        onCancel={() => setDetailTarget(null)}
        footer={null}
        width={900}
      >
        {detailLoading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : (
          <>
            <Space style={{ marginBottom: 12 }}>
              <Tag color="blue">当前余额 {detail?.balance ?? '-'}</Tag>
              {detail?.isBlocked && <Tag color="red">已封禁</Tag>}
              {detail?.label && <Tag>{detail.label}</Tag>}
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
