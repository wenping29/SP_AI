import { useEffect, useState } from 'react';
import {
  Button,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { adminApi, type ModelSpec, type ModelUpdate } from '@/api/admin';

const providerNames: Record<string, string> = {
  zhipu: '智谱 AI',
  deepseek: 'DeepSeek',
  dashscope: '阿里云百炼',
  qianfan: '百度千帆',
  siliconflow: '硅基流动',
};

export default function ModelList() {
  const [models, setModels] = useState<ModelSpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ModelSpec | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<ModelUpdate>();

  useEffect(() => {
    adminApi
      .models()
      .then(setModels)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const replaceModel = (updated: ModelSpec) => {
    setModels((list) => list.map((item) => (item.modelId === updated.modelId ? updated : item)));
  };

  const toggle = async (model: ModelSpec, enabled: boolean) => {
    setSavingId(model.modelId);
    try {
      const updated = await adminApi.updateModel(model.modelId, { isEnabled: enabled });
      replaceModel(updated);
      message.success(`「${model.displayName}」已${enabled ? '启用' : '停用'}`);
    } finally {
      setSavingId(null);
    }
  };

  const openEdit = (model: ModelSpec) => {
    setEditing(model);
    form.setFieldsValue(model);
  };

  const submitEdit = async () => {
    if (!editing) return;
    const values = await form.validateFields();
    setSaving(true);
    try {
      const updated = await adminApi.updateModel(editing.modelId, values);
      replaceModel(updated);
      message.success('模型配置已保存');
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumnsType<ModelSpec> = [
    {
      title: '模型',
      dataIndex: 'displayName',
      width: 240,
      render: (value: string, row) => (
        <div>
          <Typography.Text strong>{value}</Typography.Text>
          <div className="sub-text mono">
            {row.modelId} → {row.upstreamModel}
          </div>
        </div>
      ),
    },
    {
      title: '提供商',
      dataIndex: 'provider',
      width: 120,
      render: (value: string) => <Tag>{providerNames[value] ?? value}</Tag>,
    },
    {
      title: '启用',
      dataIndex: 'isEnabled',
      width: 90,
      render: (enabled: boolean, row) => (
        <Switch
          size="small"
          checked={enabled}
          loading={savingId === row.modelId}
          onChange={(checked) => toggle(row, checked)}
        />
      ),
    },
    {
      title: '输入费率',
      dataIndex: 'inputRatePer1K',
      width: 100,
      render: (value: number) => `${value} 分/千`,
    },
    {
      title: '输出费率',
      dataIndex: 'outputRatePer1K',
      width: 100,
      render: (value: number) => `${value} 分/千`,
    },
    {
      title: '上下文',
      dataIndex: 'maxContextChars',
      width: 110,
      render: (value: number) => `${value.toLocaleString()} 字`,
    },
    {
      title: '视觉',
      dataIndex: 'supportsVision',
      width: 80,
      render: (value: boolean) => (value ? <Tag color="purple">支持</Tag> : '-'),
    },
    { title: '排序', dataIndex: 'sortOrder', width: 70 },
    {
      title: '备注',
      dataIndex: 'note',
      ellipsis: true,
      render: (value: string) => value || '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 90,
      fixed: 'right',
      render: (_, row) => (
        <Button type="link" size="small" onClick={() => openEdit(row)}>
          编辑
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Typography.Title level={3} className="page-title">
        模型管理
      </Typography.Title>
      <Typography.Paragraph className="page-desc">
        开关决定插件里是否可选；输入/输出费率按「分 / 千 token」计算，修改后立即生效。
      </Typography.Paragraph>

      <Table
        rowKey="modelId"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={models}
        scroll={{ x: 1200 }}
        pagination={false}
      />

      <Modal
        title={`编辑模型 · ${editing?.displayName ?? ''}`}
        open={!!editing}
        onOk={submitEdit}
        confirmLoading={saving}
        onCancel={() => setEditing(null)}
        okText="保存"
        cancelText="取消"
        forceRender
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="displayName"
            label="显示名称"
            rules={[{ required: true, message: '请输入显示名称' }]}
          >
            <Input maxLength={40} />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="inputRatePer1K"
                label="输入费率（分/千 token）"
                rules={[{ required: true, message: '请输入输入费率' }]}
              >
                <InputNumber min={0} max={10000} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="outputRatePer1K"
                label="输出费率（分/千 token）"
                rules={[{ required: true, message: '请输入输出费率' }]}
              >
                <InputNumber min={0} max={10000} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="maxContextChars"
                label="最大上下文字数"
                rules={[{ required: true, message: '请输入上下文字数' }]}
              >
                <InputNumber min={1000} max={200000} step={1000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="sortOrder" label="排序">
                <InputNumber min={0} max={999} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="supportsVision" label="支持图片输入" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item name="note" label="备注">
            <Input.TextArea rows={3} maxLength={120} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
