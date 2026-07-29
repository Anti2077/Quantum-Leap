import type {
  SpeedPromptEvent,
  SpeedTestRequest,
  ServerMode,
  SshAuthMethod,
  TestMode,
  TestTopology,
  TransferDirection,
  TransportProtocol
} from "../../lib/types";

export interface ConnectionForm {
  testTopology: TestTopology;
  host: string;
  sshPort: string;
  iperfPort: string;
  remoteIperfPath: string;
  localBindIp: string;
  serverBindIp: string;
  serverMode: ServerMode;
  username: string;
  password: string;
  authMethod: SshAuthMethod;
  privateKeyPath: string;
  passphrase: string;
  testMode: TestMode;
  direction: TransferDirection;
  protocol: TransportProtocol;
  parallelStreams: string;
  durationSeconds: string;
  rateLimitEnabled: boolean;
  targetBitrateMbps: string;
}

export interface RemoteClientForm {
  host: string;
  sshPort: string;
  remoteIperfPath: string;
  bindIp: string;
  username: string;
  password: string;
  authMethod: SshAuthMethod;
  privateKeyPath: string;
  passphrase: string;
}

export const initialForm: ConnectionForm = {
  testTopology: "localToRemote",
  host: "",
  sshPort: "22",
  iperfPort: "5201",
  remoteIperfPath: "",
  localBindIp: "",
  serverBindIp: "",
  serverMode: "sshManaged",
  username: "",
  password: "",
  authMethod: "password",
  privateKeyPath: "~/.ssh/id_ed25519",
  passphrase: "",
  testMode: "standard",
  direction: "upload",
  protocol: "tcp",
  parallelStreams: "8",
  durationSeconds: "10",
  rateLimitEnabled: false,
  targetBitrateMbps: "100"
};

export const initialRemoteClientForm: RemoteClientForm = {
  host: "",
  sshPort: "22",
  remoteIperfPath: "",
  bindIp: "",
  username: "",
  password: "",
  authMethod: "password",
  privateKeyPath: "~/.ssh/id_ed25519",
  passphrase: ""
};

export const STANDARD_DURATION_SECONDS = 10;
export const STANDARD_PARALLEL_STREAMS = 8;

export interface DerivedTestConfiguration {
  standard: boolean;
  remoteToRemote: boolean;
  sshManaged: boolean;
  duration: number;
  continuous: boolean;
  parallelStreams: number;
  protocol: TransportProtocol;
  rateLimitValid: boolean;
  targetBitrateBps: number;
  remoteIperfPath: string;
  clientRemoteIperfPath: string;
  localBindIp: string;
  serverBindIp: string;
  clientBindIp: string;
  remoteIperfPathInvalid: boolean;
  clientRemoteIperfPathInvalid: boolean;
  localBindIpInvalid: boolean;
  serverBindIpInvalid: boolean;
  clientBindIpInvalid: boolean;
  clientValid: boolean;
  valid: boolean;
  canSaveCurrentServer: boolean;
}

export function isValidIpLiteral(value: string): boolean {
  const address = value.trim();
  if (!address) return true;
  const ipv4 = address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    return ipv4
      .slice(1)
      .every((octet) => (octet === "0" || !octet.startsWith("0")) && Number(octet) <= 255);
  }
  if (!address.includes(":") || address.includes("%") || /[\s/]/.test(address)) return false;
  try {
    return new URL(`http://[${address}]/`).hostname.length > 0;
  } catch {
    return false;
  }
}

