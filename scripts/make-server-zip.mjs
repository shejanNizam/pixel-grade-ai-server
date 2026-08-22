import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const root = process.cwd();
const zipPath = path.join(root, "server.zip");

if (fs.existsSync(zipPath)) {
  try { fs.unlinkSync(zipPath); } catch (_e) {}
}

console.log("1. Building production TypeScript dist...");
execSync("npx tsc && node scripts/copy-email-templates.mjs", { cwd: root, stdio: "inherit" });

console.log("2. Packaging server.zip for AWS Elastic Beanstalk...");

const includes = [
  "dist",
  "node_modules",
  "package.json",
  "package-lock.json",
  "Procfile",
  ".ebextensions",
  ".platform",
];

if (fs.existsSync(path.join(root, ".env"))) {
  includes.push(".env");
}

try {
  if (process.platform === "win32") {
    // Use native tar.exe on Windows for 10x faster zipping without file lock errors
    const includeStr = includes.join(" ");
    execSync(`tar -caf server.zip ${includeStr}`, { cwd: root, stdio: "inherit" });
  } else {
    const includeStr = includes.join(" ");
    execSync(`zip -r server.zip ${includeStr}`, { cwd: root, stdio: "inherit" });
  }
  const stat = fs.statSync(zipPath);
  console.log(`✅ server.zip generated successfully! Size: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
} catch (err) {
  console.error("Failed to generate server.zip:", err);
  process.exit(1);
}
