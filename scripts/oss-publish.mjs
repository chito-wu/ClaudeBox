#!/usr/bin/env node
/**
 * Publish ClaudeBox release artifacts to Aliyun OSS.
 *
 * Mirrors what build.sh uploads to GitHub Release, but to a stable path
 * (`<prefix>/v<version>/<basename>`) under an Aliyun OSS bucket fronted by a
 * CDN domain. Tauri's updater is signature-verified on the client, so the OSS
 * objects only need public-read; secrets here are write-side credentials.
 *
 * Also rewrites `latest.json` on the fly: any `https://github.com/...releases/
 * download/v<ver>/<file>` URL inside it gets replaced with the matching OSS
 * CDN URL, then uploaded to `<prefix>/latest.json` (a stable path matching the
 * `endpoints` entry in tauri.conf.json).
 *
 * Usage:
 *   node scripts/oss-publish.mjs \
 *     --version 0.5.13 \
 *     --latest-json src-tauri/target/release/bundle/macos/latest.json \
 *     <file1> [file2] ...
 *
 * Configuration (resolved in this order):
 *   1. CLI flags: --bucket, --region, --cdn-domain, --prefix
 *   2. Env vars: OSS_BUCKET, OSS_REGION, OSS_CDN_DOMAIN, OSS_PREFIX,
 *                OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET
 *   3. Fallback: ~/.claude/skills/oss-upload/config.json
 *      (so devs already set up for `oss-upload` don't need to re-configure)
 *
 * Defaults: bucket=dm-ugc, region=oss-cn-beijing.aliyuncs.com,
 *           cdn=https://dmugc-cn.domobcdn.com, prefix=claudebox
 */

import { readFileSync, writeFileSync, statSync, existsSync, mkdtempSync } from "node:fs";
import { createHmac, createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { basename, extname, resolve, join } from "node:path";
import { tmpdir, homedir } from "node:os";

// ── arg parsing ─────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flags = {};
const files = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-h" || a === "--help") { printHelp(); process.exit(0); }
  if (a.startsWith("--")) {
    const key = a.slice(2);
    flags[key] = argv[++i];
    continue;
  }
  files.push(a);
}

if (!flags.version) {
  fail("Missing required flag: --version <semver>");
}
if (files.length === 0 && !flags["latest-json"]) {
  fail("No files to upload (and no --latest-json)");
}

function printHelp() {
  console.error("Usage: node scripts/oss-publish.mjs --version <ver> [opts] <file...>");
  console.error("Options:");
  console.error("  --version <semver>            Release version, used to build the OSS path");
  console.error("  --latest-json <path>          Rewrite this file's GitHub URLs → OSS CDN URLs");
  console.error("                                and upload it to <prefix>/latest.json");
  console.error("  --bucket <name>               OSS bucket (default: dm-ugc)");
  console.error("  --region <endpoint>           OSS endpoint (default: oss-cn-beijing.aliyuncs.com)");
  console.error("  --cdn-domain <url>            Public CDN base (default: https://dmugc-cn.domobcdn.com)");
  console.error("  --prefix <prefix>             Path prefix inside bucket (default: claudebox)");
  console.error("  --dry-run                     Resolve config & print plan without uploading");
}

function fail(msg) {
  console.error(`[oss-publish] ${msg}`);
  process.exit(1);
}

// ── config resolution ────────────────────────────────────────────────

function loadJsonIfExists(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.warn(`[oss-publish] failed to read ${path}: ${e.message}`);
    return {};
  }
}

// Repo-local override file (gitignored). Lets you commit ClaudeBox's
// `oss-publish.example.json` while keeping the actual bucket/key on each
// developer's machine.
const repoConfigPath = resolve(
  // scripts/ → repo root
  new URL("..", import.meta.url).pathname,
  ".oss-publish.json"
);
const repoConfig = loadJsonIfExists(repoConfigPath);

// User-level fallback shared with the `oss-upload` Claude skill — keeps
// existing skill users zero-configuration.
const userConfig = loadJsonIfExists(
  join(homedir(), ".claude/skills/oss-upload/config.json")
);

