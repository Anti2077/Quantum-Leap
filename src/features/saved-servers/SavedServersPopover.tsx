import * as Popover from "@radix-ui/react-popover";
import { AnimatePresence, motion } from "framer-motion";
import BookMarked from "lucide-react/dist/esm/icons/book-marked.js";
import Check from "lucide-react/dist/esm/icons/check.js";
import Plus from "lucide-react/dist/esm/icons/plus.js";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.js";
import X from "lucide-react/dist/esm/icons/x.js";
import { useI18n } from "../../lib/i18n";
import type { SavedServer } from "../../lib/types";

export function SavedServersPopover({
  open,
  busy,
  savedBusy,
  canSaveCurrentServer,
  servers,
  currentHost,
  noteEditorOpen,
  noteDraft,
  onOpenChange,
  onOpenNoteEditor,
  onNoteDraftChange,
  onCloseNoteEditor,
  onSave,
  onSelect,
  onDelete
}: {
  open: boolean;
  busy: boolean;
  savedBusy: boolean;
  canSaveCurrentServer: boolean;
  servers: SavedServer[];
  currentHost: string;
  noteEditorOpen: boolean;
  noteDraft: string;
  onOpenChange: (open: boolean) => void;
  onOpenNoteEditor: () => void;
  onNoteDraftChange: (note: string) => void;
  onCloseNoteEditor: () => void;
  onSave: () => void;
  onSelect: (server: SavedServer) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <div className="saved-server-control">
        <Popover.Trigger asChild>
          <button
            type="button"
            className={open ? "saved-server-trigger active" : "saved-server-trigger"}
            disabled={busy}
            title={t("savedServers")}
          >
            <BookMarked size={15} aria-hidden="true" />
            {t("savedServers")}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="saved-server-menu"
            side="bottom"
            align="end"
            sideOffset={8}
            collisionPadding={12}
          >
            <div className="saved-menu-heading">
              <strong>{t("savedServers")}</strong>
              <button
                type="button"
                onClick={onOpenNoteEditor}
                disabled={!canSaveCurrentServer || savedBusy}
                aria-label={t("addCurrentServer")}
                title={t("addCurrentServer")}
              >
                <Plus size={14} />
              </button>
            </div>
            <AnimatePresence initial={false}>
              {noteEditorOpen && (
                <motion.form
                  className="saved-note-editor"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onSave();
                  }}
                  initial={{ opacity: 0, height: 0, y: -4 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -4 }}
                >
                  <span title={currentHost}>{currentHost}</span>
                  <div className="saved-note-row">
                    <input
                      autoFocus
                      value={noteDraft}
                      maxLength={48}
                      onChange={(event) => onNoteDraftChange(event.target.value)}
                      placeholder={t("optionalNote")}
                      aria-label={t("serverNote")}
                    />
                    <button type="submit" disabled={savedBusy} aria-label={t("save")} title={t("save")}>
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={onCloseNoteEditor}
                      aria-label={t("cancel")}
                      title={t("cancel")}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </motion.form>
              )}
            </AnimatePresence>
            <div className="saved-server-list">
              {servers.length === 0 ? (
                <span className="saved-empty">{t("noSavedServers")}</span>
              ) : (
                servers.map((server) => (
                  <div className="saved-server-item" key={server.id}>
                    <button type="button" onClick={() => onSelect(server)}>
                      <span className="saved-server-name">{server.note || server.host}</span>
                      {server.note && <small className="saved-server-address">{server.host}</small>}
                      <small className="saved-server-meta">
                        {server.serverMode === "sshManaged"
                          ? t("savedSshMeta", { username: server.username, port: server.sshPort })
                          : t("directShort", { port: server.iperfPort })}
                      </small>
                    </button>
                    <button
                      type="button"
                      className="delete-saved"
                      onClick={() => onDelete(server.id)}
                      aria-label={t("deleteServer", { host: server.host })}
                      title={t("delete")}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </div>
    </Popover.Root>
  );
}
