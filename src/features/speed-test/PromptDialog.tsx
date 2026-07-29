import * as AlertDialog from "@radix-ui/react-alert-dialog";
import Check from "lucide-react/dist/esm/icons/check.js";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert.js";
import Copy from "lucide-react/dist/esm/icons/copy.js";
import PackageSearch from "lucide-react/dist/esm/icons/package-search.js";
import Server from "lucide-react/dist/esm/icons/server.js";
import ShieldAlert from "lucide-react/dist/esm/icons/shield-alert.js";
import type { TranslationKey } from "../../lib/i18n";
import type { SpeedPromptEvent } from "../../lib/types";

interface PromptDialogProps {
  prompt: SpeedPromptEvent | null;
  detailCopied: boolean;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  onConfirm: () => void;
  onReject: () => void;
  onCopyDetail: () => void;
}

export function PromptDialog({
  prompt,
  detailCopied,
  t,
  onConfirm,
  onReject,
  onCopyDetail
}: PromptDialogProps) {
  return (
    <AlertDialog.Root open={prompt != null}>
      {prompt && (
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="confirm-backdrop" />
          <AlertDialog.Content className={`confirm-dialog prompt-${prompt.kind}`}>
            <div className="confirm-icon">
              {prompt.kind === "hostKeyMismatch" || prompt.kind === "clientHostKeyMismatch" ? (
                <ShieldAlert size={21} />
              ) : prompt.kind === "iperf3Missing" || prompt.kind === "clientIperf3Missing" ? (
                <PackageSearch size={21} />
              ) : prompt.kind === "serverUnavailable" ? (
                <CircleAlert size={21} />
              ) : (
                <Server size={21} />
              )}
            </div>
            <AlertDialog.Title asChild>
              <h3>{prompt.title}</h3>
            </AlertDialog.Title>
            <AlertDialog.Description>{prompt.message}</AlertDialog.Description>
            {prompt.detail && <code>{prompt.detail}</code>}
            <div className="confirm-actions">
              {prompt.kind !== "serverUnavailable" && (
                <AlertDialog.Cancel asChild>
                  <button type="button" onClick={onReject}>
                    {prompt.kind === "iperf3Missing" || prompt.kind === "clientIperf3Missing"
                      ? t("later")
                      : t("cancel")}
                  </button>
                </AlertDialog.Cancel>
              )}
              {(prompt.kind === "iperf3Missing" || prompt.kind === "clientIperf3Missing") && prompt.detail && (
                <button type="button" onClick={onCopyDetail}>
                  {detailCopied ? <Check size={13} /> : <Copy size={13} />}
                  {detailCopied ? t("copied") : t("copyCommand")}
                </button>
              )}
              {prompt.kind === "serverUnavailable" ? (
                <AlertDialog.Cancel asChild>
                  <button type="button" className="confirm-primary" onClick={onReject} autoFocus>
                    {t("close")}
                  </button>
                </AlertDialog.Cancel>
              ) : (
                <AlertDialog.Action asChild>
                  <button type="button" className="confirm-primary" onClick={onConfirm} autoFocus>
                    {prompt.kind === "hostKeyMismatch" || prompt.kind === "clientHostKeyMismatch"
                      ? t("trustContinue")
                      : prompt.kind === "iperf3Missing" || prompt.kind === "clientIperf3Missing"
                        ? t("installedRetry")
                        : t("reuseContinue")}
                  </button>
                </AlertDialog.Action>
              )}
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      )}
    </AlertDialog.Root>
  );
}
