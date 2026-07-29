import type { SavedServer, SaveServerRequest } from "../../lib/types";
import type { ConnectionForm, RemoteClientForm } from "./form-model";

export function savedServerToClientForm(
  server: SavedServer,
  secret: string,
  fallbackPrivateKeyPath: string
): RemoteClientForm {
  return {
    host: server.host,
    sshPort: server.sshPort.toString(),
    remoteIperfPath: server.remoteIperfPath || "",
    bindIp: server.bindIp || "",
    username: server.username,
    password: secret,
    authMethod: server.authMethod,
    privateKeyPath: server.privateKeyPath || fallbackPrivateKeyPath,
    passphrase: server.authMethod === "privateKey" ? secret : ""
  };
}

export function savedServerToConnectionForm(
  current: ConnectionForm,
  server: SavedServer,
  secret: string,
  fallbackPrivateKeyPath: string
): ConnectionForm {
  return {
    ...current,
    host: server.host,
    sshPort: server.sshPort.toString(),
    iperfPort: server.iperfPort.toString(),
    remoteIperfPath: server.remoteIperfPath || "",
    serverBindIp: server.bindIp || "",
    serverMode: server.serverMode,
    username: server.username,
    password: secret,
    authMethod: server.authMethod,
    privateKeyPath: server.privateKeyPath || fallbackPrivateKeyPath,
    passphrase: server.authMethod === "privateKey" ? secret : ""
  };
}

export function swapRemoteEndpointForms(
  server: ConnectionForm,
  client: RemoteClientForm
): { server: ConnectionForm; client: RemoteClientForm } {
  return {
    server: {
      ...server,
      host: client.host,
      sshPort: client.sshPort,
      remoteIperfPath: client.remoteIperfPath,
      serverBindIp: client.bindIp,
      username: client.username,
      password: client.password,
      authMethod: client.authMethod,
      privateKeyPath: client.privateKeyPath,
      passphrase: client.passphrase
    },
    client: {
      host: server.host,
      sshPort: server.sshPort,
      remoteIperfPath: server.remoteIperfPath,
      bindIp: server.serverBindIp,
      username: server.username,
      password: server.password,
      authMethod: server.authMethod,
      privateKeyPath: server.privateKeyPath,
      passphrase: server.passphrase
    }
  };
}

export function matchingSavedServer(
  servers: SavedServer[],
  form: ConnectionForm
): SavedServer | undefined {
  return servers.find(
    (server) =>
      server.host === form.host.trim() &&
      server.sshPort === Number(form.sshPort) &&
      server.username === form.username.trim() &&
      server.serverMode === form.serverMode
  );
}

export function buildSaveServerRequest(
  form: ConnectionForm,
  note: string,
  existingId: string | undefined
): SaveServerRequest {
  return {
    id: existingId,
    note: note.trim(),
    host: form.host.trim(),
    sshPort: Number(form.sshPort),
    iperfPort: Number(form.iperfPort),
    remoteIperfPath: form.remoteIperfPath.trim(),
    bindIp: form.serverMode === "sshManaged" ? form.serverBindIp.trim() : "",
    serverMode: form.serverMode,
    username: form.username.trim(),
    password: form.authMethod === "privateKey" ? form.passphrase : form.password,
    authMethod: form.authMethod,
    privateKeyPath: form.privateKeyPath.trim()
  };
}
