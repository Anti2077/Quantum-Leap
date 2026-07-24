import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

export type UiLanguage = "en" | "zh-CN";
type TranslationParams = Record<string, string | number>;

const LANGUAGE_KEY = "quantum-leap.language";

const en = {
  settings: "Settings",
  appearance: "Appearance",
  followSystem: "Follow system",
  light: "Light",
  dark: "Dark",
  language: "Language",
  about: "About Quantum Leap",
  close: "Close",
  version: "Version {{version}}",
  projectHomepage: "Project homepage",
  license: "GPL-3.0-only",
  ready: "Ready",
  connecting: "Connecting",
  confirm: "Confirm",
  testing: "Testing",
  stopping: "Stopping",
  complete: "Complete",
  stopped: "Stopped",
  error: "Error",
  loadSavedDevice: "Load a saved device",
  enterManually: "Enter manually",
  genericStartError: "Unable to start the test. Check the connection settings.",
  ratingLegend: "Internet GOAT",
  ratingOverdrive: "Ultra Cracked",
  ratingPrime: "Cracked",
  ratingElite: "Built Different",
  ratingSolid: "Lowkey Nice",
  ratingNpc: "NPC",
  ratingMeh: "Mid",
  ratingSlow: "Cooked",
  promptExistingTitle: "Existing test service detected",
  promptExistingMessage: "A service is already listening on the target port. Continuing will reuse it and leave it running when the test finishes.",
  promptHostKeyTitle: "Server identity changed",
  promptHostKeyMessage: "The current SSH host key differs from the known record. Verify the server identity before continuing.",
  promptMissingTitle: "iperf3 is not installed remotely",
  promptMissingMessage: "APT was detected. Run the command below on the server, then check again.",
  promptUnavailableTitle: "Test service unavailable",
  promptUnavailableMessage: "No running service was detected. Check the address and port.",
  serverAddressDetail: "Server address: {{host}}\nTest port: {{port}}",
  previewCloud: "Edge node",
  previewRouter: "Lab router",
  previewDevMachine: "Development machine",
  previewComplete: "Test complete. The remote server has been stopped.",
  previewRunning: "Glass theme preview",
  waitingForServer: "Waiting to connect to a server",
  missingIperfCancelled: "Test not started: this device does not have iperf3",
  connectionCancelled: "Connection cancelled",
  clientSelected: "{{name}} is now the test initiator",
  endpointsSwapped: "Test initiator and server swapped",
  serverLoaded: "Loaded {{host}}",
  serverSaved: "Saved {{name}} to Favorites",
  connectingDual: "Establishing secure SSH connections to both devices",
  connectingSsh: "Establishing a secure SSH connection",
  connectingExisting: "Connecting to the existing test service",
  copyFailed: "Copy failed. Select the install command manually.",
  missingRemoteIperf: "Test not started: the remote device does not have iperf3",
  retransmitWarning: "Detected {{count}} TCP retransmissions. Check the USB adapter, cable, or switch port.",
  savedServers: "Favorites",
  connectServer: "Connect to server",
  configureConnection: "Configure connection",
  closeConnectionSettings: "Close connection settings",
  connectionPanelDescription: "Connection, endpoint, and test configuration",
  savedSshMeta: "SSH {{port}} - {{username}}",
  deleteServer: "Delete {{host}}",
  addCurrentServer: "Add current server",
  optionalNote: "Note (optional)",
  serverNote: "Server note",
  save: "Save",
  cancel: "Cancel",
  noSavedServers: "No saved servers",
  delete: "Delete",
  sshManagedShort: "SSH - {{username}}@{{host}}",
  directShort: "Direct - port {{port}}",
  topology: "Test topology",
  topologyHelp: "Test topology details",
  localTest: "Local test",
  localTestHelp: "Run the iperf3 client on this Mac and test against the target server.",
  remoteTest: "Device-to-device",
  remoteTestHelp: "Connect to two remote devices over SSH, with device A testing against device B.",
  dualDevices: "Remote devices",
  editClient: "Edit device A (initiator)",
  initiator: "Initiator",
  ipNotConfigured: "Not set",
  swapEndpoints: "Swap devices A and B",
  swapRequiresSsh: "The server must use SSH management before the endpoints can be swapped",
  editServer: "Edit device B (server)",
  server: "Server",
  clientConfiguration: "Initiator configuration",
  serverConfiguration: "Server configuration",
  clientAddress: "Device A address",
  serverAddress: "Server address",
  deviceBAddress: "Device B address",
  sshPort: "SSH port",
  testPort: "Test port",
  username: "Username",
  clientAuth: "Device A SSH authentication",
  sshAuth: "SSH authentication",
  passwordLogin: "Password",
  sshKey: "SSH key",
  privateKeyPath: "SSH private key path",
  passphraseOptional: "Key passphrase (optional)",
  passphrasePlaceholder: "Leave blank for an unencrypted key",
  sshPassword: "SSH password",
  clientPasswordPlaceholder: "Enter the device A password",
  passwordPlaceholder: "Enter password",
  advancedOptions: "Advanced options",
  customPath: "Custom path",
  customSettings: "Configured",
  autoDetect: "Auto-detect",
  localBindIp: "Local client bind IP",
  clientBindIp: "Device A client bind IP",
  serverBindIp: "Server bind IP",
  bindIpPlaceholder: "Optional, e.g. 192.168.1.20",
  bindIpError: "Enter a valid IPv4 or IPv6 address.",
  bindIpHelper: "Leave blank to use the route selected by the operating system.",
  serverBindIpHelper: "The client connects to this IP. Leave blank to use the device address.",
  clientIperfPath: "Device A iperf3 path",
  serverIperfPath: "Device B iperf3 path",
  iperfPathPlaceholder: "Auto-detect, e.g. /opt/bin/iperf3",
  absolutePathError: "Enter an absolute path, e.g. /opt/bin/iperf3",
  pathHelper: "Leave blank to search PATH, QNAP /opt/bin, and common Entware directories.",
  serverMode: "Service mode",
  serverModeHelp: "Service mode details",
  sshManaged: "SSH managed",
  sshManagedHelp: "Connect over SSH, start iperf3 -s, and stop this service when the test finishes.",
  existingService: "Existing service",
  existingServiceHelp: "For Docker, restricted environments, or persistent system services. Only the test port is required.",
  testMode: "Test mode",
  standardTest: "Standard test",
  advancedTest: "Advanced test",
  streams: "{{count}} streams",
  bidirectionalDuration: "{{seconds}} seconds each way",
  protocol: "Protocol",
  direction: "Direction",
  upload: "Upload",
  download: "Download",
  parallelStreams: "Parallel streams",
  duration: "Duration",
  continuous: "Continuous",
  seconds: "sec",
  startFullTest: "Start full test",
  startTest: "Start test",
  stopTest: "Stop test",
  resizePanels: "Resize connection settings and test results",
  resizePanelsHelp: "Drag to resize. Double-click to restore the default.",
  standardProfile: "Standard - TCP - {{count}} streams",
  advancedProfile: "Advanced - {{protocol}} - {{count}} streams",
  combinedResults: "Combined test results",
  uploadSpeed: "Upload speed",
  downloadSpeed: "Download speed",
  bandwidthUnit: "Bandwidth unit",
  thisDevice: "This device",
  localClient: "Local client",
  remoteClient: "Remote client",
  result: "Result",
  standby: "Standby",
  sampleCount: "{{count}} samples",
  deviceA: "Device A",
  notConnected: "Not connected",
  remoteServer: "Remote server",
  downloadRating: "Download rating",
  live: "Live",
  uploadAverage: "Upload average",
  downloadAverage: "Download average",
  loadedLatency: "Loaded latency",
  tcpRetransmits: "TCP retransmits",
  totalTransfer: "Total transfer",
  averageSpeed: "Average speed",
  peak: "Peak",
  udpJitter: "UDP jitter",
  rttVariation: "RTT variation",
  transferRetransmits: "Transfer / retransmits",
  transferred: "Transferred",
  later: "Later",
  copied: "Copied",
  copyCommand: "Copy command",
  trustContinue: "Trust and continue",
  installedRetry: "Installed, check again",
  reuseContinue: "Reuse and continue",
  latencyJitter: "Latency {{latency}} - Jitter {{jitter}}",
  chartUpload: "Upload {{value}}",
  chartDownload: "Download {{value}}",
  savedActionError: "The saved-server operation failed.",
  genericCompleted: "Test complete",
  genericStopped: "Test stopped",
  genericFailed: "The operation failed"
} as const;

