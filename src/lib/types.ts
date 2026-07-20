export type TransferDirection = "upload" | "download";
export type TestMode = "standard" | "advanced";
export type TransportProtocol = "tcp" | "udp";
export type SshAuthMethod = "password" | "privateKey";
export type ServerMode = "sshManaged" | "existing";

export interface SpeedTestRequest {
  host: string;
  sshPort: number;
  iperfPort: number;
  serverMode: ServerMode;
  username: string;
  password: string;
  authMethod: SshAuthMethod;
  privateKeyPath: string;
  passphrase: string;
  testMode: TestMode;
  direction: TransferDirection;
  protocol: TransportProtocol;
  parallelStreams: number;
  durationSeconds: number;
  reuseExistingServer: boolean;
  allowHostKeyMismatch: boolean;
}

export interface SpeedSample {
  elapsed: number;
  bandwidthBps: number;
  bytes: number;
  latencyMs?: number | null;
  jitterMs?: number | null;
  retransmits?: number | null;
  direction: TransferDirection;
}

export interface SpeedStateEvent {
  phase: "idle" | "starting" | "confirming" | "running" | "stopping" | "completed" | "cancelled" | "failed";
  message: string;
}

export interface SpeedPromptEvent {
  kind: "hostKeyMismatch" | "existingServer" | "iperf3Missing" | "serverUnavailable";
  title: string;
  message: string;
  detail?: string | null;
}

export interface SavedServer {
  id: string;
  host: string;
  sshPort: number;
  iperfPort: number;
  serverMode: ServerMode;
  username: string;
  password: string;
  authMethod: SshAuthMethod;
  privateKeyPath: string;
}

export interface SaveServerRequest {
  id?: string | null;
  host: string;
  sshPort: number;
  iperfPort: number;
  serverMode: ServerMode;
  username: string;
  password: string;
  authMethod: SshAuthMethod;
  privateKeyPath: string;
}
