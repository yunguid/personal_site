#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE_DIR = process.env.YNG_MUSIC_SOURCE || '/Users/luke/Desktop/render-project';
const BUCKET = process.env.YNG_MUSIC_BUCKET || 'yng-music-archive';
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
const PREFIX = 'tracks/render-project';
const PUBLIC_BASE_URL = `https://${BUCKET}.s3.${REGION}.amazonaws.com`;
const CATALOG_PATH = join(ROOT, 'src/data/yng-music.json');
const TMP_DIR = join(ROOT, 'tmp');
const DRY_RUN_PATH = join(TMP_DIR, 'yng-music-dry-run.json');

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3']);
const CONTENT_TYPES = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

const command = process.argv[2] || 'scan';
const flags = new Set(process.argv.slice(3));

function slugify(value) {
  const slug = value
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();

  return slug || 'untitled';
}

function titleFromFilename(fileName) {
  return basename(fileName, extname(fileName))
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled';
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const secs = String(rounded % 60).padStart(2, '0');
  return `${minutes}:${secs}`;
}

async function run(cmd, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    maxBuffer: 1024 * 1024 * 20,
    ...options,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

async function maybeRun(cmd, args) {
  try {
    return await run(cmd, args);
  } catch (error) {
    return {
      stdout: error.stdout?.trim() || '',
      stderr: error.stderr?.trim() || error.message,
      failed: true,
      code: error.code,
    };
  }
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolvePromise, rejectPromise) => {
    createReadStream(filePath)
      .on('data', chunk => hash.update(chunk))
      .on('error', rejectPromise)
      .on('end', resolvePromise);
  });
  return hash.digest('hex');
}

async function durationSeconds(filePath) {
  const afinfo = await maybeRun('afinfo', [filePath]);
  const match = afinfo.stdout.match(/estimated duration:\s*([\d.]+)\s*sec/i);
  if (match) return Number(match[1]);

  const ffprobe = await maybeRun('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  const parsed = Number(ffprobe.stdout);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function scanFiles() {
  const names = await readdir(SOURCE_DIR);
  const files = [];

  for (const name of names.sort((a, b) => a.localeCompare(b))) {
    const filePath = join(SOURCE_DIR, name);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) continue;

    const ext = extname(name).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(ext)) continue;

    const hash = await sha256(filePath);
    const duration = await durationSeconds(filePath);
    const key = `${PREFIX}/${slugify(basename(name, ext))}-${hash.slice(0, 12)}${ext}`;

    files.push({
      id: hash.slice(0, 16),
      title: titleFromFilename(name),
      fileName: name,
      sourcePath: filePath,
      format: ext.slice(1),
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
      durationSeconds: duration,
      duration: formatDuration(duration),
      sha256: hash,
      s3Bucket: BUCKET,
      s3Key: key,
      url: `${PUBLIC_BASE_URL}/${encodeURI(key).replace(/%2F/g, '/')}`,
    });
  }

  return files;
}

async function setupBucket() {
  const head = await maybeRun('aws', ['s3api', 'head-bucket', '--bucket', BUCKET]);
  if (head.failed) {
    const args = ['s3api', 'create-bucket', '--bucket', BUCKET, '--region', REGION];
    if (REGION !== 'us-east-1') {
      args.push('--create-bucket-configuration', `LocationConstraint=${REGION}`);
    }
    await run('aws', args);
  }

  await run('aws', [
    's3api', 'put-bucket-versioning',
    '--bucket', BUCKET,
    '--versioning-configuration', 'Status=Enabled',
  ]);

  await run('aws', [
    's3api', 'put-bucket-encryption',
    '--bucket', BUCKET,
    '--server-side-encryption-configuration',
    JSON.stringify({
      Rules: [{
        ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' },
        BucketKeyEnabled: true,
      }],
    }),
  ]);

  await run('aws', [
    's3api', 'put-public-access-block',
    '--bucket', BUCKET,
    '--public-access-block-configuration',
    'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false',
  ]);

  await run('aws', [
    's3api', 'put-bucket-policy',
    '--bucket', BUCKET,
    '--policy',
    JSON.stringify({
      Version: '2012-10-17',
      Statement: [{
        Sid: 'PublicReadMusicTracks',
        Effect: 'Allow',
        Principal: '*',
        Action: 's3:GetObject',
        Resource: `arn:aws:s3:::${BUCKET}/${PREFIX}/*`,
      }],
    }),
  ]);

  await run('aws', [
    's3api', 'put-bucket-cors',
    '--bucket', BUCKET,
    '--cors-configuration',
    JSON.stringify({
      CORSRules: [{
        AllowedHeaders: ['*'],
        AllowedMethods: ['GET', 'HEAD', 'PUT'],
        AllowedOrigins: ['*'],
        ExposeHeaders: ['Content-Length', 'Content-Type', 'ETag'],
        MaxAgeSeconds: 3000,
      }],
    }),
  ]);

  console.log(`Configured s3://${BUCKET} in ${REGION}`);
}

