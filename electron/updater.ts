import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { autoUpdater } from "electron-updater";
import type { AppUpdateState } from "../src/shared/contracts.js";

const STARTUP_CHECK_DELAY_MS = 10_000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

function updaterMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ERR_INTERNET_DISCONNECTED|net::/i.test(message)) {
    return "TruePOS could not check for updates. Check the internet connection and try again.";
  }
  if (/404|latest\.yml|Cannot find channel/i.test(message)) {
    return "Update information is not available on GitHub yet. Please try again later.";
  }
  return "TruePOS could not complete the update check. Please try again later.";
}

class UpdateFileLogger {
  private write(level: string, message?: unknown) {
    try {
      const logPath = path.join(app.getPath("logs"), "truepos-updates.log");
      const text = message instanceof Error ? message.stack ?? message.message : String(message ?? "");
      fs.appendFileSync(logPath, `${new Date().toISOString()} [${level}] ${text}\n`, "utf8");
    } catch {
      // Update logging must never interrupt the update itself.
    }
  }

  info(message?: unknown) {
    this.write("INFO", message);
  }

  warn(message?: unknown) {
    this.write("WARN", message);
  }

  error(message?: unknown) {
    this.write("ERROR", message);
  }
}

export class TruePOSUpdater {
  private window: BrowserWindow | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private state: AppUpdateState = {
    status: app.isPackaged ? "idle" : "disabled",
    currentVersion: app.getVersion(),
    availableVersion: "",
    percent: 0,
    message: app.isPackaged ? "TruePOS checks GitHub automatically for new releases." : "Updates are available in installed builds of TruePOS.",
    checkedAt: ""
  };

  constructor() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.autoRunAppAfterInstall = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.logger = new UpdateFileLogger();

    autoUpdater.on("checking-for-update", () => {
      this.updateState({ status: "checking", percent: 0, message: "Checking GitHub for the latest TruePOS release..." });
    });
    autoUpdater.on("update-available", (info) => {
      this.updateState({
        status: "available",
        availableVersion: info.version,
        percent: 0,
        checkedAt: new Date().toISOString(),
        message: `TruePOS ${info.version} is available.`
      });
    });
    autoUpdater.on("update-not-available", () => {
      this.updateState({
        status: "up-to-date",
        availableVersion: "",
        percent: 0,
        checkedAt: new Date().toISOString(),
        message: "TruePOS is up to date."
      });
    });
    autoUpdater.on("download-progress", (progress) => {
      this.updateState({
        status: "downloading",
        percent: Math.max(0, Math.min(100, progress.percent)),
        message: `Downloading update: ${Math.round(progress.percent)}%`
      });
    });
    autoUpdater.on("update-downloaded", (info) => {
      this.updateState({
        status: "downloaded",
        availableVersion: info.version,
        percent: 100,
        message: "The update is ready. Restart TruePOS to finish installing it."
      });
    });
    autoUpdater.on("update-cancelled", () => {
      this.updateState({ status: "available", percent: 0, message: "The update download was cancelled." });
    });
    autoUpdater.on("error", (error) => {
      this.updateState({ status: "error", percent: 0, checkedAt: new Date().toISOString(), message: updaterMessage(error) });
    });
  }

  start(window: BrowserWindow) {
    this.window = window;
    if (!app.isPackaged) {
      this.broadcast();
      return;
    }
    this.startupTimer = setTimeout(() => void this.check(), STARTUP_CHECK_DELAY_MS);
    this.startupTimer.unref();
    this.intervalTimer = setInterval(() => void this.check(), UPDATE_CHECK_INTERVAL_MS);
    this.intervalTimer.unref();
  }

  stop() {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.startupTimer = null;
    this.intervalTimer = null;
    this.window = null;
  }

  getState() {
    return { ...this.state };
  }

  async check() {
    if (!app.isPackaged) return this.getState();
    if (this.state.status === "checking" || this.state.status === "downloading" || this.state.status === "downloaded") return this.getState();
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.updateState({ status: "error", percent: 0, checkedAt: new Date().toISOString(), message: updaterMessage(error) });
    }
    return this.getState();
  }

  async download() {
    if (!app.isPackaged) return this.getState();
    if (this.state.status !== "available") throw new Error("No TruePOS update is currently available to download.");
    this.updateState({ status: "downloading", percent: 0, message: "Starting the update download..." });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      this.updateState({ status: "error", percent: 0, message: updaterMessage(error) });
    }
    return this.getState();
  }

  install() {
    if (this.state.status !== "downloaded") throw new Error("The update has not finished downloading yet.");
    autoUpdater.quitAndInstall(true, true);
  }

  private updateState(next: Partial<AppUpdateState>) {
    this.state = { ...this.state, ...next };
    this.broadcast();
  }

  private broadcast() {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send("updates:stateChanged", this.getState());
  }
}
