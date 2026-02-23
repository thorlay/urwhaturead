# Quick 单机 VPS 上线手册（Ubuntu 24.04）

适用场景：

- 只有 1 台 VPS（你现在的 5C/6G 配置足够跑第一版）。
- 目标是先稳定上线，再迭代功能。
- 架构：`Caddy + Frontend 静态文件 + Go API + PostgreSQL(Docker)`。

---

## 0. 先决条件

你需要先准备：

1. 一个域名（你的：`urwhaturead.com`）
2. VPS 公网 IP（你的：`107.173.157.137`）
3. 本地能 SSH 登录 VPS

推荐直接使用根域名上线：

- 生产域名：`urwhaturead.com`
- DNS 记录：`A  urwhaturead.com  -> 107.173.157.137`

建议目录统一放在：

```bash
/opt/quick
```

---

## 1. VPS 初始化

SSH 登录后执行：

```bash
sudo apt update && sudo apt upgrade -y
sudo timedatectl set-timezone America/Los_Angeles

# 基础工具
sudo apt install -y git curl unzip ufw

# Go / Node / Caddy / Docker
sudo apt install -y golang-go nodejs npm caddy docker.io docker-compose-v2
```

把当前用户加入 docker 组：

```bash
sudo usermod -aG docker $USER
newgrp docker
```

---

## 2. 拉代码并准备环境变量

```bash
sudo mkdir -p /opt/quick
sudo chown -R $USER:$USER /opt/quick
cd /opt/quick

git clone <你的仓库地址> .
cp .env.example .env
```

建议直接用生产模板：

```bash
cp deploy/.env.prod.example .env
```

如果你就是部署到当前域名/IP（`urwhaturead.com` / `107.173.157.137`），可直接用专用模板：

```bash
cp deploy/.env.prod.urwhaturead.example .env
```

编辑 `.env`（生产环境最少改这些）：

```env
# 必改
ADMIN_AUTH_ENABLED=true
ADMIN_TOKEN=请换成强随机字符串
ADMIN_USERNAME=admin
ADMIN_PASSWORD=请换成强密码
POSTGRES_PASSWORD=请换成强密码

# 建议
DB_HOST=127.0.0.1
DB_TIMEZONE=UTC
SERVER_PORT=8080
AI_SUMMARY_ENABLED=true

# AI_BASE_URL 必须指向“线上可访问地址”
# 如果你的 AI 代理也部署在同一台 VPS（3000 端口），可用下面形式
AI_SUMMARY_BASE_URL=http://127.0.0.1:3000/gemini-cli-oauth/v1/chat/completions
AI_SUMMARY_API_KEY=123456
AI_SUMMARY_API_STYLE=openai_chat
AI_SUMMARY_API_KEY_HEADER=Authorization
AI_SUMMARY_API_KEY_PREFIX=Bearer
AI_SUMMARY_MODEL=gemini-2.5-flash
```

注意：

- 如果 AI 代理不在本机，`AI_SUMMARY_BASE_URL` 要改成真实外网/内网地址。
- `ADMIN_TOKEN` 不要和其它密码复用。
- `ADMIN_PASSWORD` 必须设置，否则管理员登录接口不可用。
- 所有 `CHANGE_ME_*` 必须替换后再启动服务。

---

## 3. 启动 PostgreSQL

首次只建议开 `postgres`，线上可以不暴露 pgAdmin：

```bash
cd /opt/quick
docker compose up -d postgres
docker compose ps
```

检查数据库连通：

```bash
docker compose exec -T postgres psql -U "${POSTGRES_USER:-quick}" -d "${POSTGRES_DB:-news_dev}" -c '\l'
```

---

## 4. 构建后端并设为 systemd 服务

编译：

```bash
cd /opt/quick
mkdir -p bin
go build -o ./bin/quick-server ./cmd/server
```

创建服务文件：

```bash
sudo tee /etc/systemd/system/quick-api.service >/dev/null <<'EOF'
[Unit]
Description=Quick API Server
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=REPLACE_WITH_YOUR_LINUX_USER
WorkingDirectory=/opt/quick
EnvironmentFile=/opt/quick/.env
ExecStart=/opt/quick/bin/quick-server
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
```

