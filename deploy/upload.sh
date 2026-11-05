#!/bin/bash
# upload.sh - 仅上传前端静态文件与.NET项目，不包含打包逻辑 (SCP版)

set -euo pipefail

# ==================== 配置区 ====================
# ssh -v -i C:\Users\fuwen\.ssh\uploaddata.pem root@43.142.147.244
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
NET_PROJECT_NAME="SpServer"  # 宝塔中.NET项目的名称
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

echo "2. 正在重启 .NET 项目..."

# 找进程 -> 杀掉 -> 切换到 www 用户启动
ssh -i "$SSH_KEY" -p "$PORT" "$SERVER" bash -s << EOF
    echo "正在查找并停止旧进程..."
    # 查找包含 SpServer 的 dotnet 进程并杀掉
    pkill -u www -f "SpServer" 
    sleep 2
  
    echo "完成关闭旧进程"
EOF
echo "========== 开始上传 .NET 项目 =========="
# 远程创建目录
ssh -i "$SSH_KEY" -p "$PORT" "$SERVER" "mkdir -p '$REMOTE_DOTNET'"
# 使用 scp 递归上传目录内的所有文件 (-P 大写)
scp -i "$SSH_KEY" -P "$PORT" -r "$LOCAL_DOTNET"* "$SERVER:$REMOTE_DOTNET/"
echo ".NET 项目上传完成"

echo "========== 全部上传任务结束 =========="


# ==================== 刷新/重启服务 ====================
echo "2. 正在重启 .NET 项目..."

# 找进程 -> 杀掉 -> 切换到 www 用户启动
ssh -i "$SSH_KEY" -p "$PORT" "$SERVER" bash -s << EOF
    echo "正在查找并停止旧进程..."
    # 查找包含 SpServer 的 dotnet 进程并杀掉
    #pkill -u www -f "SpServer" 
    #sleep 2

    # 将整个项目目录及其内部文件的所有者改为 www
    chown -R www:www /www/wwwroot/sp/server

    # 如果之前生成过 app.log，先删掉（避免权限冲突）
    rm -f /www/wwwroot/sp/server/app.log
    
    echo "正在启动新进程..."
    # 切换到 www 用户，进入目录，后台启动（注意：把路径和dll名改成你实际的）
    su -s /bin/bash www -c "cd /www/wwwroot/sp/server && nohup dotnet SpServer.dll > app.log 2>&1 &"
    
    echo "重启完成！"
EOF