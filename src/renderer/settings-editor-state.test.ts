import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_APP_SETTINGS } from "../shared/default-settings";
import { initialSettingsEditorState, settingsEditorReducer } from "./settings-editor-state";

describe("settings editor state", () => {
  it("does not disable any rendered input, select, or textarea control", () => {
    const rendererDir = fileURLToPath(new URL(".", import.meta.url));
    const files = readdirSync(rendererDir, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(".tsx"));
    const disabledControls = files.flatMap((file) => {
      const source = readFileSync(resolve(rendererDir, file), "utf8");
      return Array.from(source.matchAll(/<(input|select|textarea)\b[^>]*\bdisabled\s*=/gs), (match) => `${file}: ${match[0]}`);
    });

    expect(disabledControls).toEqual([]);
  });

  it("ignores an outdated save response after a newer field edit", () => {
    const loaded = settingsEditorReducer(initialSettingsEditorState, { type: "load", settings: DEFAULT_APP_SETTINGS });
    const startedRevision = loaded.revision;
    const edited = settingsEditorReducer(loaded, {
      type: "edit",
      update: (settings) => ({ ...settings, printerMode: "windows", shopName: "Newest name" })
    });
    const staleResponse = { ...DEFAULT_APP_SETTINGS, shopName: "Old name", printerMode: "xprinter" as const };

    const result = settingsEditorReducer(edited, { type: "async-result", settings: staleResponse, startedRevision });

    expect(result).toBe(edited);
    expect(result.settings?.printerMode).toBe("windows");
    expect(result.settings?.shopName).toBe("Newest name");
  });

  it("applies an async response when no newer edit exists", () => {
    const loaded = settingsEditorReducer(initialSettingsEditorState, { type: "load", settings: DEFAULT_APP_SETTINGS });
    const saved = { ...DEFAULT_APP_SETTINGS, shopName: "Saved shop" };

    const result = settingsEditorReducer(loaded, { type: "async-result", settings: saved, startedRevision: loaded.revision });

    expect(result.settings?.shopName).toBe("Saved shop");
    expect(result.revision).toBe(loaded.revision + 1);
  });

  it("merges delayed Google status without reverting newer scheduling edits", () => {
    const connected = {
      ...DEFAULT_APP_SETTINGS,
      googleDrive: { ...DEFAULT_APP_SETTINGS.googleDrive, connected: true, accountEmail: "shop@example.com" }
    };
    const loaded = settingsEditorReducer(initialSettingsEditorState, { type: "load", settings: connected });
    const startedRevision = loaded.revision;
    const edited = settingsEditorReducer(loaded, {
      type: "edit",
      update: (settings) => ({
        ...settings,
        googleDrive: { ...settings.googleDrive, autoBackupEnabled: true, backupTime: "23:30" }
      })
    });
    const delayed = {
      ...connected,
      googleDrive: { ...connected.googleDrive, lastBackupAt: "2026-08-30T10:00:00.000Z", lastBackupStatus: "Success" }
    };

    const result = settingsEditorReducer(edited, { type: "async-google-result", settings: delayed, startedRevision });

    expect(result.settings?.googleDrive.autoBackupEnabled).toBe(true);
    expect(result.settings?.googleDrive.backupTime).toBe("23:30");
    expect(result.settings?.googleDrive.lastBackupStatus).toBe("Success");
  });
});
