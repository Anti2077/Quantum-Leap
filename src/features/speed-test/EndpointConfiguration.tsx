import ArrowRightLeft from "lucide-react/dist/esm/icons/arrow-right-left.js";
import BookMarked from "lucide-react/dist/esm/icons/book-marked.js";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert.js";
import { type ReactNode } from "react";
import { useI18n } from "../../lib/i18n";
import type { SavedServer } from "../../lib/types";

export function FieldLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="field-label">
      {icon}
      {children}
    </span>
  );
}

export function SavedEndpointSelect({
  value,
  servers,
  disabled,
  onChange
}: {
  value: string;
  servers: SavedServer[];
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <label>
      <FieldLabel icon={<BookMarked size={13} />}>{t("loadSavedDevice")}</FieldLabel>
      <select
        className="glass-input"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{t("enterManually")}</option>
        {servers.map((server) => (
          <option value={server.id} key={server.id}>
            {server.note ? `${server.note} · ${server.host}` : server.host}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TopologySelector({
  remoteToRemote,
  busy,
  onChange
}: {
  remoteToRemote: boolean;
  busy: boolean;
  onChange: (remoteToRemote: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="connection-fixed-top-controls">
      <div className="server-mode-label topology-mode-label">
        <span className="field-label">{t("topology")}</span>
        <span className="mode-help" tabIndex={0} aria-label={t("topologyHelp")}>
          <CircleAlert size={14} aria-hidden="true" />
          <span className="mode-tooltip" role="tooltip">
            <strong>{t("localTest")}</strong>
            <span>{t("localTestHelp")}</span>
            <strong>{t("remoteTest")}</strong>
            <span>{t("remoteTestHelp")}</span>
          </span>
        </span>
      </div>
      <div className="test-mode-tabs topology-tabs" aria-label={t("topology")}>
        <button
          type="button"
          className={!remoteToRemote ? "selected" : ""}
          disabled={busy}
          onClick={() => onChange(false)}
        >
          {t("localTest")}
        </button>
        <button
          type="button"
          className={remoteToRemote ? "selected" : ""}
          disabled={busy}
          onClick={() => onChange(true)}
        >
          {t("remoteTest")}
        </button>
      </div>
    </div>
  );
}

export function EndpointOverview({
  editor,
  clientHost,
  serverHost,
  sshManaged,
  busy,
  onEditorChange,
  onSwap
}: {
  editor: "client" | "server" | null;
  clientHost: string;
  serverHost: string;
  sshManaged: boolean;
  busy: boolean;
  onEditorChange: (editor: "client" | "server" | null) => void;
  onSwap: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="endpoint-overview" aria-label={t("dualDevices")}>
      <div className="endpoint-overview-row">
        <button
          type="button"
          className={`endpoint-summary-card ${editor === "client" ? "is-active" : ""}`}
          disabled={busy}
          onClick={() => onEditorChange(editor === "client" ? null : "client")}
          aria-label={t("editClient")}
          aria-expanded={editor === "client"}
        >
          <span className="endpoint-summary-copy">
            <span className="endpoint-summary-role">{t("initiator")}</span>
            <strong>{clientHost || t("ipNotConfigured")}</strong>
          </span>
        </button>
        <button
          type="button"
          className="endpoint-swap-button"
          onClick={onSwap}
          disabled={!sshManaged || busy}
          title={sshManaged ? t("swapEndpoints") : t("swapRequiresSsh")}
          aria-label={t("swapEndpoints")}
        >
          <ArrowRightLeft size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`endpoint-summary-card ${editor === "server" ? "is-active" : ""}`}
          disabled={busy}
          onClick={() => onEditorChange(editor === "server" ? null : "server")}
          aria-label={t("editServer")}
          aria-expanded={editor === "server"}
        >
          <span className="endpoint-summary-copy">
            <span className="endpoint-summary-role">{t("server")}</span>
            <strong>{serverHost || t("ipNotConfigured")}</strong>
          </span>
        </button>
      </div>
    </section>
  );
}
