import type { AppSettings } from "../shared/contracts";

export type SettingsEditorState = {
  settings: AppSettings | null;
  revision: number;
};

export type SettingsEditorAction =
  | { type: "load"; settings: AppSettings }
  | { type: "edit"; update: (settings: AppSettings) => AppSettings }
  | { type: "async-result"; settings: AppSettings; startedRevision: number }
  | { type: "async-google-result"; settings: AppSettings; startedRevision: number };

export const initialSettingsEditorState: SettingsEditorState = {
  settings: null,
  revision: 0
};

/** Keeps delayed IPC responses from replacing settings edited after an operation began. */
export function settingsEditorReducer(state: SettingsEditorState, action: SettingsEditorAction): SettingsEditorState {
  if (action.type === "load") {
    return { settings: action.settings, revision: state.revision + 1 };
  }

  if (action.type === "edit") {
    if (!state.settings) return state;
    return { settings: action.update(state.settings), revision: state.revision + 1 };
  }

  if (action.type === "async-result") {
    if (state.revision !== action.startedRevision) return state;
    return { settings: action.settings, revision: state.revision + 1 };
  }

  if (!state.settings) {
    return { settings: action.settings, revision: state.revision + 1 };
  }
  if (state.revision === action.startedRevision) {
    return { settings: action.settings, revision: state.revision + 1 };
  }

  // Connection/backup status must still arrive, but locally edited scheduling fields win over a stale response.
  return {
    settings: {
      ...state.settings,
      googleDrive: {
        ...state.settings.googleDrive,
        connected: action.settings.googleDrive.connected,
        accountEmail: action.settings.googleDrive.accountEmail,
        lastBackupAt: action.settings.googleDrive.lastBackupAt,
        lastBackupStatus: action.settings.googleDrive.lastBackupStatus
      }
    },
    revision: state.revision + 1
  };
}
