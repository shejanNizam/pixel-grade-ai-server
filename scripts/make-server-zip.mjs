 import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const root = process.cwd();
const zipPath = path.join(root, "server.zip");

if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

console.log("Packaging server.zip for AWS Elastic Beanstalk...");

const includes = [
  "dist",
  "package.json",
  "package-lock.json",
  "Procfile",
  ".ebextensions",
  ".platform",
];

// Include .env if it exists in local directory
if (fs.existsSync(path.join(root, ".env"))) {
  includes.push(".env");
}

try {
  const includeStr = includes.join(" ");
  if (process.platform === "win32") {
    const psCommand = `Compress-Archive -Path ${includes.map(i => `'${i}'`).join(",")} -DestinationPath 'server.zip' -Force`;
    execSync(`powershell -Command "${psCommand}"`, { cwd: root, stdio: "inherit" });
  } else {
    execSync(`zip -r server.zip ${includeStr}`, { cwd: root, stdio: "inherit" });
  }
  const stat = fs.statSync(zipPath);
  console.log(`✅ server.zip generated successfully! Size: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
} catch (err) {
  console.error("Failed to generate server.zip:", err);
  process.exit(1);
}
