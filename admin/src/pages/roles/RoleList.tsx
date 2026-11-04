import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { adminApi, type AdminRole } from '@/api/admin';
import { useAuth } from '@/store/auth';
import { formatTime } from '@/utils/format';
import { ACTION_LABELS, PERMISSION_MODULES, permissionSummary } from '@/utils/permissions';

type EditorState = { mode: 'create' } | { mode: 'edit'; role: AdminRole } | null;

interface RoleFormValues {
  name: string;
  description?: string;
  permissions?: string[];
}

interface PermissionPickerProps {
  value?: string[];
  onChange?: (value: string[]) => void;
}

function PermissionPicker({ value = [], onChange }: PermissionPickerProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {PERMISSION_MODULES.map((module) => {
        const prefix = `${module.key}.`;
        const moduleValues = value.filter((item) => item.startsWith(prefix));
        return (
          <div
            key={module.key}
            style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
          >
            <span style={{ width: 96, color: '#475569', fontSize: 13 }}>{module.label}</span>
            <Checkbox.Group
              value={moduleValues}
              options={module.actions.map((action) => ({
                value: `${prefix}${action}`,
                label: ACTION_LABELS[action],
              }))}
              onChange={(checked) => {
                const rest = value.filter((item) => !item.startsWith(prefix));
                onChange?.([...rest, ...checked.map(String)]);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

export default function RoleList() {
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);

  const [form] = Form.useForm<RoleFormValues>();
  const can = useAuth((s) => s.can);
  const canManage = can('roles.manage');

  const load = useCallback(async () => {
    setRoles(await adminApi.roles());
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

  const act = async (task: () => Promise<unknown>, success: string) => {
    try {
      await task();
      message.success(success);
      await load();
    } catch {
      // 请求拦截器已提示错误
    }
  };

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({ permissions: ['dashboard.view'] });
    setEditor({ mode: 'create' });
  };

  const openEdit = (role: AdminRole) => {
    form.setFieldsValue({
      name: role.name,
      description: role.description,
      permissions: role.permissions.filter((item) => item !== '*'),
    });
    setEditor({ mode: 'edit', role });
  };

  const submit = async () => {
    if (!editor) return;
    const values = await form.validateFields();
    setSaving(true);
    try {
      const payload = {
        name: values.name.trim(),
        description: values.description?.trim() ?? '',
        permissions: values.permissions ?? [],
      };

      if (editor.mode === 'create') {
        await adminApi.createRole(payload);
        message.success('角色已新增');
      } else {
        await adminApi.updateRole(editor.role.id, payload);
        message.success('角色已更新');
      }

      setEditor(null);
      await load();
    } catch {
      // 校验失败或请求失败，提示已在表单/拦截器里显示
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumnsType<AdminRole> = [
    {
      title: '角色',
      key: 'name',
      width: 200,
      render: (_, row) => (
        <Space size={6}>
          <Typography.Text strong>{row.name}</Typography.Text>
          {row.isSystem && <Tag color="gold">系统</Tag>}
        </Space>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      render: (value: string) => value || <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '模块权限',
      dataIndex: 'permissions',
      width: 320,
      render: (value: string[]) => (
        <Space size={[4, 4]} wrap>
          {permissionSummary(value).map((label) => (
            <Tag key={label} color={value.includes('*') ? 'gold' : 'blue'}>
              {label}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '管理员',
      dataIndex: 'userCount',
      width: 90,
      render: (value: number) => `${value} 人`,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 180,
      render: (value: string) => formatTime(value),
    },
    ...(canManage
      ? [
          {
            title: '操作',
            key: 'actions',
            width: 150,
            render: (_: unknown, row: AdminRole) => (
              <Space size={0}>
                <Button
                  type="link"
                  size="small"
                  disabled={row.isSystem}
                  onClick={() => openEdit(row)}
                >
                  编辑
                </Button>
                <Popconfirm
                  title="删除该角色？"
                  description={
                    row.userCount > 0
                      ? `仍有 ${row.userCount} 名管理员使用，需先调整他们的角色。`
                      : '删除后不可恢复。'
                  }
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                  disabled={row.isSystem}
                  onConfirm={() => act(() => adminApi.deleteRole(row.id), '已删除')}
                >
                  <Button type="link" size="small" danger disabled={row.isSystem}>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <Typography.Title level={3} className="page-title">
        角色管理
      </Typography.Title>
      <Typography.Paragraph className="page-desc">
        角色决定管理员可访问的模块：拥有「管理」即同时具备「查看」。系统内置角色不可修改或删除。
      </Typography.Paragraph>

      <Space wrap style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Button icon={<ReloadOutlined />} onClick={refresh}>
          刷新
        </Button>
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增角色
          </Button>
        )}
      </Space>

      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={roles}
        pagination={false}
      />

      <Modal
        title={editor?.mode === 'edit' ? '编辑角色' : '新增角色'}
        open={!!editor}
        onOk={submit}
        confirmLoading={saving}
        onCancel={() => setEditor(null)}
        okText="保存"
        cancelText="取消"
        width={620}
        forceRender
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="name"
            label="角色名"
            rules={[
              { required: true, message: '请输入角色名' },
              { max: 30, message: '最多 30 个字符' },
            ]}
          >
            <Input placeholder="例如：客服" maxLength={30} />
          </Form.Item>

          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="说明该角色的职责（可选）" maxLength={200} rows={2} />
          </Form.Item>

          <Form.Item
            name="permissions"
            label="模块权限"
            rules={[
              {
                validator: (_, value?: string[]) =>
                  value && value.length > 0
                    ? Promise.resolve()
                    : Promise.reject(new Error('至少勾选一个模块权限')),
              },
            ]}
          >
            <PermissionPicker />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
