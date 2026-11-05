import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  adminApi,
  type CreditPackage,
  type CreditPackageInput,
  type PaymentOrder,
  type PaymentOrderPage,
  type PaymentSettings,
  type PaymentSettingsUpdate,
} from '@/api/admin';
import { useAuth } from '@/store/auth';
import { formatTime } from '@/utils/format';

const priceText = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

const orderStatusMeta: Record<string, { label: string; color: string }> = {
  pending: { label: '待支付', color: 'orange' },
  paid: { label: '已支付', color: 'green' },
  closed: { label: '已关闭', color: 'default' },
};

const channelText: Record<string, string> = { alipay: '支付宝', wechat: '微信支付' };
const providerText: Record<string, string> = { mock: '模拟支付', epay: '易支付' };

type PackageEditor = { mode: 'create' } | { mode: 'edit'; item: CreditPackage } | null;

interface PackageFormValues {
  name: string;
  price: number;
  credits: number;
  note?: string;
  sortOrder?: number;
  isEnabled: boolean;
}

function PackagePanel() {
  const [rows, setRows] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<PackageEditor>(null);
  const [form] = Form.useForm<PackageFormValues>();
  const can = useAuth((s) => s.can);
  const canManage = can('policy.manage');

  const load = useCallback(async () => {
    setRows(await adminApi.creditPackages());
  }, []);

  useEffect(() => {
    load()
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [load]);

  const refresh = () => {
    setLoading(true);
    load()
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({
      price: 10,
      credits: 1000,
      sortOrder: rows.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 1,
      isEnabled: true,
    });
    setEditor({ mode: 'create' });
  };

  const openEdit = (item: CreditPackage) => {
    form.setFieldsValue({
      name: item.name,
      price: item.priceCents / 100,
      credits: item.credits,
      note: item.note,
      sortOrder: item.sortOrder,
      isEnabled: item.isEnabled,
    });
    setEditor({ mode: 'edit', item });
  };

  const submit = async () => {
    if (!editor) return;
    const values = await form.validateFields();
    const payload: CreditPackageInput = {
      name: values.name.trim(),
      priceCents: Math.round(values.price * 100),
      credits: values.credits,
      note: values.note?.trim() ?? '',
      sortOrder: values.sortOrder ?? 0,
      isEnabled: values.isEnabled,
    };

    setSaving(true);
    try {
      if (editor.mode === 'create') {
        await adminApi.createCreditPackage(payload);
        message.success('套餐已新增');
      } else {
        await adminApi.updateCreditPackage(editor.item.id, payload);
        message.success('套餐已保存');
      }
      setEditor(null);
      await load();
    } catch {
      // 请求拦截器已提示错误
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (item: CreditPackage, enabled: boolean) => {
    try {
      await adminApi.updateCreditPackage(item.id, { isEnabled: enabled });
      message.success(`「${item.name}」已${enabled ? '上架' : '下架'}`);
      await load();
    } catch {
      // 请求拦截器已提示错误
    }
  };

  const remove = async (item: CreditPackage) => {
    try {
      await adminApi.deleteCreditPackage(item.id);
      message.success('套餐已删除');
      await load();
    } catch {
      // 请求拦截器已提示错误
    }
  };

  const columns: TableColumnsType<CreditPackage> = [
    {
      title: '套餐',
      dataIndex: 'name',
      render: (name: string, item) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{name}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {item.note || '—'}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '价格',
      dataIndex: 'priceCents',
      width: 110,
      render: (cents: number) => <Typography.Text strong>{priceText(cents)}</Typography.Text>,
    },
    {
      title: '积分',
      dataIndex: 'credits',
      width: 110,
      render: (credits: number) => credits.toLocaleString('zh-CN'),
    },
    { title: '排序', dataIndex: 'sortOrder', width: 80 },
    {
      title: '状态',
      dataIndex: 'isEnabled',
      width: 100,
      render: (enabled: boolean, item) => (
        <Switch
          checked={enabled}
          disabled={!canManage}
          onChange={(value) => toggle(item, value)}
          checkedChildren="上架"
          unCheckedChildren="下架"
        />
      ),
    },
    { title: '订单数', dataIndex: 'orderCount', width: 90 },
    {
      title: '操作',
      width: 150,
      render: (_, item) => (
        <Space>
          <Button size="small" disabled={!canManage} onClick={() => openEdit(item)}>
            编辑
          </Button>
          <Popconfirm
            title="删除该套餐？"
            description="已有订单的套餐不能删除，请改为下架。"
            okText="删除"
            cancelText="取消"
            disabled={!canManage}
            onConfirm={() => remove(item)}
          >
            <Button size="small" danger disabled={!canManage}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="充值套餐"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={refresh}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} disabled={!canManage} onClick={openCreate}>
            新增套餐
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="套餐价格与积分按订单快照保存"
        description="调整价格或积分只影响之后的新订单；已有订单按下单时的金额与积分到账。"
      />
      <Table rowKey="id" columns={columns} dataSource={rows} loading={loading} pagination={false} />

      <Modal
        open={editor !== null}
        title={editor?.mode === 'edit' ? '编辑套餐' : '新增套餐'}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        onOk={submit}
        onCancel={() => setEditor(null)}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="套餐名称"
            rules={[{ required: true, message: '请输入套餐名称' }]}
          >
            <Input maxLength={30} showCount placeholder="例如：标准包" />
          </Form.Item>
          <Form.Item
            name="price"
            label="价格（元）"
            rules={[{ required: true, message: '请输入价格' }]}
          >
            <InputNumber min={0.01} max={100000} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="credits"
            label="到账积分"
            rules={[{ required: true, message: '请输入积分数量' }]}
          >
            <InputNumber min={1} max={100_000_000} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="note" label="套餐说明">
            <Input maxLength={100} placeholder="例如：多送 200 积分" />
          </Form.Item>
          <Form.Item name="sortOrder" label="排序" extra="数字越小越靠前">
            <InputNumber min={0} max={9999} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="isEnabled" label="上架" valuePropName="checked">
            <Switch checkedChildren="上架" unCheckedChildren="下架" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

function OrdersPanel() {
  const [data, setData] = useState<PaymentOrderPage>({ total: 0, page: 1, pageSize: 20, items: [] });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [tick, setTick] = useState(0);
  const can = useAuth((s) => s.can);
  const canManage = can('policy.manage');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminApi
      .paymentOrders({ q: keyword || undefined, status, page, pageSize })
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
  }, [keyword, status, page, pageSize, tick]);

  const reload = () => setTick((value) => value + 1);

  const close = async (order: PaymentOrder) => {
    try {
      await adminApi.closePaymentOrder(order.orderNo);
      message.success('订单已关闭');
      reload();
    } catch {
      // 请求拦截器已提示错误
    }
  };

  const columns: TableColumnsType<PaymentOrder> = [
    {
      title: '订单号',
      dataIndex: 'orderNo',
      width: 210,
      render: (value: string, item) => (
        <Space direction="vertical" size={0}>
          <Typography.Text copyable style={{ fontSize: 12 }}>
            {value}
          </Typography.Text>
          {item.externalOrderNo && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              渠道单号 {item.externalOrderNo}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: '用户',
      dataIndex: 'email',
      render: (email: string, item) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{item.displayName || email || '—'}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {email}
          </Typography.Text>
        </Space>
      ),
    },
    { title: '套餐', dataIndex: 'packageName', width: 110 },
    {
      title: '金额',
      dataIndex: 'priceCents',
      width: 100,
      render: (cents: number) => priceText(cents),
    },
    {
      title: '积分',
      dataIndex: 'credits',
      width: 100,
      render: (credits: number) => credits.toLocaleString('zh-CN'),
    },
    {
      title: '渠道',
      dataIndex: 'channel',
      width: 100,
      render: (value: string) => channelText[value] ?? value,
    },
    {
      title: '服务商',
      dataIndex: 'provider',
      width: 100,
      render: (value: string) => providerText[value] ?? value,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (value: string) => {
        const meta = orderStatusMeta[value] ?? { label: value, color: 'default' };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (value: string) => formatTime(value),
    },
    {
      title: '支付时间',
      dataIndex: 'paidAt',
      width: 170,
      render: (value: string | null) => formatTime(value),
    },
    {
      title: '操作',
      width: 90,
      render: (_, item) =>
        item.status === 'pending' ? (
          <Popconfirm
            title="关闭该订单？"
            okText="关闭"
            cancelText="取消"
            disabled={!canManage}
            onConfirm={() => close(item)}
          >
            <Button size="small" danger disabled={!canManage}>
              关闭
            </Button>
          </Popconfirm>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
  ];

  return (
    <Card
      title="充值订单"
      extra={
        <Space wrap>
          <Select
            allowClear
            placeholder="全部状态"
            style={{ width: 130 }}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={[
              { value: 'pending', label: '待支付' },
              { value: 'paid', label: '已支付' },
              { value: 'closed', label: '已关闭' },
            ]}
          />
          <Input.Search
            allowClear
            placeholder="订单号 / 渠道单号 / 用户邮箱"
            style={{ width: 240 }}
            onSearch={(value) => {
              setKeyword(value.trim());
              setPage(1);
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={reload}>
            刷新
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="orderNo"
        columns={columns}
        dataSource={data.items}
        loading={loading}
        scroll={{ x: 1320 }}
        pagination={{
          current: page,
          pageSize,
          total: data.total,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 笔`,
          onChange: (nextPage, nextSize) => {
            setPage(nextPage);
            setPageSize(nextSize);
          },
        }}
      />
    </Card>
  );
}

function SettingsPanel() {
  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<PaymentSettingsUpdate>();
  const can = useAuth((s) => s.can);
  const canManage = can('policy.manage');
  const provider = Form.useWatch('provider', form);
  const enabled = Form.useWatch('enabled', form);
  const notifyBase = Form.useWatch('notifyBaseUrl', form);

  useEffect(() => {
    adminApi
      .paymentSettings()
      .then((result) => {
        setSettings(result);
        form.setFieldsValue({
          enabled: result.enabled,
          provider: result.provider,
          mockEnabled: result.mockEnabled,
          alipayEnabled: result.alipayEnabled,
          wechatEnabled: result.wechatEnabled,
          epayApiUrl: result.epayApiUrl,
          epayPid: result.epayPid,
          notifyBaseUrl: result.notifyBaseUrl,
          epayKey: '',
          clearEpayKey: false,
        });
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [form]);

  const save = async (values: PaymentSettingsUpdate) => {
    setSaving(true);
    try {
      const result = await adminApi.updatePaymentSettings({
        ...values,
        epayKey: values.epayKey?.trim() || undefined,
        clearEpayKey: values.clearEpayKey || undefined,
      });
      setSettings(result);
      form.setFieldsValue({ epayKey: '', clearEpayKey: false });
      message.success('支付配置已保存');
    } catch {
      // 请求拦截器已提示错误
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card loading={loading} title="支付配置">
      {settings && !settings.enabled && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="充值功能当前未开放"
          description="插件端会显示「充值暂未开放」。配置好渠道并打开下方总开关后立即生效。"
        />
      )}
      {settings && settings.enabled && settings.provider === 'mock' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="当前使用模拟支付"
          description="模拟支付可被已登录用户直接确认到账，仅限本地联调，生产环境请切换到易支付并关闭模拟支付。"
        />
      )}

      <Form
        form={form}
        layout="vertical"
        onFinish={save}
        style={{ maxWidth: 620 }}
        disabled={!canManage}
      >
        <Form.Item
          name="enabled"
          label="充值总开关"
          valuePropName="checked"
          extra="关闭后下单接口返回「充值功能暂未开放」。"
        >
          <Switch checkedChildren="开放" unCheckedChildren="关闭" />
        </Form.Item>

        <Form.Item
          name="provider"
          label="支付服务商"
          extra="易支付为第三方聚合，一个商户号同时支持支付宝与微信扫码。"
        >
          <Select
            options={[
              { value: 'epay', label: '易支付（推荐，支付宝 + 微信）' },
              { value: 'mock', label: '模拟支付（仅联调）' },
            ]}
          />
        </Form.Item>

        {provider === 'mock' && (
          <Form.Item
            name="mockEnabled"
            label="允许模拟支付"
            valuePropName="checked"
            extra="打开后，登录用户可在充值弹窗里直接点「模拟支付成功」到账。生产环境务必关闭。"
          >
            <Switch checkedChildren="允许" unCheckedChildren="禁止" />
          </Form.Item>
        )}

        <Form.Item
          name="alipayEnabled"
          label="支付宝"
          valuePropName="checked"
          extra="关闭后插件端不显示支付宝选项。"
        >
          <Switch checkedChildren="开放" unCheckedChildren="关闭" />
        </Form.Item>

        <Form.Item name="wechatEnabled" label="微信支付" valuePropName="checked">
          <Switch checkedChildren="开放" unCheckedChildren="关闭" />
        </Form.Item>

        {provider === 'epay' && (
          <>
            <Form.Item
              name="epayApiUrl"
              label="易支付接口地址"
              rules={enabled ? [{ required: true, message: '请填写易支付 mapi.php 地址' }] : []}
              extra="例如 https://pay.example.com/mapi.php"
            >
              <Input placeholder="https://pay.example.com/mapi.php" />
            </Form.Item>
            <Form.Item
              name="epayPid"
              label="商户 PID"
              rules={enabled ? [{ required: true, message: '请填写商户 PID' }] : []}
            >
              <Input placeholder="1000" />
            </Form.Item>
            <Form.Item
              name="epayKey"
              label="商户密钥"
              extra={
                settings?.epayKeySet
                  ? `已保存（尾号 ${settings.epayKeyTail}），留空表示不修改`
                  : '尚未保存密钥'
              }
            >
              <Input.Password placeholder="留空不修改" autoComplete="new-password" />
            </Form.Item>
            <Form.Item name="clearEpayKey" label="清空已保存的商户密钥" valuePropName="checked">
              <Switch checkedChildren="清空" unCheckedChildren="保留" />
            </Form.Item>
          </>
        )}

        <Form.Item
          name="notifyBaseUrl"
          label="支付回调对外地址"
          extra="支付平台必须能访问到这个地址，例如 https://sp.example.com；留空则按当前请求地址生成。"
        >
          <Input placeholder="https://sp.example.com" />
        </Form.Item>

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="回调地址"
          description={
            <Typography.Text copyable>
              {(notifyBase || window.location.origin) + '/api/pay/notify/epay'}
            </Typography.Text>
          }
        />

        <Form.Item style={{ marginBottom: 0 }}>
          <Space>
            <Button type="primary" htmlType="submit" loading={saving} disabled={!canManage}>
              保存配置
            </Button>
            <Button
              disabled={!canManage}
              onClick={() => {
                if (settings) {
                  form.setFieldsValue({
                    enabled: settings.enabled,
                    provider: settings.provider,
                    mockEnabled: settings.mockEnabled,
                    alipayEnabled: settings.alipayEnabled,
                    wechatEnabled: settings.wechatEnabled,
                    epayApiUrl: settings.epayApiUrl,
                    epayPid: settings.epayPid,
                    notifyBaseUrl: settings.notifyBaseUrl,
                    epayKey: '',
                    clearEpayKey: false,
                  });
                }
              }}
            >
              重置
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Card>
  );
}

export default function PaymentManagement() {
  return (
    <div>
      <Typography.Title level={3} className="page-title">
        充值管理
      </Typography.Title>
      <Typography.Paragraph className="page-desc">
        管理积分充值套餐、查看订单到账记录，并配置支付宝与微信支付渠道。
      </Typography.Paragraph>

      <Tabs
        defaultActiveKey="packages"
        items={[
          { key: 'packages', label: '充值套餐', children: <PackagePanel /> },
          { key: 'orders', label: '充值订单', children: <OrdersPanel /> },
          { key: 'settings', label: '支付配置', children: <SettingsPanel /> },
        ]}
      />
    </div>
  );
}
