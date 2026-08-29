export type NoticeKind = "success" | "error" | "warning";
export type Notify = (message: string, kind?: NoticeKind) => void;

export function isUserCancellation(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\b(cancelled|canceled)\b/i.test(message);
}

export function friendlyErrorMessage(error: unknown, fallback: string) {
  let message = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;

  // Electron can wrap the same error more than once. Remove every wrapper before
  // deciding whether the remaining text is safe and useful for a customer.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const previous = message;
    message = message
      .replace(/^Error:\s*/i, "")
      .replace(/^Error invoking remote method\s+['"][^'"]+['"]:\s*/i, "")
      .trim();
    if (message === previous) break;
  }

  // Stack traces and service responses can span several lines. The first line is
  // enough to identify a known problem; unknown technical text uses the fallback.
  message = message.split(/\r?\n/, 1)[0]?.trim() ?? "";

  if (!message) return fallback;
  if (/UNIQUE constraint failed: products\.barcode|SQLITE_CONSTRAINT.*barcode/i.test(message)) {
    return "This barcode is already assigned to another product. Enter a different barcode and try again.";
  }
  if (/UNIQUE constraint failed: products\.sku|SQLITE_CONSTRAINT.*sku/i.test(message)) {
    return "This SKU is already assigned to another product. Enter a different SKU and try again.";
  }
  if (/Product image/i.test(message)) {
    return message;
  }
  if (/UNIQUE constraint failed: users\.username|SQLITE_CONSTRAINT.*username/i.test(message)) {
    return "That username is already in use. Choose a different username and try again.";
  }
  if (/database is locked|SQLITE_BUSY/i.test(message)) {
    return "TruePOS is busy saving another change. Please wait a moment and try again.";
  }
  if (/did not respond in TSPL label mode|Receipt\/ESC-POS mode to Label\/TSPL mode/i.test(message)) {
    return "The printer is still in receipt mode. Switch the XP-365B to Label mode, then try printing the label again.";
  }
  if (/out of labels/i.test(message)) {
    return "The printer is out of labels. Load a label roll, close the cover, and try again.";
  }
  if (/paper jam/i.test(message)) {
    return "A label is jammed in the printer. Clear the jam, close the cover, and try again.";
  }
  if (/print head open|cover open/i.test(message)) {
    return "The printer cover is open. Close it firmly, then try again.";
  }
  if (/out of ribbon/i.test(message)) {
    return "The printer cannot detect the printing material. Check that the label roll is loaded correctly, then try again.";
  }
  if (/printer busy|printing paused/i.test(message)) {
    return "The printer is busy or paused. Wait until it is ready, then try again.";
  }
  if (/XP-365B is not ready|printer error/i.test(message)) {
    return "The printer is not ready. Check the paper, cover, USB connection, and selected mode, then try again.";
  }
  if (/XP-365B USB device not found|could not open the printer port|invalid USB path/i.test(message)) {
    return "The XP-365B could not be found. Make sure it is powered on and connected by USB, then try again.";
  }
  if (/Xprinter .*?(?:write|status read).*?(?:failed|timed out)|Xprinter .*? failed/i.test(message)) {
    return "The printer could not complete the job. Check the USB connection, paper, cover, and printer mode, then try again.";
  }
  if (/Xprinter SDK runtime was not found|printer\.sdk\.dll|SDK does not support|SDK error/i.test(message)) {
    return "Required Xprinter support files are missing. Reinstall TruePOS, then try printing again.";
  }
  if (/Barcode .* is too long for .*scanner-safe|module width/i.test(message)) {
    return "This barcode is too long for the selected label size. Use a shorter barcode or choose a wider label.";
  }
  if (/Google token exchange failed|Google token refresh failed|Google OAuth failed|Invalid Google OAuth state/i.test(message)) {
    return "Google Drive authorization could not be completed. Disconnect the account, reconnect it, and try again.";
  }
  if (/Google Drive upload failed/i.test(message)) {
    return "The backup could not be uploaded to Google Drive. Check the connection and available Drive storage, then try again.";
  }
  if (/EACCES|EPERM|permission denied/i.test(message)) {
    return "TruePOS does not have permission to access the required file or folder. Choose another location or contact an administrator.";
  }
  if (/ENOENT|no such file or directory/i.test(message)) {
    return "A required file could not be found. Check that it has not been moved or deleted, then try again.";
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|network request failed|fetch failed/i.test(message)) {
    return "TruePOS could not connect to the service. Check the internet connection and try again.";
  }

  const containsTechnicalDetails =
    /Error invoking remote method|\bIPC\b|SQLITE_|constraint failed|TypeError|ReferenceError|SyntaxError|UnhandledPromise|node:|\.dll\b|\.node\b|\bSDK\b|\berrno\b|\bHTTP\s*\d{3}\b|\bstatus(?: code)?\s*[:=]?\s*\d{3}\b|\b0x[0-9a-f]+\b|\bat\s+\S+\s*\(/i.test(message) ||
    /[A-Za-z]:\\[^\s]+|\/(?:Users|home|var|tmp)\//i.test(message) ||
    /<\/?[a-z][^>]*>|^\s*[\[{].*[\]}]\s*$/i.test(message) ||
    message.length > 180;

  if (containsTechnicalDetails) return fallback;
  return message;
}

export function errorDialogTitle(message: string) {
  if (/printer|printing|receipt|label|barcode|XP-365B|TSPL/i.test(message)) return "Printing problem";
  if (/login|sign in|password|username|credentials/i.test(message)) return "Sign-in problem";
  if (/backup|Google Drive|CSV|export|import/i.test(message)) return "Backup problem";
  if (/inventory|stock|quantity/i.test(message)) return "Inventory problem";
  if (/product|SKU|category/i.test(message)) return "Product problem";
  if (/report/i.test(message)) return "Report problem";
  if (/sale|payment|cart|invoice|billing/i.test(message)) return "Billing problem";
  if (/settings/i.test(message)) return "Settings problem";
  if (/update|version/i.test(message)) return "Update problem";
  return "Unable to complete the action";
}
