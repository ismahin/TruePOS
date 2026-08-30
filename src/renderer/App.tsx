import { AlertTriangle, BarChart3, Bell, Boxes, LogOut, PackagePlus, Settings, ShoppingCart, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { AppUpdateState, User } from "../shared/contracts";
import logoUrl from "./assets/truepos-logo-v4.png";
import { api } from "./api";
import { errorDialogTitle, friendlyErrorMessage, isUserCancellation, type Notify } from "./errors";
import { BillingScreen } from "./screens/BillingScreen";
import { InventoryScreen } from "./screens/InventoryScreen";
import { ProductsScreen } from "./screens/ProductsScreen";
import { ReportsScreen } from "./screens/ReportsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

type Screen = "billing" | "products" | "inventory" | "reports" | "settings";
const UPDATE_SEEN_VERSION_KEY = "truepos-update-seen-version";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const [screen, setScreen] = useState<Screen>("billing");
  const [toast, setToast] = useState<{ message: string; kind: "success" | "warning" } | null>(null);
  const [errorDialog, setErrorDialog] = useState<{ title: string; message: string } | null>(null);
  const [updateState, setUpdateState] = useState<AppUpdateState | null>(null);
  const [seenUpdateVersion, setSeenUpdateVersion] = useState(() => window.localStorage.getItem(UPDATE_SEEN_VERSION_KEY) ?? "");
  const [stockAlertCount, setStockAlertCount] = useState(0);
  const stockAlertNotifiedRef = useRef(false);

  useEffect(() => {
    Promise.all([api.auth.isSetupRequired(), api.auth.getCurrentUser()])
      .then(([required, currentUser]) => {
        setSetupRequired(required);
        setUser(currentUser);
      })
      .catch((err) => {
        setSetupRequired(false);
        setUser(null);
        const message = friendlyErrorMessage(err, "TruePOS could not finish starting. Close and reopen the application, then try again.");
        setErrorDialog({ title: "Startup problem", message });
      });
  }, []);

  useEffect(() => {
    let active = true;
    const unsubscribe = api.updates.onStateChanged((state) => {
      if (active) setUpdateState(state);
    });
    api.updates.getState().then((state) => {
      if (active) setUpdateState(state);
    }).catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const hasAvailableUpdate = Boolean(
    updateState?.availableVersion && ["available", "downloading", "downloaded"].includes(updateState.status)
  );

  useEffect(() => {
    if (screen !== "settings" || !hasAvailableUpdate || !updateState?.availableVersion) return;
    window.localStorage.setItem(UPDATE_SEEN_VERSION_KEY, updateState.availableVersion);
    setSeenUpdateVersion(updateState.availableVersion);
  }, [hasAvailableUpdate, screen, updateState?.availableVersion]);

  const showUpdateNotice = hasAvailableUpdate && seenUpdateVersion !== updateState?.availableVersion;

  const notify: Notify = useCallback((message, kind = "success") => {
    if (kind === "error") {
      if (isUserCancellation(message)) return;
      setToast(null);
      setErrorDialog({ title: errorDialogTitle(message), message });
      return;
    }
    setToast({ message, kind: kind === "warning" ? "warning" : "success" });
    window.setTimeout(() => setToast(null), kind === "warning" ? 6000 : 3500);
  }, []);

  useEffect(() => {
    if (!user) {
      setStockAlertCount(0);
      stockAlertNotifiedRef.current = false;
      return;
    }
    let active = true;
    api.reports
      .getInventoryValue()
      .then((report) => {
        if (!active) return;
        setStockAlertCount(report.lowStockCount);
        if (report.lowStockCount > 0 && !stockAlertNotifiedRef.current) {
          stockAlertNotifiedRef.current = true;
          const label = report.lowStockCount === 1 ? "1 product needs reorder attention" : `${report.lowStockCount} products need reorder attention`;
          notify(`${label}. Open Inventory to restock.`, "warning");
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [user, screen, notify]);

  useEffect(() => {
    const handleUnexpectedError = (event: ErrorEvent) => {
      event.preventDefault();
      const message = friendlyErrorMessage(event.error ?? event.message, "An unexpected error occurred. Please try the action again.");
      // Prefer a non-blocking toast so background faults do not freeze form inputs.
      notify(message, "warning");
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      if (isUserCancellation(event.reason)) return;
      const message = friendlyErrorMessage(event.reason, "The action could not be completed. Please try again.");
      notify(message, "warning");
    };
    window.addEventListener("error", handleUnexpectedError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("error", handleUnexpectedError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, [notify]);

  if (setupRequired === null) return null;
  if (setupRequired) {
    return (
      <>
        <FirstRunSetup
          onComplete={(createdUser) => {
            setSetupRequired(false);
            setUser(createdUser);
          }}
        />
        {errorDialog && <ErrorModal title={errorDialog.title} message={errorDialog.message} onClose={() => setErrorDialog(null)} />}
      </>
    );
  }
  if (!user) return (
    <>
      <Login onLogin={setUser} onResetAll={() => setSetupRequired(true)} />
      {errorDialog && <ErrorModal title={errorDialog.title} message={errorDialog.message} onClose={() => setErrorDialog(null)} />}
    </>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src={logoUrl} alt="TruePOS" />
          <span>powered by BUBT Innovation Hub</span>
        </div>
        <nav>
          <NavButton active={screen === "billing"} icon={<ShoppingCart />} label="Checkout" onClick={() => setScreen("billing")} />
          <NavButton active={screen === "products"} icon={<PackagePlus />} label="Products" onClick={() => setScreen("products")} />
          <NavButton active={screen === "inventory"} icon={<Boxes />} label="Inventory" stockAlert={stockAlertCount} onClick={() => setScreen("inventory")} />
          <NavButton active={screen === "reports"} icon={<BarChart3 />} label="Reports" onClick={() => setScreen("reports")} />
          <NavButton active={screen === "settings"} icon={<Settings />} label="Settings" notice={showUpdateNotice} onClick={() => setScreen("settings")} />
        </nav>
        <div className="user-card">
          <span>{user.username}</span>
          <small>{user.role}</small>
          <button
            className="icon-text"
            onClick={async () => {
              await api.auth.logout();
              setUser(null);
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>
      <main className="workspace">
        <div className={screen === "billing" ? "workspace-panel" : "workspace-panel is-hidden"} hidden={screen !== "billing"}>
          <BillingScreen notify={notify} active={screen === "billing"} />
        </div>
        {screen === "products" && <ProductsScreen user={user} notify={notify} />}
        {screen === "inventory" && <InventoryScreen user={user} notify={notify} />}
        {screen === "reports" && <ReportsScreen user={user} notify={notify} />}
        {screen === "settings" && (
          <SettingsScreen
            user={user}
            notify={notify}
            updateState={updateState}
            onFactoryReset={() => {
              setUser(null);
              setSetupRequired(true);
              setScreen("billing");
            }}
          />
        )}
      </main>
      {toast && <div className={`toast ${toast.kind === "warning" ? "toast-warning" : ""}`}>{toast.message}</div>}
      {errorDialog && <ErrorModal title={errorDialog.title} message={errorDialog.message} onClose={() => setErrorDialog(null)} />}
    </div>
  );
}

function ErrorModal({ title, message, onClose }: { title: string; message: string; onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop error-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="error-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="error-modal">
        <div className="error-modal-heading">
          <div className="error-modal-icon"><AlertTriangle size={24} /></div>
          <div>
            <h2 id="error-modal-title">{title}</h2>
            <p>{message}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close error message"><X size={20} /></button>
        </div>
        <div className="error-modal-actions">
          <button ref={closeButtonRef} className="primary" type="button" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
}

function Login({ onLogin, onResetAll }: { onLogin: (user: User) => void; onResetAll: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [resetMode, setResetMode] = useState(false);
  const [notice, setNotice] = useState("");
  const [resettingAll, setResettingAll] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      onLogin(await api.auth.login(username, password));
    } catch (err) {
      setError(friendlyErrorMessage(err, "Sign in failed. Check the username and password, then try again."));
    }
  }

  async function resetAllPasswords() {
    const confirmed = window.confirm(
      "Reset every TruePOS login account?\n\nYou will create a new admin login. Products, inventory, sales, reports, settings, and backups will remain unchanged."
    );
    if (!confirmed) return;
    const finalConfirmed = window.confirm(
      "Anyone with access to this computer can use this recovery action. Remove all existing admin and cashier passwords now?"
    );
    if (!finalConfirmed) return;

    setError("");
    setResettingAll(true);
    try {
      await api.auth.resetAllLoginCredentials();
      onResetAll();
    } catch (err) {
      setError(friendlyErrorMessage(err, "Login accounts could not be reset. Close and reopen TruePOS, then try again."));
    } finally {
      setResettingAll(false);
    }
  }

  if (resetMode) {
    return (
      <ResetLoginInfo
        onCancel={() => setResetMode(false)}
        onComplete={(nextUsername) => {
          setUsername(nextUsername);
          setPassword("");
          setNotice("Login information updated. Use the new credentials to sign in.");
          setResetMode(false);
        }}
      />
    );
  }

  return (
    <div className="login-page">
      <form className="login-panel" onSubmit={submit}>
        <img className="login-logo" src={logoUrl} alt="TruePOS" />
        <p>Secure offline point of sale</p>
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus />
        </label>
        <label>
          Password
          <input value={password} type="password" onChange={(event) => setPassword(event.target.value)} />
        </label>
        {notice && <div className="notice neutral">{notice}</div>}
        <button className="primary" type="submit">
          Sign in
        </button>
        <button className="secondary" type="button" onClick={() => setResetMode(true)}>
          Reset login
        </button>
        <button className="danger" type="button" disabled={resettingAll} onClick={() => void resetAllPasswords()}>
          {resettingAll ? "Resetting all passwords..." : "Forgot passwords? Reset all logins"}
        </button>
      </form>
      {error && <ErrorModal title="Sign-in problem" message={error} onClose={() => setError("")} />}
    </div>
  );
}

function ResetLoginInfo({ onCancel, onComplete }: { onCancel: () => void; onComplete: (adminUsername: string) => void }) {
  const [currentAdminUsername, setCurrentAdminUsername] = useState("admin");
  const [currentAdminPassword, setCurrentAdminPassword] = useState("");
  const [adminUsername, setAdminUsername] = useState("admin");
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmAdminPassword, setConfirmAdminPassword] = useState("");
  const [resetCashier, setResetCashier] = useState(true);
  const [cashierUsername, setCashierUsername] = useState("cashier");
  const [cashierPassword, setCashierPassword] = useState("");
  const [confirmCashierPassword, setConfirmCashierPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (adminPassword !== confirmAdminPassword) {
      setError("Admin passwords do not match.");
      return;
    }
    if (resetCashier && cashierPassword !== confirmCashierPassword) {
      setError("Cashier passwords do not match.");
      return;
    }
    if (!confirmed) {
      setError("Confirm that only login information will be changed.");
      return;
    }
    try {
      const result = await api.auth.resetLoginCredentials(
        { username: currentAdminUsername, password: currentAdminPassword },
        { username: adminUsername, password: adminPassword },
        resetCashier ? { username: cashierUsername, password: cashierPassword } : undefined
      );
      onComplete(result.adminUsername);
    } catch (err) {
      setError(friendlyErrorMessage(err, "Login information could not be reset. Check the details and try again."));
    }
  }

  return (
    <div className="login-page">
      <form className="login-panel setup-panel" onSubmit={submit}>
        <img className="login-logo" src={logoUrl} alt="TruePOS" />
        <h2>Reset Login Information</h2>
        <p>Verify the current admin, then choose the new login details. Products, sales, inventory, reports, settings, and backups remain unchanged.</p>
        <label>
          Current admin username
          <input value={currentAdminUsername} onChange={(event) => setCurrentAdminUsername(event.target.value)} autoFocus />
        </label>
        <label>
          Current admin password
          <input value={currentAdminPassword} type="password" onChange={(event) => setCurrentAdminPassword(event.target.value)} />
        </label>
        <label>
          New admin username
          <input value={adminUsername} onChange={(event) => setAdminUsername(event.target.value)} />
        </label>
        <label>
          New admin password
          <input value={adminPassword} type="password" onChange={(event) => setAdminPassword(event.target.value)} />
        </label>
        <label>
          Confirm admin password
          <input value={confirmAdminPassword} type="password" onChange={(event) => setConfirmAdminPassword(event.target.value)} />
        </label>
        <label className="checkbox setup-checkbox">
          <input type="checkbox" checked={resetCashier} onChange={(event) => setResetCashier(event.target.checked)} />
          Reset cashier login too
        </label>
        {resetCashier && (
          <div className="setup-cashier-fields">
            <label>
              New cashier username
              <input value={cashierUsername} onChange={(event) => setCashierUsername(event.target.value)} />
            </label>
            <label>
              New cashier password
              <input value={cashierPassword} type="password" onChange={(event) => setCashierPassword(event.target.value)} />
            </label>
            <label>
              Confirm cashier password
              <input value={confirmCashierPassword} type="password" onChange={(event) => setConfirmCashierPassword(event.target.value)} />
            </label>
          </div>
        )}
        <label className="checkbox">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          I understand this only changes login information
        </label>
        <button className="primary" type="submit">
          Save Login Information
        </button>
        <button className="secondary" type="button" onClick={onCancel}>
          Back to Login
        </button>
      </form>
      {error && <ErrorModal title="Login reset problem" message={error} onClose={() => setError("")} />}
    </div>
  );
}

function FirstRunSetup({ onComplete }: { onComplete: (user: User) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [createCashier, setCreateCashier] = useState(true);
  const [cashierUsername, setCashierUsername] = useState("cashier");
  const [cashierPassword, setCashierPassword] = useState("");
  const [confirmCashierPassword, setConfirmCashierPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (createCashier && cashierPassword !== confirmCashierPassword) {
      setError("Cashier passwords do not match.");
      return;
    }
    try {
      onComplete(
        await api.auth.setupInitialAdmin(
          username,
          password,
          createCashier ? { username: cashierUsername, password: cashierPassword } : undefined
        )
      );
    } catch (err) {
      setError(friendlyErrorMessage(err, "Setup could not be completed. Check the information and try again."));
    }
  }

  return (
    <div className="login-page">
      <form className="login-panel setup-panel" onSubmit={submit}>
        <img className="login-logo" src={logoUrl} alt="TruePOS" />
        <h2>Create Users</h2>
        <p>Set the admin login for this TruePOS installation.</p>
        <label>
          Admin username
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus />
        </label>
        <label>
          Admin password
          <input value={password} type="password" onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label>
          Confirm admin password
          <input value={confirmPassword} type="password" onChange={(event) => setConfirmPassword(event.target.value)} />
        </label>
        <label className="checkbox setup-checkbox">
          <input type="checkbox" checked={createCashier} onChange={(event) => setCreateCashier(event.target.checked)} />
          Add cashier account
        </label>
        {createCashier && (
          <div className="setup-cashier-fields">
            <label>
              Cashier username
              <input value={cashierUsername} onChange={(event) => setCashierUsername(event.target.value)} />
            </label>
            <label>
              Cashier password
              <input value={cashierPassword} type="password" onChange={(event) => setCashierPassword(event.target.value)} />
            </label>
            <label>
              Confirm cashier password
              <input value={confirmCashierPassword} type="password" onChange={(event) => setConfirmCashierPassword(event.target.value)} />
            </label>
          </div>
        )}
        <button className="primary" type="submit">
          Start TruePOS
        </button>
      </form>
      {error && <ErrorModal title="Setup problem" message={error} onClose={() => setError("")} />}
    </div>
  );
}

function NavButton(props: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  notice?: boolean;
  stockAlert?: number;
  onClick: () => void;
}) {
  const stockAlert = Math.max(0, props.stockAlert ?? 0);
  const ariaExtra = props.notice
    ? ", update available"
    : stockAlert > 0
      ? `, ${stockAlert} stock alert${stockAlert === 1 ? "" : "s"}`
      : "";
  return (
    <button className={`nav-button ${props.active ? "active" : ""}`} aria-label={`${props.label}${ariaExtra}`} onClick={props.onClick}>
      <span className="nav-button-icon">{props.icon}</span>
      <span>{props.label}</span>
      {props.notice && <span className="nav-update-notice" title="A TruePOS update is available"><Bell size={13} /></span>}
      {!props.notice && stockAlert > 0 && (
        <span className="nav-stock-notice" title={`${stockAlert} product${stockAlert === 1 ? "" : "s"} need reorder attention`}>
          {stockAlert > 99 ? "99+" : stockAlert}
        </span>
      )}
    </button>
  );
}