// Resolution order (first hit wins): CLI flag → env var → repo-local
// .oss-publish.json → ~/.claude/skills/oss-upload/config.json → default
const pick = (flag, envName, key, def) =>
  flags[flag] ??
  process.env[envName] ??
  repoConfig[key] ??
  userConfig[key] ??
  def;

// Same chain but excluding user-level config — used for fields that are
// project-specific and shouldn't inherit from the shared `oss-upload` skill
// (which has its own prefix like "dm-skills" we don't want to leak in here).
const pickProject = (flag, envName, key, def) =>
  flags[flag] ??
  process.env[envName] ??
  repoConfig[key] ??
  def;

const config = {
  bucket: pick("bucket", "OSS_BUCKET", "bucket", "dm-ugc"),
  endpoint: pick("region", "OSS_REGION", "endpoint", "oss-cn-beijing.aliyuncs.com"),
  cdnDomain: String(pick(
    "cdn-domain",
    "OSS_CDN_DOMAIN",
    "cdn_domain",
    "https://dmugc-cn.domobcdn.com"
  )).replace(/\/+$/, ""),
  prefix: pickProject("prefix", "OSS_PREFIX", "prefix", "claudebox"),
  accessKeyId: pick(null, "OSS_ACCESS_KEY_ID", "access_key_id", null),
  accessKeySecret: pick(null, "OSS_ACCESS_KEY_SECRET", "access_key_secret", null),
  version: flags.version,
  dryRun: "dry-run" in flags,
};

if (!config.accessKeyId || !config.accessKeySecret) {
  fail(
    `Missing OSS credentials. Configure one of:
   1. Env vars OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET
   2. Repo-local file:  ${repoConfigPath}
      (copy .oss-publish.example.json → .oss-publish.json — already gitignored)
   3. ~/.claude/skills/oss-upload/config.json (shared with oss-upload skill)`
  );
}

const versionTag = config.version.startsWith("v") ? config.version : `v${config.version}`;

// ── OSS REST client (signature v1, sufficient for PutObject) ─────────

const MIME = {
  ".dmg": "application/x-apple-diskimage",
  ".sig": "text/plain",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".zip": "application/zip",
  ".msi": "application/x-msi",
  ".exe": "application/x-msdownload",
  ".json": "application/json",
};
const mimeOf = (p) => MIME[extname(p).toLowerCase()] || "application/octet-stream";

const rfc1123 = (d = new Date()) => d.toUTCString();
const md5B64 = (buf) => createHash("md5").update(buf).digest("base64");

function signAuth({ verb, contentMd5, contentType, date, resource }) {
  const stringToSign = `${verb}\n${contentMd5}\n${contentType}\n${date}\n${resource}`;
  const sig = createHmac("sha1", config.accessKeySecret).update(stringToSign).digest("base64");
  return `OSS ${config.accessKeyId}:${sig}`;
}

function encodePath(key) {
  return "/" + key.split("/").map(encodeURIComponent).join("/");
}

function putObject(key, buf, contentType) {
  if (config.dryRun) {
    console.log(`[dry-run] PUT oss://${config.bucket}/${key} (${humanSize(buf.length)}, ${contentType})`);
    return Promise.resolve();
  }
  const contentMd5 = md5B64(buf);
  const date = rfc1123();
  const resource = `/${config.bucket}/${key}`;
  const authorization = signAuth({ verb: "PUT", contentMd5, contentType, date, resource });
  const host = `${config.bucket}.${config.endpoint}`;

  return new Promise((ok, fail) => {
    const req = httpsRequest({
      method: "PUT",
      host,
      path: encodePath(key),
      headers: {
        Host: host,
        Date: date,
        "Content-Type": contentType,
        "Content-Length": buf.length,
        "Content-MD5": contentMd5,
        Authorization: authorization,
        // Force CDN to fetch the latest copy of latest.json on every request,
        // so users don't see stale version metadata after a publish.
        ...(key.endsWith("/latest.json")
          ? { "Cache-Control": "no-cache, max-age=0" }
          : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          ok();
        } else {
          const body = Buffer.concat(chunks).toString("utf8");
          const errSnippet = body.replace(/<Message>([^<]+)<\/Message>/, "$1").slice(0, 400);
          fail(new Error(`HTTP ${res.statusCode}: ${errSnippet || "(no body)"}`));
        }
      });
    });
    req.on("error", fail);
    req.end(buf);
  });
}

function humanSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ── upload plan ──────────────────────────────────────────────────────

const versionPrefix = `${config.prefix}/${versionTag}`;

async function uploadFile(absPath, ossKey) {
  const stat = statSync(absPath);
  if (stat.size === 0) throw new Error(`${absPath}: file is empty`);
  const buf = readFileSync(absPath);
  const ct = mimeOf(absPath);
  await putObject(ossKey, buf, ct);
  const cdnUrl = `${config.cdnDomain}/${ossKey}`;
  console.log(`✓ ${basename(absPath)}  →  ${cdnUrl}  (${humanSize(stat.size)})`);
  return cdnUrl;
}

console.log(`[oss-publish] target: oss://${config.bucket}/${versionPrefix}/  (CDN: ${config.cdnDomain}/${versionPrefix}/)`);
if (config.dryRun) console.log("[oss-publish] DRY RUN — no actual uploads");

let failedCount = 0;

// 1. Upload binaries / sigs / archives (everything passed positionally)
for (const file of files) {
  const abs = resolve(process.cwd(), file);
  if (!existsSync(abs)) {
    console.error(`✗ ${file}: not found, skipping`);
    failedCount += 1;
    continue;
  }
  const ossKey = `${versionPrefix}/${basename(abs)}`;
  try {
    await uploadFile(abs, ossKey);
  } catch (e) {
    console.error(`✗ ${basename(abs)}: ${e.message}`);
    failedCount += 1;
  }
}

// 2. Rewrite + upload latest.json — both as <prefix>/latest.json (stable) and
//    <prefix>/v<ver>/latest.json (versioned snapshot).
if (flags["latest-json"]) {
  const abs = resolve(process.cwd(), flags["latest-json"]);
  if (!existsSync(abs)) {
    console.error(`✗ --latest-json ${abs}: not found`);
    failedCount += 1;
  } else {
    let json;
    try {
      json = JSON.parse(readFileSync(abs, "utf8"));
    } catch (e) {
      console.error(`✗ ${abs}: invalid JSON — ${e.message}`);
      failedCount += 1;
      json = null;
    }
    if (json) {
      // Rewrite every github releases download URL inside `platforms.*.url`
      // (and any other strings) to point at our OSS CDN, keeping the original
      // file basename.
      const ghPrefix = `https://github.com/braverior/ClaudeBox/releases/download/${versionTag}/`;
      const cdnPrefix = `${config.cdnDomain}/${versionPrefix}/`;
      const rewriteUrls = (obj) => {
        if (!obj || typeof obj !== "object") return;
        for (const k of Object.keys(obj)) {
          const v = obj[k];
          if (typeof v === "string" && v.startsWith(ghPrefix)) {
            obj[k] = cdnPrefix + v.slice(ghPrefix.length);
          } else if (typeof v === "object") {
            rewriteUrls(v);
          }
        }
      };
      rewriteUrls(json);

      const tmpDir = mkdtempSync(join(tmpdir(), "oss-publish-"));
      const rewrittenPath = join(tmpDir, "latest.json");
      writeFileSync(rewrittenPath, JSON.stringify(json, null, 2));
      const buf = readFileSync(rewrittenPath);

      try {
        await putObject(`${config.prefix}/latest.json`, buf, "application/json");
        console.log(`✓ latest.json  →  ${config.cdnDomain}/${config.prefix}/latest.json`);
        await putObject(`${versionPrefix}/latest.json`, buf, "application/json");
        console.log(`✓ latest.json (snapshot)  →  ${config.cdnDomain}/${versionPrefix}/latest.json`);
      } catch (e) {
        console.error(`✗ latest.json: ${e.message}`);
        failedCount += 1;
      }
    }
  }
}

if (failedCount > 0) {
  console.error(`[oss-publish] ${failedCount} upload(s) failed`);
  process.exit(1);
}
console.log("[oss-publish] done");