type TranslationKey = keyof typeof en;

const zhCN: Record<TranslationKey, string> = {
  settings: "设置", appearance: "外观", followSystem: "跟随系统", light: "浅色", dark: "深色",
  language: "语言", about: "关于 Quantum Leap", close: "关闭", version: "版本 {{version}}",
  projectHomepage: "项目主页", license: "GPL-3.0-only", ready: "就绪", connecting: "连接中",
  confirm: "等待确认", testing: "测速中", stopping: "停止中", complete: "已完成", stopped: "已停止", error: "错误",
  loadSavedDevice: "从常用设备载入", enterManually: "手动填写", genericStartError: "无法启动测速，请检查连接参数",
  ratingLegend: "你牛大了", ratingOverdrive: "夯爆了", ratingPrime: "夯", ratingElite: "人上人",
  ratingSolid: "还不错", ratingNpc: "NPC", ratingMeh: "就那样", ratingSlow: "拉完了",
  promptExistingTitle: "检测到已有测速服务", promptExistingMessage: "目标端口已有服务监听。继续将直接复用它，完成后不会终止该服务。",
  promptHostKeyTitle: "服务器身份已变化", promptHostKeyMessage: "当前 SSH 主机密钥与已知记录不一致，请确认服务器身份后再继续。",
  promptMissingTitle: "远端未安装 iperf3", promptMissingMessage: "已检测到 APT。请登录服务器执行下面的命令，安装完成后重新检测。",
  promptUnavailableTitle: "测速服务不可用", promptUnavailableMessage: "未检测到服务运行，请排查地址和端口。",
  serverAddressDetail: "服务器地址：{{host}}\n测速端口：{{port}}", previewCloud: "边缘节点", previewRouter: "实验室路由器",
  previewDevMachine: "开发机", previewComplete: "测速完成，远端服务器已关闭", previewRunning: "雪白玻璃主题预览",
  waitingForServer: "等待连接服务器", missingIperfCancelled: "测速未开始：设备缺少 iperf3", connectionCancelled: "已取消本次连接",
  clientSelected: "已将 {{name}} 设为测速发起端", endpointsSwapped: "已交换测速发起端与服务端", serverLoaded: "已载入 {{host}}",
  serverSaved: "已保存 {{name}} 到常用服务器", connectingDual: "正在建立双端 SSH 安全通道", connectingSsh: "正在建立 SSH 安全通道",
  connectingExisting: "正在连接已有测速服务", copyFailed: "复制失败，请手动选择安装命令", missingRemoteIperf: "测速未开始：远端缺少 iperf3",
  retransmitWarning: "检测到 {{count}} 次 TCP 重传，建议检查 USB 网卡、线材或交换端口", savedServers: "常用服务器",
  connectServer: "连接服务器", configureConnection: "配置连接", closeConnectionSettings: "关闭连接设置",
  connectionPanelDescription: "连接、端点与测速参数设置", savedSshMeta: "{{username}} · SSH {{port}}", deleteServer: "删除 {{host}}",
  addCurrentServer: "添加当前服务器", optionalNote: "备注（可选）", serverNote: "服务器备注", save: "确认保存", cancel: "取消",
  noSavedServers: "暂无常用服务器", delete: "删除", sshManagedShort: "SSH · {{username}}@{{host}}", directShort: "直连 · 端口 {{port}}",
  topology: "测速拓扑", topologyHelp: "测速拓扑说明", localTest: "本机测速",
  localTestHelp: "由此 Mac 运行 iperf3 客户端，对目标服务器进行测速。", remoteTest: "双端互测",
  remoteTestHelp: "通过 SSH 连接两台远端设备，由设备 A 向设备 B 发起测速。", dualDevices: "双端设备", editClient: "编辑设备 A 发起端",
  initiator: "发起端", ipNotConfigured: "未配置 IP", swapEndpoints: "交换设备 A 和设备 B",
  swapRequiresSsh: "服务端使用 SSH 自动管理时才能交换", editServer: "编辑设备 B 服务端", server: "服务端",
  clientConfiguration: "发起端配置", serverConfiguration: "服务端配置", clientAddress: "设备 A 地址", serverAddress: "服务器地址",
  deviceBAddress: "设备 B 地址", sshPort: "SSH 端口", testPort: "测速端口", username: "用户名",
  clientAuth: "测速发起端 SSH 认证方式", sshAuth: "SSH 认证方式", passwordLogin: "密码登录", sshKey: "SSH 密钥",
  privateKeyPath: "SSH 私钥路径", passphraseOptional: "私钥口令（可选）", passphrasePlaceholder: "未加密私钥可留空",
  sshPassword: "SSH 密码", clientPasswordPlaceholder: "输入设备 A 密码", passwordPlaceholder: "输入密码", advancedOptions: "高级选项",
  customPath: "已指定路径", customSettings: "已配置", autoDetect: "自动检测",
  localBindIp: "本机客户端绑定 IP", clientBindIp: "设备 A 客户端绑定 IP", serverBindIp: "服务端绑定 IP",
  bindIpPlaceholder: "选填，例如 192.168.1.20", bindIpError: "请输入有效的 IPv4 或 IPv6 地址",
  bindIpHelper: "留空将使用操作系统自动选择的路由", serverBindIpHelper: "客户端将连接此 IP；留空使用设备地址",
  clientIperfPath: "设备 A iperf3 路径", serverIperfPath: "设备 B iperf3 路径",
  iperfPathPlaceholder: "自动检测，例如 /opt/bin/iperf3", absolutePathError: "请填写绝对路径，例如 /opt/bin/iperf3",
  pathHelper: "留空会自动搜索 PATH、QNAP /opt/bin 和常见 Entware 目录", serverMode: "服务模式", serverModeHelp: "服务模式说明",
  sshManaged: "SSH 自动管理", sshManagedHelp: "连接服务器，启动 iperf3 -s，测试完成后自动关闭本次服务。",
  existingService: "直连已有服务", existingServiceHelp: "适用于 Docker、权限受限或 systemctl 持久化运行的服务，只需填写测速端口。",
  testMode: "测速模式", standardTest: "标准测试", advancedTest: "高级测试", streams: "{{count}} 并发",
  bidirectionalDuration: "上下行各 {{seconds}} 秒", protocol: "协议", direction: "方向", upload: "上传", download: "下载",
  parallelStreams: "并发线程", duration: "持续时间", continuous: "持续", seconds: "秒", startFullTest: "开始完整测试",
  startTest: "开始测速", stopTest: "中断测速", resizePanels: "调整连接信息与测速结果的宽度",
  resizePanelsHelp: "拖动调整宽度，双击恢复默认", standardProfile: "标准 · TCP · {{count}} 并发",
  advancedProfile: "高级 · {{protocol}} · {{count}} 并发", combinedResults: "综合测速结果", uploadSpeed: "上行速率",
  downloadSpeed: "下行速率", bandwidthUnit: "速率单位", thisDevice: "本机", localClient: "本机客户端", deviceA: "设备 A",
  remoteClient: "远端客户端", result: "结果", standby: "待机", sampleCount: "{{count}} 个采样",
  notConnected: "未连接", remoteServer: "远端服务器", downloadRating: "下载评价", live: "实时", uploadAverage: "上传平均",
  downloadAverage: "下载平均", loadedLatency: "负载延迟", tcpRetransmits: "TCP 重传", totalTransfer: "总传输",
  averageSpeed: "平均速率", peak: "峰值", udpJitter: "UDP 抖动", rttVariation: "RTT 波动",
  transferRetransmits: "传输 / 重传", transferred: "已传输", later: "稍后处理", copied: "已复制", copyCommand: "复制命令",
  trustContinue: "信任并继续", installedRetry: "已安装，重新检测", reuseContinue: "复用并继续",
  latencyJitter: "延迟 {{latency}} · 抖动 {{jitter}}", chartUpload: "上传 {{value}}", chartDownload: "下载 {{value}}",
  savedActionError: "常用服务器操作失败", genericCompleted: "测速完成", genericStopped: "测速已停止", genericFailed: "操作失败"
};

