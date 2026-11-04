import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import { firstAllowedRoute } from '@/utils/permissions';

export default function Forbidden() {
  const navigate = useNavigate();
  const identity = useAuth((s) => s.identity);

  return (
    <Result
      status="403"
      title="没有访问权限"
      subTitle="当前角色没有该模块的权限，请联系超级管理员调整角色。"
      extra={
        <Button
          type="primary"
          onClick={() => navigate(firstAllowedRoute(identity?.permissions ?? []), { replace: true })}
        >
          返回可访问页面
        </Button>
      }
    />
  );
}
