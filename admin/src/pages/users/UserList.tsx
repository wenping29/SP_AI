import { useEffect, useState } from 'react';
import {
  Button,
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
import { adminApi, type Member, type MemberPage } from '@/api/admin';
import { useAuth } from '@/store/auth';
import { formatTime } from '@/utils/format';

type EditorState = { mode: 'create' } | { mode: 'edit'; member: Member } | null;

interface MemberFormValues {
  email: string;
  displayName?: string;
  password?: string;
}

export default function UserList() {
  const [data, setData] = useState<MemberPage>({ total: 0, page: 1, pageSize: 20, items: [] });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [tick, setTick] = useState(0);

  const [editor, setEditor] = useState<EditorState>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<MemberFormValues>();
  const can = useAuth((s) => s.can);
  const canManage = can('users.manage');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminApi
      .members({ q: keyword || undefined, page, pageSize })
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

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({});
    setEditor({ mode: 'create' });
  };

  const openEdit = (member: Member) => {
    form.setFieldsValue({
      email: member.email,
      displayName: member.displayName,
      password: '',
    });
    setEditor({ mode: 'edit', member });
  };

  const submit = async () => {
    if (!editor) return;
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editor.mode === 'create') {
        await adminApi.createMember({
          email: values.email.trim(),
          displayName: values.displayName?.trim() || undefined,
          password: values.password!,
        });
        message.success('用户已新增');
      } else {
        await adminApi.updateMember(editor.member.id, {
          email: values.email.trim(),
          displayName: values.displayName?.trim() ?? '',
          password: values.password || undefined,
        });
        message.success('用户已更新');
      }

      setEditor(null);
      reload();
    } catch {
      // 校验失败或请求失败，提示已在表单/拦截器里显示
    } finally {
      setSaving(false);
    }
  };

  const toggleBlock = async (member: Member) => {
    const result = await adminApi.blockMember(member.id, !member.isBlocked);
    message.success(result.isBlocked ? '用户已封禁' : '用户已解封');
    reload();
  };

  const columns: TableColumnsType<Member> = [
    {
      title: '用户',
      key: 'user',
      width: 260,
      render: (_, row) => (
        <div>
          <Typography.Text strong>{row.displayName}</Typography.Text>
          <div className="sub-text mono">{row.email}</div>
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'isBlocked',
      width: 100,
      render: (value: boolean) =>
        value ? <Tag color="red">已封禁</Tag> : <Tag color="green">正常</Tag>,
    },
    {
      title: '余额',
      dataIndex: 'balance',
      width: 100,
      render: (value: number) => <Typography.Text strong>{value}</Typography.Text>,
    },
    {
      title: '登录设备',
      dataIndex: 'deviceCount',
      width: 100,
      render: (value: number) => `${value} 台`,
    },
    {
      title: '最近登录',
      dataIndex: 'lastLoginAt',
      width: 170,
      render: (value: string | null) => formatTime(value),
    },
    {
      title: '注册时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (value: string) => formatTime(value),
    },
    ...(canManage
      ? [
          {
            title: '操作',
            key: 'actions',
            width: 210,
            render: (_: unknown, row: Member) => (
              <Space size={0}>
                <Button type="link" size="small" onClick={() => openEdit(row)}>
                  编辑
                </Button>
                <Popconfirm
                  title={row.isBlocked ? '确认解封该用户？' : '确认封禁该用户？'}
                  description={
                    row.isBlocked
                      ? '解封后该用户可继续登录与调用模型。'
                      : '封禁后该用户无法登录，已登录设备也会立即停止调用。'
                  }
                  onConfirm={() => toggleBlock(row)}
                  okText="确认"
                  cancelText="取消"
                >
                  <Button type="link" size="small" danger={!row.isBlocked}>
                    {row.isBlocked ? '解封' : '封禁'}
                  </Button>
                </Popconfirm>
                <Popconfirm
                  title="删除该用户？"
                  description="账号与积分流水一并删除，已登录设备回落为匿名状态，操作不可恢复。"
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                  onConfirm={() =>
                    adminApi
                      .deleteMember(row.id)
                      .then(() => {
                        message.success('已删除');
                        reload();
                      })
                      .catch(() => undefined)
                  }
                >
                  <Button type="link" size="small" danger>
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
        用户管理
      </Typography.Title>
      <Typography.Paragraph className="page-desc">
        插件端注册的普通用户，与后台管理员分表管理。可编辑资料、重置密码、封禁或删除。
      </Typography.Paragraph>

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
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增用户
          </Button>
        )}
      </Space>

      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={data.items}
        scroll={{ x: 1100 }}
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
        title={editor?.mode === 'edit' ? '编辑用户' : '新增用户'}
        open={!!editor}
        onOk={submit}
        confirmLoading={saving}
        onCancel={() => setEditor(null)}
        okText="保存"
        cancelText="取消"
        width={480}
        forceRender
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效的邮箱地址' },
            ]}
          >
            <Input placeholder="user@example.com" autoComplete="off" maxLength={120} />
          </Form.Item>

          <Form.Item name="displayName" label="昵称">
            <Input placeholder="留空则使用邮箱前缀" maxLength={32} />
          </Form.Item>

          <Form.Item
            name="password"
            label={editor?.mode === 'edit' ? '重置密码' : '密码'}
            rules={[
              {
                validator: (_, value?: string) => {
                  if (editor?.mode === 'edit' && !value) return Promise.resolve();
                  if (!value) return Promise.reject(new Error('请输入密码'));
                  return value.length >= 8
                    ? Promise.resolve()
                    : Promise.reject(new Error('密码至少 8 位'));
                },
              },
            ]}
            extra={editor?.mode === 'edit' ? '留空表示不修改密码' : '至少 8 位'}
          >
            <Input.Password placeholder="登录密码" autoComplete="new-password" maxLength={72} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
