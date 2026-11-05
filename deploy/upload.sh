#!/bin/bash
# upload.sh - 仅上传前端静态文件与.NET项目，不包含打包逻辑 (SCP版)

set -euo pipefail

# ==================== 配置区 ====================
# 服务器信息
SERVER="root@43.142.147.244"
PORT="22"
# 私钥路径
SSH_KEY="$HOME/.ssh/uploaddata.pem"

# 1. 前端静态项目配置
LOCAL_FRONTEND="./dist/admin/"
REMOTE_FRONTEND="/www/wwwroot/sp/admin"

# 2. .NET 后端项目配置
LOCAL_DOTNET="./dist/sp-server/"
REMOTE_DOTNET="/www/wwwroot/sp/server"
NET_PROJECT_NAME="sp-server"  # 宝塔中.NET项目的名称
# ===============================================

# 检查本地目录是否存在
for dir in "$LOCAL_FRONTEND" "$LOCAL_DOTNET"; do
  if [ ! -d "$dir" ]; then
    echo "错误: 本地目录不存在 -> $dir"
    exit 1
  fi
done

echo "========== 开始上传前端静态文件 =========="
# 远程创建目录
ssh -i "$SSH_KEY" -p "$PORT" "$SERVER" "mkdir -p '$REMOTE_FRONTEND'"
# 使用 scp 递归上传目录内的所有文件 (-P 大写)
scp -i "$SSH_KEY" -P "$PORT" -r "$LOCAL_FRONTEND"* "$SERVER:$REMOTE_FRONTEND/"
echo "前端静态文件上传完成"

echo "========== 开始上传 .NET 项目 =========="
# 远程创建目录
ssh -i "$SSH_KEY" -p "$PORT" "$SERVER" "mkdir -p '$REMOTE_DOTNET'"
# 使用 scp 递归上传目录内的所有文件 (-P 大写)
scp -i "$SSH_KEY" -P "$PORT" -r "$LOCAL_DOTNET"* "$SERVER:$REMOTE_DOTNET/"
echo ".NET 项目上传完成"

echo "========== 全部上传任务结束 =========="


# ==================== 刷新/重启服务 ====================
echo "========== 开始刷新服务 =========="

echo "1. 重载 Nginx (前端生效)..."
# reload 不会中断现有连接，比重启更安全
ssh -i "$SSH_KEY" -p "$PORT" "$SERVER" "nginx -s reload" || echo "Nginx reload 失败，请手动检查"

echo "2. 重启 .NET 项目 (后端生效)..."
# 调用宝塔内部脚本重启 .NET 项目
ssh -i "$SSH_KEY" -p "$PORT" "$SERVER" "btpython /www/server/panel/script/restart_project.py net '$NET_PROJECT_NAME'" || echo "宝塔重启命令失败，请确认项目名称是否正确"

echo "========== 全部任务结束 =========="
