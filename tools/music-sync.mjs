#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE_DIRS = (process.env.YNG_MUSIC_SOURCE || '/Users/luke/Desktop/render-project')
  .split(',')
  .map(source => source.trim())
  .filter(Boolean);
const SOURCE_MANIFEST = process.env.YNG_MUSIC_SOURCE_MANIFEST || '';
const BUCKET = process.env.YNG_MUSIC_BUCKET || 'yng-music-archive';
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
const PREFIX = process.env.YNG_MUSIC_PREFIX || 'tracks/render-project';
const PUBLIC_BASE_URL = `https://${BUCKET}.s3.${REGION}.amazonaws.com`;
const CATALOG_PATH = process.env.YNG_MUSIC_CATALOG_PATH
  ? resolve(ROOT, process.env.YNG_MUSIC_CATALOG_PATH)
  : join(ROOT, 'src/data/yng-music.json');
const TMP_DIR = join(ROOT, 'tmp');
const DRY_RUN_PATH = join(TMP_DIR, 'yng-music-dry-run.json');

const AUDIO_EXTENSIONS = new Set(
  (process.env.YNG_MUSIC_EXTENSIONS || '.wav,.mp3')
    .split(',')
    .map(ext => ext.trim().toLowerCase())
    .filter(Boolean)
    .map(ext => ext.startsWith('.') ? ext : `.${ext}`)
);
const CONTENT_TYPES = {
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
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

function parseTsv(text) {
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length === 0) return [];

  const headers = lines[0].split('\t');
  return lines.slice(1).map(line => {
    const values = line.split('\t');
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
}

function approvedDecision(value) {
  return new Set(['approve', 'approved', 'yes', 'y']).has(String(value || '').trim().toLowerCase());
}

async function trackFromPath(filePath, sourceRoot = dirname(filePath)) {
  const name = basename(filePath);
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) return null;

  const ext = extname(name).toLowerCase();
  if (!AUDIO_EXTENSIONS.has(ext)) return null;

  const hash = await sha256(filePath);
  const duration = await durationSeconds(filePath);
  const key = `${PREFIX}/${slugify(basename(name, ext))}-${hash.slice(0, 12)}${ext}`;

  return {
    id: hash.slice(0, 16),
    title: titleFromFilename(name),
    fileName: name,
    sourceRoot,
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
  };
}

async function scanManifestFiles() {
  const rows = parseTsv(await readFile(resolve(ROOT, SOURCE_MANIFEST), 'utf8'));
  const files = [];

  for (const row of rows) {
    if ('decision' in row && !approvedDecision(row.decision)) continue;
    const filePath = row.path || row.sourcePath;
    if (!filePath) continue;

    const track = await trackFromPath(filePath);
    if (track) files.push(track);
  }

  return files;
}

async function scanFiles() {
  if (SOURCE_MANIFEST) {
    return scanManifestFiles();
  }

  const files = [];

  for (const sourceDir of SOURCE_DIRS) {
    const names = await readdir(sourceDir);

    for (const name of names.sort((a, b) => a.localeCompare(b))) {
      const filePath = join(sourceDir, name);
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) continue;

      const ext = extname(name).toLowerCase();
      if (!AUDIO_EXTENSIONS.has(ext)) continue;

      const track = await trackFromPath(filePath, sourceDir);
      if (track) files.push(track);
    }
  }

  return files;
}

function dedupeExactTracks(tracks) {
  const seenHashes = new Set();
  const uniqueTracks = [];
  const skippedExactDuplicates = [];

  for (const track of tracks) {
    if (seenHashes.has(track.sha256)) {
      skippedExactDuplicates.push({
        sourcePath: track.sourcePath,
        fileName: track.fileName,
        sha256: track.sha256,
        reason: 'duplicate-sha256-in-source-scan',
      });
      continue;
    }

    seenHashes.add(track.sha256);
    uniqueTracks.push(track);
  }

  return { uniqueTracks, skippedExactDuplicates };
}