export function deriveTestConfiguration(
  form: ConnectionForm,
  clientForm: RemoteClientForm
): DerivedTestConfiguration {
  const standard = form.testMode === "standard";
  const remoteToRemote = form.testTopology === "remoteToRemote";
  const sshManaged = form.serverMode === "sshManaged";
  const requestedDuration = form.durationSeconds.trim() === "" ? Number.NaN : Number(form.durationSeconds);
  const duration = standard
    ? STANDARD_DURATION_SECONDS
    : Number.isFinite(requestedDuration)
      ? requestedDuration
      : 10;
  const continuous = !standard && duration === 0;
  const parallelStreams = standard ? STANDARD_PARALLEL_STREAMS : Number(form.parallelStreams) || 1;
  const protocol: TransportProtocol = standard ? "tcp" : form.protocol;
  const requestedTargetRate = Number(form.targetBitrateMbps);
  const rateLimitValid =
    !form.rateLimitEnabled ||
    (Number.isFinite(requestedTargetRate) && requestedTargetRate >= 0.1 && requestedTargetRate <= 100000);
  const targetBitrateBps = form.rateLimitEnabled && rateLimitValid
    ? Math.round(requestedTargetRate * 1_000_000)
    : 0;
  const remoteIperfPath = form.remoteIperfPath.trim();
  const clientRemoteIperfPath = clientForm.remoteIperfPath.trim();
  const localBindIp = form.localBindIp.trim();
  const serverBindIp = form.serverBindIp.trim();
  const clientBindIp = clientForm.bindIp.trim();
  const remoteIperfPathInvalid = sshManaged && remoteIperfPath.length > 0 && !remoteIperfPath.startsWith("/");
  const clientRemoteIperfPathInvalid =
    remoteToRemote && clientRemoteIperfPath.length > 0 && !clientRemoteIperfPath.startsWith("/");
  const localBindIpInvalid = !remoteToRemote && !isValidIpLiteral(localBindIp);
  const serverBindIpInvalid = sshManaged && !isValidIpLiteral(serverBindIp);
  const clientBindIpInvalid = remoteToRemote && !isValidIpLiteral(clientBindIp);
  const clientValid =
    !remoteToRemote ||
    (clientForm.host.trim().length > 0 &&
      Number(clientForm.sshPort) > 0 &&
      clientForm.username.trim().length > 0 &&
      !clientRemoteIperfPathInvalid &&
      !clientBindIpInvalid &&
      (clientForm.authMethod === "privateKey"
        ? clientForm.privateKeyPath.trim().length > 0
        : clientForm.password.length > 0));
  const valid =
    form.host.trim().length > 0 &&
    Number(form.iperfPort) > 0 &&
    !remoteIperfPathInvalid &&
    !localBindIpInvalid &&
    !serverBindIpInvalid &&
    rateLimitValid &&
    clientValid &&
    (!sshManaged ||
      (form.username.trim().length > 0 &&
        (form.authMethod === "privateKey"
          ? form.privateKeyPath.trim().length > 0
          : form.password.length > 0) &&
        Number(form.sshPort) > 0)) &&
    (standard ||
      ((duration === 0 || (duration >= 3 && duration <= 120)) &&
        parallelStreams >= 1 &&
        parallelStreams <= 32));
  const canSaveCurrentServer =
    form.host.trim().length > 0 &&
    !remoteIperfPathInvalid &&
    !serverBindIpInvalid &&
    (!sshManaged ||
      (form.username.trim().length > 0 &&
        (form.authMethod === "privateKey"
          ? form.privateKeyPath.trim().length > 0
          : form.password.length > 0)));

  return {
    standard,
    remoteToRemote,
    sshManaged,
    duration,
    continuous,
    parallelStreams,
    protocol,
    rateLimitValid,
    targetBitrateBps,
    remoteIperfPath,
    clientRemoteIperfPath,
    localBindIp,
    serverBindIp,
    clientBindIp,
    remoteIperfPathInvalid,
    clientRemoteIperfPathInvalid,
    localBindIpInvalid,
    serverBindIpInvalid,
    clientBindIpInvalid,
    clientValid,
    valid,
    canSaveCurrentServer
  };
}

export function buildSpeedTestRequest(
  language: SpeedTestRequest["language"],
  form: ConnectionForm,
  clientForm: RemoteClientForm,
  derived = deriveTestConfiguration(form, clientForm)
): SpeedTestRequest {
  return {
    language,
    host: form.host.trim(),
    sshPort: Number(form.sshPort),
    iperfPort: Number(form.iperfPort),
    remoteIperfPath: derived.remoteIperfPath,
    localBindIp: derived.remoteToRemote ? "" : derived.localBindIp,
    serverBindIp: derived.sshManaged ? derived.serverBindIp : "",
    serverMode: form.serverMode,
    username: form.username.trim(),
    password: form.password,
    authMethod: form.authMethod,
    privateKeyPath: form.privateKeyPath.trim(),
    passphrase: form.passphrase,
    testMode: form.testMode,
    direction: form.direction,
    protocol: derived.protocol,
    parallelStreams: derived.parallelStreams,
    durationSeconds: derived.duration,
    targetBitrateBps: derived.targetBitrateBps,
    reuseExistingServer: false,
    allowHostKeyMismatch: false,
    testTopology: form.testTopology,
    remoteClient: derived.remoteToRemote
      ? {
          host: clientForm.host.trim(),
          sshPort: Number(clientForm.sshPort),
          remoteIperfPath: derived.clientRemoteIperfPath,
          bindIp: derived.clientBindIp,
          username: clientForm.username.trim(),
          password: clientForm.password,
          authMethod: clientForm.authMethod,
          privateKeyPath: clientForm.privateKeyPath.trim(),
          passphrase: clientForm.passphrase,
          allowHostKeyMismatch: false
        }
      : null
  };
}

export function confirmSpeedTestRequest(
  request: SpeedTestRequest,
  promptKind: SpeedPromptEvent["kind"]
): SpeedTestRequest {
  return {
    ...request,
    reuseExistingServer: request.reuseExistingServer || promptKind === "existingServer",
    allowHostKeyMismatch: request.allowHostKeyMismatch || promptKind === "hostKeyMismatch",
    remoteClient:
      request.remoteClient && promptKind === "clientHostKeyMismatch"
        ? { ...request.remoteClient, allowHostKeyMismatch: true }
        : request.remoteClient
  };
}
