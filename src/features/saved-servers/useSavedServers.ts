import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  deleteSavedServer,
  getSavedServerPassword,
  listSavedServers,
  saveServer
} from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import type { SavedServer, SpeedStateEvent } from "../../lib/types";
import {
  buildSaveServerRequest,
  matchingSavedServer,
  savedServerToClientForm,
  savedServerToConnectionForm
} from "../speed-test/endpoint-model";
import {
  initialForm,
  initialRemoteClientForm,
  type ConnectionForm,
  type RemoteClientForm
} from "../speed-test/form-model";

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return fallback;
}

export function useSavedServers({
  form,
  setForm,
  setClientForm,
  setStatus,
  initialServers
}: {
  form: ConnectionForm;
  setForm: Dispatch<SetStateAction<ConnectionForm>>;
  setClientForm: Dispatch<SetStateAction<RemoteClientForm>>;
  setStatus: (status: SpeedStateEvent) => void;
  initialServers: SavedServer[];
}) {
  const { language, t } = useI18n();
  const [servers, setServers] = useState(initialServers);
  const [menuOpen, setMenuOpen] = useState(false);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [clientSavedId, setClientSavedId] = useState("");
  const [serverSavedId, setServerSavedId] = useState("");

  useEffect(() => {
    void listSavedServers(language)
      .then(setServers)
      .catch(() => undefined);
  }, [language]);

  useEffect(() => {
    if (menuOpen) return;
    setNoteEditorOpen(false);
    setNoteDraft("");
  }, [menuOpen]);

  const selectClient = async (id: string) => {
    setClientSavedId(id);
    if (!id || busy) return;
    const server = servers.find((candidate) => candidate.id === id);
    if (!server || server.serverMode !== "sshManaged") return;
    setBusy(true);
    try {
      const password = server.password || (await getSavedServerPassword(server.id, language));
      setServers((current) =>
        current.map((saved) => (saved.id === server.id ? { ...saved, password } : saved))
      );
      setClientForm(savedServerToClientForm(server, password, initialRemoteClientForm.privateKeyPath));
      setStatus({ phase: "idle", message: t("clientSelected", { name: server.note || server.host }) });
    } catch (error) {
      setStatus({ phase: "failed", message: errorMessage(error, t("savedActionError")) });
    } finally {
      setBusy(false);
    }
  };

  const selectServer = async (server: SavedServer) => {
    if (busy) return;
    setBusy(true);
    try {
      const password = server.serverMode === "sshManaged"
        ? server.password || (await getSavedServerPassword(server.id, language))
        : "";
      setServers((current) =>
        current.map((saved) => (saved.id === server.id ? { ...saved, password } : saved))
      );
      setForm((current) =>
        savedServerToConnectionForm(current, server, password, initialForm.privateKeyPath)
      );
      setServerSavedId(server.id);
      setMenuOpen(false);
      setStatus({ phase: "idle", message: t("serverLoaded", { host: server.host }) });
    } catch (error) {
      setStatus({ phase: "failed", message: errorMessage(error, t("savedActionError")) });
    } finally {
      setBusy(false);
    }
  };

  const selectServerById = async (id: string) => {
    setServerSavedId(id);
    if (!id || busy) return;
    const server = servers.find((candidate) => candidate.id === id);
    if (server) await selectServer(server);
  };

  const openNoteEditor = (canSave: boolean) => {
    if (!canSave || busy) return;
    const existing = matchingSavedServer(servers, form);
    setNoteDraft(existing?.note ?? "");
    setNoteEditorOpen(true);
  };

  const saveCurrent = async (canSave: boolean) => {
    if (!canSave || busy) return;
    const existing = matchingSavedServer(servers, form);
    setBusy(true);
    try {
      const saved = await saveServer(
        buildSaveServerRequest(form, noteDraft, existing?.id),
        language
      );
      setServers((current) => [saved, ...current.filter((server) => server.id !== saved.id)]);
      setNoteEditorOpen(false);
      setNoteDraft("");
      setStatus({ phase: "idle", message: t("serverSaved", { name: saved.note || saved.host }) });
    } catch (error) {
      setStatus({ phase: "failed", message: errorMessage(error, t("savedActionError")) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteSavedServer(id, language);
      setServers((current) => current.filter((server) => server.id !== id));
    } catch (error) {
      setStatus({ phase: "failed", message: errorMessage(error, t("savedActionError")) });
    } finally {
      setBusy(false);
    }
  };

  const swapSelectedIds = () => {
    setClientSavedId(serverSavedId);
    setServerSavedId(clientSavedId);
  };

  return {
    servers,
    menuOpen,
    setMenuOpen,
    noteEditorOpen,
    setNoteEditorOpen,
    noteDraft,
    setNoteDraft,
    busy,
    clientSavedId,
    serverSavedId,
    clearClientSelection: () => setClientSavedId(""),
    clearServerSelection: () => setServerSavedId(""),
    swapSelectedIds,
    selectClient,
    selectServer,
    selectServerById,
    openNoteEditor,
    saveCurrent,
    remove
  };
}