function existingCatalogHashSkips(tracks, existingCatalog) {
  const existingTracks = existingCatalog.tracks || [];
  const catalogByHash = new Map(existingTracks.map(track => [track.sha256, track]));

  const uploadTracks = [];
  const skippedExistingCatalogHashes = [];

  for (const track of tracks) {
    const catalogTrack = catalogByHash.get(track.sha256);
    if (catalogTrack) {
      skippedExistingCatalogHashes.push({
        sourcePath: track.sourcePath,
        fileName: track.fileName,
        sha256: track.sha256,
        existingS3Key: catalogTrack.s3Key,
        reason: 'duplicate-sha256-already-in-catalog',
      });
      continue;
    }

    uploadTracks.push(track);
  }

  return { uploadTracks, skippedExistingCatalogHashes };
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
      return { ...track, uploadedAt: existing.LastModified, uploaded: false, verified: true };
    }
  }

  await run('aws', [
    's3', 'cp',
    track.sourcePath,
    `s3://${BUCKET}/${track.s3Key}`,
    '--content-type', CONTENT_TYPES[`.${track.format}`] || 'application/octet-stream',
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

  return { ...track, uploadedAt: remote.LastModified, uploaded: true, verified: true };
}

async function verifyRemoteTrack(track) {
  const head = await maybeRun('aws', [
    's3api',
    'head-object',
    '--bucket',
    BUCKET,
    '--key',
    track.s3Key,
  ]);

  if (head.failed) {
    return {
      ...track,
      verified: false,
      reason: 'missing-or-head-failed',
      error: head.stderr,
    };
  }

  const remote = JSON.parse(head.stdout);
  const sizeMatches = remote.ContentLength === track.sizeBytes;
  const shaMatches = remote.Metadata?.sha256 === track.sha256;

  return {
    ...track,
    verified: sizeMatches && shaMatches,
    remoteSizeBytes: remote.ContentLength,
    remoteSha256Metadata: remote.Metadata?.sha256 || '',
    sizeMatches,
    shaMatches,
    reason: sizeMatches && shaMatches ? 'verified' : 'metadata-or-size-mismatch',
  };
}

async function readExistingCatalog() {
  try {
    return JSON.parse(await readFile(CATALOG_PATH, 'utf8'));
  } catch {
    return { tracks: [] };
  }
}

async function uploadCatalogFile() {
  await run('aws', [
    's3',
    'cp',
    CATALOG_PATH,
    `s3://${BUCKET}/${PREFIX}/catalog.json`,
    '--content-type',
    'application/json',
    '--cache-control',
    'public, max-age=300',
    '--only-show-errors',
  ]);
}

function mergeCatalogTracks(newTracks, existingTracks) {
  const merged = [];
  const seenKeys = new Set();
  const seenHashes = new Set();

  for (const track of [...newTracks, ...existingTracks]) {
    if (track.s3Key && seenKeys.has(track.s3Key)) continue;
    if (track.sha256 && seenHashes.has(track.sha256)) continue;
    merged.push(track);
    if (track.s3Key) seenKeys.add(track.s3Key);
    if (track.sha256) seenHashes.add(track.sha256);
  }

  return merged;
}

async function writeCatalog(tracks, options = {}) {
  const existing = options.merge ? await readExistingCatalog() : { tracks: [] };
  const catalogTracks = options.merge
    ? mergeCatalogTracks(tracks, existing.tracks || [])
    : tracks;
  const catalog = {
    generatedAt: new Date().toISOString(),
    source: options.merge ? 'merged' : 'render-project',
    bucket: BUCKET,
    prefix: PREFIX,
    publicBaseUrl: PUBLIC_BASE_URL,
    trackCount: catalogTracks.length,
    totalSizeBytes: catalogTracks.reduce((sum, track) => sum + track.sizeBytes, 0),
    tracks: catalogTracks.map(track => ({
      id: track.id,
      title: track.title,
      ...(track.groupTitle ? { groupTitle: track.groupTitle } : {}),
      fileName: track.fileName,
      format: track.format,
      sizeBytes: track.sizeBytes,
      uploadedAt: track.uploadedAt || track.modifiedAt,
      modifiedAt: track.modifiedAt,
      durationSeconds: track.durationSeconds,
      duration: track.duration,
      sha256: track.sha256,
      s3Key: track.s3Key,
      url: track.url,
    })),
  };

  await writeFile(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
  await uploadCatalogFile();
  return catalog;
}

async function scanCommand() {
  await mkdir(TMP_DIR, { recursive: true });
  const scannedTracks = await scanFiles();
  const { uniqueTracks: tracks, skippedExactDuplicates } = dedupeExactTracks(scannedTracks);
  const totalSize = tracks.reduce((sum, track) => sum + track.sizeBytes, 0);
  await writeFile(DRY_RUN_PATH, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    sourceRoots: SOURCE_DIRS,
    sourceManifest: SOURCE_MANIFEST || null,
    bucket: BUCKET,
    prefix: PREFIX,
    extensions: [...AUDIO_EXTENSIONS],
    scannedCount: scannedTracks.length,
    skippedExactDuplicates,
    tracks,
  }, null, 2)}\n`);
  console.log(`Dry run found ${tracks.length} top-level ${[...AUDIO_EXTENSIONS].join('/')} files (${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GiB).`);
  if (skippedExactDuplicates.length > 0) console.log(`Skipped ${skippedExactDuplicates.length} exact source duplicate(s).`);
  console.log(`Wrote ${DRY_RUN_PATH}`);
}

async function verifySourceCommand() {
  await mkdir(TMP_DIR, { recursive: true });
  const scannedTracks = await scanFiles();
  const { uniqueTracks: tracks, skippedExactDuplicates } = dedupeExactTracks(scannedTracks);
  const verified = [];

  for (const [index, track] of tracks.entries()) {
    const result = await verifyRemoteTrack(track);
    verified.push(result);
    if ((index + 1) % 50 === 0 || !result.verified) {
      console.log(`[${index + 1}/${tracks.length}] ${result.reason} ${track.fileName}`);
    }
  }

  const reportPath = join(TMP_DIR, `yng-music-source-verification-${Date.now()}.json`);
  await writeFile(reportPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: 'read-only source-to-S3 verification; no uploads, deletes, or catalog/source mutations performed',
    sourceRoots: SOURCE_DIRS,
    sourceManifest: SOURCE_MANIFEST || null,
    bucket: BUCKET,
    prefix: PREFIX,
    extensions: [...AUDIO_EXTENSIONS],
    scannedCount: scannedTracks.length,
    skippedExactDuplicates,
    verifiedCount: verified.filter(track => track.verified).length,
    failedCount: verified.filter(track => !track.verified).length,
    tracks: verified,
  }, null, 2)}\n`);

  console.log(JSON.stringify({
    reportPath,
    scannedCount: scannedTracks.length,
    uniqueTrackCount: tracks.length,
    skippedExactDuplicateCount: skippedExactDuplicates.length,
    verifiedCount: verified.filter(track => track.verified).length,
    failedCount: verified.filter(track => !track.verified).length,
    allVerified: verified.every(track => track.verified),
  }, null, 2));
}

