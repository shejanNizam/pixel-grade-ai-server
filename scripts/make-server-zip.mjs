/* eslint-disable no-console */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

console.log("Building TypeScript code...");
execSync("npm run build", { cwd: projectRoot, stdio: "inherit" });

const zipPath = path.join(projectRoot, "server.zip");
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

console.log("Creating server.zip for Elastic Beanstalk deployment...");
execSync(
  "tar -a -c -f server.zip dist .ebextensions .platform Procfile package.json package-lock.json",
  { cwd: projectRoot, stdio: "inherit" },
);

console.log("Successfully created server.zip!");