把 `REPLACE_WITH_YOUR_LINUX_USER` 改成你的系统用户名，然后启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable quick-api
sudo systemctl restart quick-api
sudo systemctl status quick-api --no-pager
```

本机健康检查：

```bash
curl -sS http://127.0.0.1:8080/healthz
```

---

## 5. 构建前端

```bash
cd /opt/quick/frontend
npm ci
npm run build
```

构建产物在：

```bash
/opt/quick/frontend/dist
```

---

## 6. 配置 Caddy（HTTPS + 前后端同域）

创建 Caddy 配置：

```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
urwhaturead.com {
    encode gzip zstd

    handle /api/* {
        reverse_proxy 127.0.0.1:8080
    }

    handle /healthz {
        reverse_proxy 127.0.0.1:8080
    }

    handle {
        root * /opt/quick/frontend/dist
        try_files {path} /index.html
        file_server
    }
}
EOF
```

然后重载：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable caddy
sudo systemctl restart caddy
sudo systemctl status caddy --no-pager
```

---

## 7. 域名与防火墙

在域名服务商处配置：

- `A` 记录：`urwhaturead.com -> 107.173.157.137`

验证 DNS 已生效：

```bash
dig +short urwhaturead.com
```

返回应包含：

```text
107.173.157.137
```

开启防火墙：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

---

## 8. 上线验证清单

按顺序检查：

1. `curl http://127.0.0.1:8080/healthz` 返回 `{"status":"ok"}`
2. `docker compose ps` 里 `postgres` 是 `healthy`
3. 打开 `https://你的域名` 能看到前端页面
   （你的应为 `https://urwhaturead.com`）
4. 前端可正常加载来源与 feed
5. 管理写操作在未带 token 时被拒绝，带 token 时成功
6. 页面右上角可用“管理员登录”按钮登录（使用 `ADMIN_USERNAME/ADMIN_PASSWORD`）

---

## 9. 发布更新流程（每次改代码）

```bash
cd /opt/quick
git pull

# 后端
go build -o ./bin/quick-server ./cmd/server
sudo systemctl restart quick-api

# 前端
cd /opt/quick/frontend
npm ci
npm run build
sudo systemctl reload caddy
```

---

## 10. 数据库备份（建议当天就加）

创建备份脚本：

```bash
mkdir -p /opt/quick/backups
cat >/opt/quick/scripts/backup-db.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/quick
ts=$(date +%F-%H%M%S)
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-quick}" "${POSTGRES_DB:-news_dev}" | gzip > "/opt/quick/backups/news_dev-${ts}.sql.gz"
find /opt/quick/backups -type f -name '*.sql.gz' -mtime +14 -delete
EOF
chmod +x /opt/quick/scripts/backup-db.sh
```

加 crontab（每天 03:30）：

```bash
crontab -e
```

写入：

```cron
30 3 * * * /opt/quick/scripts/backup-db.sh >> /opt/quick/backups/backup.log 2>&1
```

---

## 11. 强烈建议的安全项

1. `ADMIN_TOKEN`、数据库密码、AI Key 都改成强随机值
2. 不对公网暴露数据库端口（靠 UFW 拦住）
3. 定期 `apt upgrade`，至少每月一次
4. 关闭不必要服务（线上可不启 pgAdmin）
5. 日志定期查看：

```bash
sudo journalctl -u quick-api -n 200 --no-pager
sudo journalctl -u caddy -n 200 --no-pager
```

---

## 12. 常见故障快查

1. 页面 502：先看 `quick-api` 服务是否挂了
2. 页面空白但 API 正常：前端 `dist` 没有重新 build
3. AI 摘要失败：`AI_SUMMARY_BASE_URL/API_STYLE/HEADER/PREFIX` 不匹配
4. RSS 拉取失败：目标站限流或超时，先 `sources/:id/test` 验证
5. 端口占用：检查旧进程或旧服务未停