async function syncCommand() {
  await mkdir(TMP_DIR, { recursive: true });
  const deleteAfterVerify = flags.has('--delete-after-verify');
  const skipCatalog = flags.has('--no-catalog');
  const mergeCatalog = flags.has('--merge-catalog');
  const scannedTracks = await scanFiles();
  const { uniqueTracks, skippedExactDuplicates } = dedupeExactTracks(scannedTracks);
  const existingCatalog = mergeCatalog ? await readExistingCatalog() : { tracks: [] };
  const { uploadTracks: tracks, skippedExistingCatalogHashes } = mergeCatalog
    ? existingCatalogHashSkips(uniqueTracks, existingCatalog)
    : { uploadTracks: uniqueTracks, skippedExistingCatalogHashes: [] };
  const verified = [];

  for (const [index, track] of tracks.entries()) {
    const result = await uploadAndVerify(track);
    verified.push(result);
    console.log(`[${index + 1}/${tracks.length}] verified ${track.fileName}`);
  }

  const shouldWriteCatalog = !skipCatalog && verified.length > 0;
  const catalog = shouldWriteCatalog ? await writeCatalog(verified, { merge: mergeCatalog }) : null;
  const reportPath = join(TMP_DIR, `yng-music-upload-${Date.now()}.json`);
  await writeFile(reportPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    deleteAfterVerify,
    skipCatalog,
    mergeCatalog,
    sourceRoots: SOURCE_DIRS,
    sourceManifest: SOURCE_MANIFEST || null,
    bucket: BUCKET,
    prefix: PREFIX,
    extensions: [...AUDIO_EXTENSIONS],
    scannedCount: scannedTracks.length,
    skippedExactDuplicates,
    skippedExistingCatalogHashes,
    tracks: verified,
  }, null, 2)}\n`);

  if (deleteAfterVerify) {
    await run('npm', ['run', 'build'], { cwd: ROOT });
    for (const track of verified) {
      if (track.verified && existsSync(track.sourcePath)) {
        await rm(track.sourcePath);
      }
    }
  }

  if (shouldWriteCatalog) {
    console.log(`Wrote ${CATALOG_PATH}`);
  } else if (!skipCatalog) {
    console.log('No verified new tracks; left catalog unchanged.');
  }
  console.log(`Wrote ${reportPath}`);
  if (catalog) console.log(`Catalog tracks: ${catalog.trackCount}`);
  if (deleteAfterVerify) console.log('Deleted verified local source files.');
}

if (command === 'setup-bucket') {
  await setupBucket();
} else if (command === 'scan') {
  await scanCommand();
} else if (command === 'upload-catalog') {
  await uploadCatalogFile();
  console.log(`Uploaded ${CATALOG_PATH} to s3://${BUCKET}/${PREFIX}/catalog.json`);
} else if (command === 'verify-source') {
  await verifySourceCommand();
} else if (command === 'sync') {
  await syncCommand();
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
