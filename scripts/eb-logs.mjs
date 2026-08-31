import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Pull Elastic Beanstalk instance logs to ./eb-logs/.
 *
 * `npm run logs`         last 100 lines of the usual logs, printed
 * `npm run logs -- --full`   full log bundle per instance, saved as zips
 *
 * For a deploy that hangs rather than errors, --full is the one that answers
 * it: eb-engine.log records each deployment phase with timestamps, and
 * cfn-init.log records the .ebextensions steps. A phase that starts and never
 * logs its completion is where the deploy is stuck — a dnf install blocked on
 * the RPM lock looks exactly like that, and leaves no trace anywhere else.
 */

const ENV = process.env.EB_ENV || "Pixelgrade-env-1";
const REGION = process.env.AWS_REGION || "eu-north-1";
const full = process.argv.includes("--full");
const infoType = full ? "bundle" : "tail";

const outDir = path.join(process.cwd(), "eb-logs");

const aws = (args) => {
  const out = execFileSync("aws", [...args, "--region", REGION, "--output", "json"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.trim() ? JSON.parse(out) : null;
};

const sleep = (ms) => execFileSync("node", ["-e", `setTimeout(()=>{}, ${ms})`]);

// ---------------------------------------------------------------------------

console.log(`Requesting ${infoType} logs from ${ENV}...`);
aws(["elasticbeanstalk", "request-environment-info", "--environment-name", ENV, "--info-type", infoType]);

// EB gathers on the instances and uploads to S3; nothing is available until
// that finishes, and the call returns immediately either way.
process.stdout.write("Waiting for instances to upload");
let entries = [];
for (let i = 0; i < 40; i++) {
  sleep(5000);
  process.stdout.write(".");
  entries = aws([
    "elasticbeanstalk", "retrieve-environment-info",
    "--environment-name", ENV, "--info-type", infoType,
  ]).EnvironmentInfo || [];
  if (entries.length) break;
}
console.log("");

if (!entries.length) {
  console.error("No logs came back. The instances may be unreachable.");
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

// Newest entry per instance: repeated requests accumulate in the same bucket.
const latest = new Map();
for (const e of entries) {
  const prev = latest.get(e.Ec2InstanceId);
  if (!prev || new Date(e.SampleTimestamp) > new Date(prev.SampleTimestamp)) {
    latest.set(e.Ec2InstanceId, e);
  }
}

for (const [instance, e] of latest) {
  const res = await fetch(e.Message);
  if (!res.ok) {
    console.error(`  ${instance}: download failed (${res.status})`);
    continue;
  }

  if (full) {
    const file = path.join(outDir, `${instance}.zip`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log(`  ${instance} -> ${path.relative(process.cwd(), file)}`);
  } else {
    const file = path.join(outDir, `${instance}.log`);
    const text = await res.text();
    fs.writeFileSync(file, text);
    console.log(`\n===== ${instance} =====\n`);
    console.log(text);
  }
}

if (full) {
  console.log(
    "\nUnzip and read, in this order:\n" +
      "  var/log/eb-engine.log   deployment phases and their timings\n" +
      "  var/log/cfn-init.log    .ebextensions packages/commands steps\n" +
      "  var/log/web.stdout.log  the app's own output after it starts",
  );
}
