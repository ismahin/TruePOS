const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const buildDir = path.join(root, "build");
const sourcePath = path.join(root, "google-drive-oauth.json");
const targetPath = path.join(buildDir, "google-drive-oauth.json");

fs.mkdirSync(buildDir, { recursive: true });

const clientId = (process.env.TRUEPOS_GOOGLE_CLIENT_ID || "").trim();
if (clientId) {
  fs.writeFileSync(targetPath, `${JSON.stringify({ clientId }, null, 2)}\n`, "utf8");
} else if (fs.existsSync(sourcePath)) {
  fs.copyFileSync(sourcePath, targetPath);
} else {
  fs.writeFileSync(targetPath, `${JSON.stringify({ clientId: "" }, null, 2)}\n`, "utf8");
}