async function uploadAndVerify(track) {
  const headBefore = await maybeRun('aws', [
    's3api', 'head-object',
    '--bucket', BUCKET,
    '--key', track.s3Key,
  ]);

  if (!headBefore.failed) {
    const existing = JSON.parse(headBefore.stdout);
    if (
      existing.ContentLength === track.sizeBytes &&
      existing.Metadata?.sha256 === track.sha256
    ) {
      return { ...track, uploaded: false, verified: true };
    }
  }

  await run('aws', [
    's3', 'cp',
    track.sourcePath,
    `s3://${BUCKET}/${track.s3Key}`,
    '--content-type', CONTENT_TYPES[`.${track.format}`],
    '--metadata', `sha256=${track.sha256}`,
    '--cache-control', 'public, max-age=31536000, immutable',
    '--only-show-errors',
  ]);

  const headAfter = await run('aws', [
    's3api', 'head-object',
    '--bucket', BUCKET,
    '--key', track.s3Key,
  ]);
  const remote = JSON.parse(headAfter.stdout);

  if (remote.ContentLength !== track.sizeBytes) {
    throw new Error(`Size mismatch for ${track.sourcePath}`);
  }
  if (remote.Metadata?.sha256 !== track.sha256) {
    throw new Error(`SHA metadata mismatch for ${track.sourcePath}`);
  }

  return { ...track, uploaded: true, verified: true };
}

async function writeCatalog(tracks) {
  const catalog = {
    generatedAt: new Date().toISOString(),
    source: 'render-project',
    bucket: BUCKET,
    prefix: PREFIX,
    publicBaseUrl: PUBLIC_BASE_URL,
    trackCount: tracks.length,
    totalSizeBytes: tracks.reduce((sum, track) => sum + track.sizeBytes, 0),
    tracks: tracks.map(track => ({
      id: track.id,
      title: track.title,
      fileName: track.fileName,
      format: track.format,
      sizeBytes: track.sizeBytes,
      modifiedAt: track.modifiedAt,
      durationSeconds: track.durationSeconds,
      duration: track.duration,
      sha256: track.sha256,
      s3Key: track.s3Key,
      url: track.url,
    })),
  };

  await writeFile(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
  return catalog;
}

async function scanCommand() {
  await mkdir(TMP_DIR, { recursive: true });
  const tracks = await scanFiles();
  const totalSize = tracks.reduce((sum, track) => sum + track.sizeBytes, 0);
  await writeFile(DRY_RUN_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), tracks }, null, 2)}\n`);
  console.log(`Dry run found ${tracks.length} top-level .wav/.mp3 files (${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GiB).`);
  console.log(`Wrote ${DRY_RUN_PATH}`);
}

async function syncCommand() {
  await mkdir(TMP_DIR, { recursive: true });
  const deleteAfterVerify = flags.has('--delete-after-verify');
  const tracks = await scanFiles();
  const verified = [];

  for (const [index, track] of tracks.entries()) {
    const result = await uploadAndVerify(track);
    verified.push(result);
    console.log(`[${index + 1}/${tracks.length}] verified ${track.fileName}`);
  }

  const catalog = await writeCatalog(verified);
  const reportPath = join(TMP_DIR, `yng-music-upload-${Date.now()}.json`);
  await writeFile(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), deleteAfterVerify, tracks: verified }, null, 2)}\n`);

  if (deleteAfterVerify) {
    await run('npm', ['run', 'build'], { cwd: ROOT });
    for (const track of verified) {
      if (track.verified && existsSync(track.sourcePath)) {
        await rm(track.sourcePath);
      }
    }
  }

  console.log(`Wrote ${CATALOG_PATH}`);
  console.log(`Wrote ${reportPath}`);
  console.log(`Catalog tracks: ${catalog.trackCount}`);
  if (deleteAfterVerify) console.log('Deleted verified local source files.');
}

if (command === 'setup-bucket') {
  await setupBucket();
} else if (command === 'scan') {
  await scanCommand();
} else if (command === 'sync') {
  await syncCommand();
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
