import { execSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Package server.zip for Elastic Beanstalk (Node.js 22 / Amazon Linux 2023).
 *
 * The bundle is lean by default: Elastic Beanstalk installs dependencies on
 * the instance from package-lock.json, which is both how this environment has
 * always deployed and the only way the platform-specific binaries come out
 * right. `sharp` picks its native binary through optional dependencies
 * (@img/sharp-linux-x64), so a node_modules copied off a Windows or macOS dev
 * box carries that box's binary and throws "Could not load the sharp module
 * using the linux-x64 runtime" on boot — the deploy goes green and every slab
 * composite fails.
 *
 * `--with-node-modules` stages a linux-x64 production tree instead, for the
 * case where on-instance npm install is the thing that is failing. It is not
 * the default because it has never been needed here.
 *
 * The .env is never bundled: this environment's configuration lives in the
 * EB environment properties (Configuration -> Updates, monitoring, and
 * logging), and an application version is stored in S3 where anyone with
 * console access can read it.
 */

const root = process.cwd();
const zipPath = path.join(root, "server.zip");
const stageDir = path.join(root, ".ebstage");
const withNodeModules = process.argv.includes("--with-node-modules");

const BUNDLE = [
  "dist",
  "package.json",
  "package-lock.json",
  "Procfile",
  ".ebextensions",
  ".platform",
];

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: "inherit" });

// ---------------------------------------------------------------------------

if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
if (fs.existsSync(stageDir)) fs.rmSync(stageDir, { recursive: true, force: true });

console.log("1. Building production dist...");
run("npx tsc && node scripts/copy-email-templates.mjs", root);

let packFrom = root;

if (withNodeModules) {
  console.log("2. Staging linux-x64 production dependencies...");
  fs.mkdirSync(stageDir, { recursive: true });
  for (const entry of BUNDLE) {
    fs.cpSync(path.join(root, entry), path.join(stageDir, entry), {
      recursive: true,
    });
  }

  // --os/--cpu/--libc make npm resolve optional dependencies for the deploy
  // target rather than this host. --ignore-scripts keeps npm from trying to
  // build a native module for the wrong platform; every native dependency
  // here (sharp, bcrypt) ships prebuilt binaries, so nothing needs compiling.
  //
  // x64 matches the "Node.js 22 running on 64bit Amazon Linux 2023" platform
  // on Intel/AMD instance types. On Graviton (t4g/m7g) this must become
  // arm64, and the check below must look for @img/sharp-linux-arm64.
  run(
    "npm ci --omit=dev --ignore-scripts --os=linux --cpu=x64 --libc=glibc",
    stageDir,
  );

  if (!fs.existsSync(path.join(stageDir, "node_modules", "@img", "sharp-linux-x64"))) {
    console.error(
      "\n❌ @img/sharp-linux-x64 is not in the staged tree — sharp would fail\n" +
        "   to load on EB and every slab composite would throw. Check that\n" +
        "   npm is >= 10.4 (npm --version) for --os/--cpu support.",
    );
    process.exit(1);
  }

  BUNDLE.push("node_modules");
  packFrom = stageDir;
} else {
  console.log("2. Lean bundle — EB installs dependencies on the instance.");
}

if (fs.existsSync(path.join(root, ".env"))) {
  console.log(
    "   ℹ️  .env present but not bundled — configuration comes from the EB\n" +
      "      environment properties.",
  );
}

console.log("3. Packaging server.zip...");

// Written relative to the pack directory: tar reads a leading "C:\" as a
// remote host:path and fails with "Cannot connect to C: resolve failed".
const outRel = path.relative(packFrom, zipPath) || path.basename(zipPath);

if (process.platform === "win32") {
  // Windows ships bsdtar at System32\tar.exe. Called by absolute path on
  // purpose: Git Bash puts GNU tar ahead of it on PATH, and GNU tar has no
  // zip support at all — `-caf out.zip` silently writes a plain tar under a
  // .zip name, which EB rejects. Which shell this is run from must not decide
  // the container format.
  //
  // --format=zip is likewise required; -a only selects a compression filter
  // (gz/bz2/xz/zst), never the archive container.
  const bsdtar = path.join(
    process.env.SystemRoot || "C:/Windows",
    "System32",
    "tar.exe",
  );
  run(`"${bsdtar}" -cf "${outRel}" --format=zip ${BUNDLE.join(" ")}`, packFrom);
} else {
  run(`zip -qr "${outRel}" ${BUNDLE.join(" ")}`, packFrom);
}

// "PK\x03\x04". Cheap, and the failure it catches is one EB reports as a
// generic invalid-bundle error long after the upload has finished.
const magic = Buffer.alloc(4);
const fd = fs.openSync(zipPath, "r");
fs.readSync(fd, magic, 0, 4, 0);
fs.closeSync(fd);
if (magic.toString("latin1") !== "PK\x03\x04") {
  console.error(
    `\n❌ ${path.basename(zipPath)} is not a zip archive (magic: ${magic.toString("hex")}).`,
  );
  process.exit(1);
}

if (fs.existsSync(stageDir)) fs.rmSync(stageDir, { recursive: true, force: true });

const mb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(2);
console.log(`\n✅ server.zip ready — ${mb} MB${withNodeModules ? " (node_modules bundled)" : ""}`);
