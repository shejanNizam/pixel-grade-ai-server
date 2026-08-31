import { execFileSync, execSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Deploy server.zip to Elastic Beanstalk from the command line.
 *
 * The console's "Upload and deploy" button gives you a spinner and, half an
 * hour later, a failure with no detail. This does the same four API calls the
 * console does, then tails the environment's own event stream, so a stuck
 * deploy names the instance and the phase while it is still stuck rather than
 * after EB has rolled back and discarded the evidence.
 *
 * Needs AWS CLI v2 (no Python) and a configured profile:
 *   winget install Amazon.AWSCLI
 *   aws configure            # IAM user's key, secret, region eu-north-1
 *
 * Usage:  npm run deploy
 *         npm run deploy -- --skip-build      # redeploy the existing zip
 */

const APP = process.env.EB_APP || "pixelgrade";
const ENV = process.env.EB_ENV || "Pixelgrade-env-1";
const REGION = process.env.AWS_REGION || "eu-north-1";

const root = process.cwd();
const zipPath = path.join(root, "server.zip");
const skipBuild = process.argv.includes("--skip-build");

/** AWS CLI call returning parsed JSON. */
const aws = (args) => {
  const out = execFileSync("aws", [...args, "--region", REGION, "--output", "json"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.trim() ? JSON.parse(out) : null;
};

const sleep = (ms) => execSync(`node -e "setTimeout(()=>{}, ${ms})"`);

// ---------------------------------------------------------------------------

try {
  execFileSync("aws", ["--version"], { stdio: "ignore" });
} catch {
  console.error(
    "AWS CLI not found. Install it (winget install Amazon.AWSCLI), then run\n" +
      "`aws configure` with the IAM user's access key and region " + REGION + ".",
  );
  process.exit(1);
}

if (!skipBuild) {
  console.log("Building bundle...");
  execSync("node scripts/make-server-zip.mjs", { cwd: root, stdio: "inherit" });
} else if (!fs.existsSync(zipPath)) {
  console.error("--skip-build given but server.zip does not exist.");
  process.exit(1);
}

const label = `app-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
const sizeMb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(2);

// EB's own per-region bucket. This call is idempotent and just returns it.
const bucket = aws(["elasticbeanstalk", "create-storage-location"]).S3Bucket;
const key = `${APP}/${label}.zip`;

console.log(`\nUploading ${sizeMb} MB to s3://${bucket}/${key}`);
execFileSync("aws", ["s3", "cp", zipPath, `s3://${bucket}/${key}`, "--region", REGION], {
  stdio: "inherit",
});

// --process makes EB validate and preprocess the bundle before anything is
// deployed, so a malformed archive or a broken .ebextensions file fails here
// in seconds instead of thirty minutes into an environment update.
console.log(`\nCreating application version ${label} (validating bundle)...`);
aws([
  "elasticbeanstalk", "create-application-version",
  "--application-name", APP,
  "--version-label", label,
  "--source-bundle", `S3Bucket=${bucket},S3Key=${key}`,
  "--process",
]);

process.stdout.write("Waiting for validation");
for (;;) {
  const [v] = aws([
    "elasticbeanstalk", "describe-application-versions",
    "--application-name", APP, "--version-labels", label,
  ]).ApplicationVersions;

  if (v.Status === "PROCESSED") { console.log(" ok"); break; }
  if (v.Status === "FAILED") {
    console.error("\nEB rejected the bundle. Check .ebextensions syntax.");
    process.exit(1);
  }
  process.stdout.write(".");
  sleep(3000);
}

const startedAt = new Date(Date.now() - 5000).toISOString();

console.log(`\nDeploying ${label} to ${ENV}...\n`);
aws([
  "elasticbeanstalk", "update-environment",
  "--environment-name", ENV,
  "--version-label", label,
]);

// Tail events until the environment leaves Updating. Printed oldest-first and
// deduplicated, because describe-events returns newest-first and overlapping
// windows repeat entries.
const seen = new Set();
for (;;) {
  const events = aws([
    "elasticbeanstalk", "describe-events",
    "--environment-name", ENV,
    "--start-time", startedAt,
  ]).Events;

  for (const e of events.slice().reverse()) {
    const id = `${e.EventDate}|${e.Message}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const time = new Date(e.EventDate).toISOString().slice(11, 19);
    console.log(`  ${time}  ${e.Severity.padEnd(5)}  ${e.Message}`);
  }

  const [env] = aws([
    "elasticbeanstalk", "describe-environments",
    "--environment-names", ENV,
  ]).Environments;

  if (env.Status === "Ready") {
    console.log(`\nStatus: ${env.Status} · Health: ${env.Health} · Version: ${env.VersionLabel}`);
    if (env.VersionLabel !== label) {
      console.error(
        `\nEB is serving ${env.VersionLabel}, not ${label} — the deploy was rolled back.\n` +
          "Pull the instance logs to see where it stalled:\n" +
          `  npm run logs`,
      );
      process.exit(1);
    }
    console.log(`\nDeployed ${label}.`);
    break;
  }
  sleep(5000);
}
