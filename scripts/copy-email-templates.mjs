/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceDir = path.join(projectRoot, "src", "app", "utils", "templates");
const destinationDir = path.join(
  projectRoot,
  "dist",
  "app",
  "utils",
  "templates",
);

if (!fs.existsSync(sourceDir)) {
  throw new Error(`Email template directory not found: ${sourceDir}`);
}

fs.rmSync(destinationDir, { recursive: true, force: true });
fs.mkdirSync(path.dirname(destinationDir), { recursive: true });
fs.cpSync(sourceDir, destinationDir, { recursive: true });

console.log(
  `Copied email templates to ${path.relative(projectRoot, destinationDir)}`,
);
