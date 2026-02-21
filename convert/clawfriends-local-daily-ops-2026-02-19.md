# ClawFriends 本机双版本日常使用手册（官方 OpenClaw + Fork）

## 1. 目标

同一台电脑同时使用：

- 官方全局安装版（`openclaw`）
- 你的 Fork 版（`/Users/haoqi/OnePersonCompany/ClawFriends`）

并保证：

- 命令不混用
- 配置目录不冲突
- 端口不冲突

## 2. 约定（你当前已执行）

Fork 运行上下文：

- `OPENCLAW_PROFILE=clawfriends`
- `OPENCLAW_STATE_DIR=~/.openclaw-clawfriends`
- `OPENCLAW_CONFIG_PATH=~/.openclaw-clawfriends/openclaw.json`
- `OPENCLAW_GATEWAY_PORT=19021`

你当前启动日志已显示正常：

- `listening on ws://127.0.0.1:19021`
- `canvas host mounted at http://127.0.0.1:19021/__openclaw__/canvas/`
- `Browser control service ready`

## 3. 建议函数（放到 ~/.zshrc）

```bash
# 官方版
oc_main() {
  openclaw "$@"
}

# Fork 版（固定在 ClawFriends 仓库运行）
oc_fork() {
  (
    cd /Users/haoqi/OnePersonCompany/ClawFriends || exit 1
    OPENCLAW_PROFILE=clawfriends \
    OPENCLAW_STATE_DIR="$HOME/.openclaw-clawfriends" \
    OPENCLAW_CONFIG_PATH="$HOME/.openclaw-clawfriends/openclaw.json" \
    OPENCLAW_GATEWAY_PORT=19021 \
    pnpm openclaw "$@"
  )
}

# 更短启动别名（可选）
alias of='oc_fork gateway'
```

加载配置：

```bash
source ~/.zshrc
```

## 4. 日常命令速查

### 4.1 启动

官方：

```bash
oc_main gateway --port 18789
```

Fork：

```bash
oc_fork gateway
```

如果需要临时传 token：

```bash
oc_fork gateway --token '<YOUR_TOKEN>'
```

### 4.2 查看状态

```bash
oc_main gateway status --deep
oc_fork gateway status --deep
```

### 4.3 看当前配置

```bash
oc_fork config get gateway.mode
oc_fork config get gateway.bind
oc_fork config get gateway.port
```

### 4.4 修改配置

```bash
oc_fork config set gateway.mode local
oc_fork config set gateway.bind loopback
oc_fork config set gateway.port 19021
```

注意：

- `config set` 对字符串不需要 `--json`
- 如果用了 `--json`，字符串必须写成 `"local"` 这种 JSON 字符串

## 5. 冲突排查

### 5.1 端口占用

```bash
ss -ltnp | rg '18789|19021'
```

### 5.2 启动报 `GatewayLockError` / `EADDRINUSE`

- 换端口启动，或先停已有实例
- Fork 常用：

```bash
oc_fork gateway --force
```

### 5.3 发现命令跑到了错误版本

检查：

```bash
which openclaw
oc_main --version
oc_fork --version
```

## 6. 推荐工作流

- 稳定运行用 `oc_main`
- 开发联调用 `oc_fork`
- 不要让两者共用同一个 state/config 目录
- 两边端口至少间隔 20（你现在 18789 / 19021，安全）

## 7. 你当前可直接用的最短命令

```bash
# Fork 启动
of

# Fork 状态
oc_fork gateway status --deep

# 官方状态
oc_main gateway status --deep
```
