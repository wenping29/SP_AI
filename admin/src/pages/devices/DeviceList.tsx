import { useEffect, useState } from 'react';
import {
  Button,
  Input,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { adminApi, type Device, type DevicePage } from '@/api/admin';
import { formatTime } from '@/utils/format';

export default function DeviceList() {
  const [data, setData] = useState<DevicePage>({ total: 0, page: 1, pageSize: 20, items: [] });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [tick, setTick] = useState(0);

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
          <div className="sub-text">{row.label}</div>
        </div>
      ),
    },
    {
      title: '绑定用户',
      dataIndex: 'accountEmail',
      width: 240,
      render: (value: string) =>
        value ? (
          <div>
            <Typography.Text>{value}</Typography.Text>
            <div className="sub-text">积分归该用户账号</div>
          </div>
        ) : (
          <Typography.Text type="secondary">未登录</Typography.Text>
        ),
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
      width: 100,
      fixed: 'right',
      render: (_, row) => (
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
      ),
    },
  ];

  return (
    <div>
      <Typography.Title level={3} className="page-title">
        设备管理
      </Typography.Title>
      <Typography.Paragraph className="page-desc">
        按设备 ID 或备注查询，查看设备当前绑定的用户账号并封禁异常设备。积分跟着用户走，调整积分请到积分管理。
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
        scroll={{ x: 1070 }}
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
    </div>
  );
}
