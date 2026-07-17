# Pulse iperf3 UI

基于 Tauri 2、Rust、React、TypeScript、Tailwind CSS 与 Framer Motion 的 macOS SSH/iperf3 测速应用。

## 项目结构

```text
iperf3_ui/
├── src/                         # React 前端
│   ├── components/
│   │   ├── SpeedWorkbench.tsx   # 凭证表单、状态机与测速工作台
│   │   ├── EnergyLink.tsx       # 上传/下载双向能量流
│   │   ├── FluidAreaChart.tsx   # 无坐标轴轻量 SVG 面积图
│   │   ├── ComparisonChart.tsx  # 综合测试双曲线、平均线和峰值
│   │   ├── NumberTicker.tsx     # 逐位弹簧数字滚动器
│   │   └── MacGlyph.tsx         # 本机节点图标
│   ├── lib/                     # Tauri API、类型与数值格式化
│   └── styles.css               # 液态玻璃材质与响应式布局
├── src-tauri/
│   ├── src/
│   │   ├── main.rs              # Tauri 命令、会话状态和退出清理
│   │   ├── ssh.rs               # SSH 认证、远端进程启动/终止
│   │   ├── iperf.rs             # 本地客户端、JSON 流解析和事件推送
│   │   ├── saved_server.rs      # 常用服务器元数据与 macOS Keychain
│   │   └── model.rs             # 请求及事件模型
│   ├── capabilities/default.json
│   ├── icons/                   # AppIcon 源文件与 Tauri 生成图标
│   └── tauri.conf.json
└── package.json
```

## 运行前提

- macOS 13 或更高版本
- Node.js 20 或更高版本、Rust stable
- 本机和远端服务器均已安装 `iperf3`
- SSH 用户允许启动和终止其自己的 `iperf3` 进程

本机从 `PATH`、`/opt/homebrew/bin/iperf3` 和 `/usr/local/bin/iperf3` 查找程序；也可通过 `IPERF3_PATH` 指定路径。密码只保存在当前 Rust 进程内存中，不会写入磁盘。已存在于 `~/.ssh/known_hosts` 的主机若密钥不匹配，连接会被拒绝。

目标端口已有持久化 iperf3 服务时，应用会在收到端口占用错误后询问是否复用；应用只会清理由自己启动并记录 PID 的临时服务。服务器重装导致 known_hosts 密钥变化时，界面会显示当前 SHA256 指纹并询问是否仅本次信任，不会修改 known_hosts。两种授权都只对当前请求有效。

测速提供两种模式：

- 标准测试：固定 TCP、4 并发，依次执行 10 秒上传和 10 秒下载，完成后汇总双向平均速率、总传输量与 RTT。
- 高级测试：可选择 TCP/UDP、上传/下载方向、1 至 32 个并发线程，以及 3 至 120 秒持续时间。UDP 使用 `-b 0` 进行不限速测试并统计 Jitter。

标准测试完成后会同时绘制上传和下载曲线、各自平均线与峰值点，并只按下载平均速率评级：低于 50 Mbps 为“拉完了”，50 Mbps 至 1 Gbps 为“NPC”，1 至 2 Gbps 为“人上人”，2 至 2.5 Gbps 为“夯”，超过 2.5 Gbps 为“你牛大了”。

常用服务器菜单会记忆地址、SSH/iperf3 端口、用户名和密码。非敏感字段保存在 Tauri 应用配置目录，密码使用 macOS Keychain 通用密码项保存，不会写入配置 JSON 或浏览器 localStorage。

## 开发与打包

```bash
npm install
npm run tauri:dev
npm run tauri:build
```

仅检查前端可运行 `npm run dev`。后端测试与静态检查：

```bash
cd src-tauri
cargo test
cargo clippy -- -D warnings
```

标准 `iperf3 -J` 会在测试结束后一次性输出 JSON，无法驱动实时曲线。本项目使用兼容 JSON 语义的 `--json-stream -i 1`，要求本机 iperf3 3.17 或更高版本。高级单向测试启动 `iperf3 -s -1`；标准双向测试启动临时持续服务，并在两段测试结束后按 PID 清理。