const dictionaries: Record<UiLanguage, Record<TranslationKey, string>> = { en, "zh-CN": zhCN };

function savedLanguage(): UiLanguage {
  try {
    return localStorage.getItem(LANGUAGE_KEY) === "zh-CN" ? "zh-CN" : "en";
  } catch {
    return "en";
  }
}

function interpolate(template: string, params?: TranslationParams) {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(params[key] ?? ""));
}

interface I18nValue {
  language: UiLanguage;
  setLanguage: (language: UiLanguage) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
  formatNumber: (value: number) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, updateLanguage] = useState<UiLanguage>(savedLanguage);

  const setLanguage = useCallback((next: UiLanguage) => {
    updateLanguage(next);
    try {
      localStorage.setItem(LANGUAGE_KEY, next);
    } catch {
      // The selected language still applies for this session.
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) => interpolate(dictionaries[language][key], params),
    [language]
  );

  const formatNumber = useCallback((value: number) => value.toLocaleString(language), [language]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === "zh-CN" ? "Quantum Leap (跃迁)" : "Quantum Leap";
    if ("__TAURI_INTERNALS__" in window) {
      void getCurrentWindow().setTitle(document.title).catch(() => undefined);
    }
  }, [language]);

  const value = useMemo(
    () => ({ language, setLanguage, t, formatNumber }),
    [formatNumber, language, setLanguage, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}

export type { TranslationKey };
