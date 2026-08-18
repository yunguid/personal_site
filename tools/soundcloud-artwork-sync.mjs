#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const EXPORT_ROOT = process.env.YNG_SOUNDCLOUD_EXPORT_ROOT
  || '/Users/luke/Documents/ChatGPT/music/soundcloud-export';
const ARTWORK_MANIFEST = resolve(process.env.YNG_SOUNDCLOUD_ARTWORK_MANIFEST
  || join(EXPORT_ROOT, 'artwork/artwork-manifest.json'));
const UPLOAD_PLAN = resolve(process.env.YNG_SOUNDCLOUD_UPLOAD_PLAN
  || join(ROOT, 'tmp/soundcloud-upload-plan.json'));
const BUCKET = process.env.YNG_MUSIC_BUCKET || 'yng-music-archive';
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
const PREFIX = process.env.YNG_MUSIC_PREFIX || 'tracks/render-project';
const CATALOG_KEY = `${PREFIX}/catalog.json`;
const PUBLIC_BASE_URL = `https://${BUCKET}.s3.${REGION}.amazonaws.com`;
const TMP_DIR = join(ROOT, 'tmp');
const LIVE_CATALOG_PATH = join(TMP_DIR, 'soundcloud-artwork-live-catalog.json');
const REPORT_PATH = join(TMP_DIR, 'soundcloud-artwork-sync-report.json');
const command = process.argv[2] || 'plan';

const CONTENT_TYPES = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

async function run(program, args) {
  const { stdout, stderr } = await execFileAsync(program, args, {
    maxBuffer: 20 * 1024 * 1024,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
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

function publicUrlForKey(key) {
  return `${PUBLIC_BASE_URL}/${encodeURI(key).replace(/%2F/g, '/')}`;
}

function manifestRows(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['tracks', 'rows', 'artwork']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  throw new Error('Artwork manifest must be an array or contain tracks/rows/artwork.');
}

function normalizedStatus(row) {
  return String(row.status || row.artworkStatus || row.confidence || 'unknown').trim().toLowerCase();
}

function isReviewStatus(status) {
  return /uncertain|review|ambiguous|possible|low.confidence/.test(status);
}

function isConfirmedStatus(status) {
  return !isReviewStatus(status) && !/blocked|missing|none|unavailable|no.artwork|fallback/.test(status);
}

function localArtworkPath(row) {
  const value = row.localPath || row.filePath || row.path || row.localFilename || row.fileName || '';
  if (!value) return '';
  const directPath = resolve(dirname(ARTWORK_MANIFEST), value);
  if (existsSync(directPath)) return directPath;
  return resolve(dirname(ARTWORK_MANIFEST), 'originals', value);
}

async function normalizeArtworkRows(rows) {
  const normalized = [];

  for (const row of rows) {
    const index = Number(row.index ?? row.exportIndex ?? row.trackIndex);
    const status = normalizedStatus(row);
    const filePath = localArtworkPath(row);
    const hasFile = filePath && existsSync(filePath);
    let file = null;

    if (hasFile) {
      const extension = extname(filePath).toLowerCase();
      const contentType = String(row.mimeType || row.contentType || CONTENT_TYPES[extension] || '');
      if (!contentType.startsWith('image/')) {
        throw new Error(`Unsupported artwork format for ${filePath}`);
      }
      const fileStat = await stat(filePath);
      const actualSha256 = await sha256(filePath);
      const declaredSha256 = String(row.sha256 || '').toLowerCase();
      if (declaredSha256 && declaredSha256 !== actualSha256) {
        throw new Error(`Artwork checksum mismatch for ${filePath}`);
      }
      const key = `${PREFIX}/artwork/${actualSha256.slice(0, 20)}${extension}`;
      file = {
        filePath,
        extension,
        contentType,
        sizeBytes: fileStat.size,
        sha256: actualSha256,
        s3Key: key,
        url: publicUrlForKey(key),
      };
    }

    normalized.push({
      index,
      title: String(row.title || ''),
      soundcloudUrl: String(row.soundcloudUrl || row.sourceUrl || row.trackUrl || ''),
      artworkSourceUrl: String(row.artworkSourceUrl || row.imageUrl || row.remoteUrl || ''),
      status,
      confidence: String(row.confidence || ''),
      notes: String(row.notes || ''),
      width: Number(row.width) || null,
      height: Number(row.height) || null,
      file,
    });
  }

  return normalized;
}

async function readLiveCatalog() {
  await run('aws', [
    's3', 'cp',
    `s3://${BUCKET}/${CATALOG_KEY}`,
    LIVE_CATALOG_PATH,
    '--only-show-errors',
  ]);
  return JSON.parse(await readFile(LIVE_CATALOG_PATH, 'utf8'));
}

function buildPlanResolver(plan, catalog) {
  const tracks = plan.tracks || [];
  const byIndex = new Map(tracks.map(track => [Number(track.index), track]));
  const bySourceUrl = new Map(tracks.filter(track => track.sourceUrl).map(track => [track.sourceUrl, track]));
  const catalogByHash = new Map((catalog.tracks || []).map(track => [track.sha256, track]));

  function resolveTrack(row) {
    let planTrack = byIndex.get(row.index) || bySourceUrl.get(row.soundcloudUrl);
    const visited = new Set();

    while (planTrack && planTrack.duplicateOf?.index && !planTrack.duplicateOf?.s3Key) {
      if (visited.has(planTrack.index)) break;
      visited.add(planTrack.index);
      planTrack = byIndex.get(Number(planTrack.duplicateOf.index));
    }

    const s3Key = planTrack?.duplicateOf?.s3Key
      || catalogByHash.get(planTrack?.siteReadySha256)?.s3Key
      || catalogByHash.get(planTrack?.sha256)?.s3Key
      || '';
    return { planTrack, s3Key };
  }

  return resolveTrack;
}

function compareMappings(a, b) {
  const aReview = isReviewStatus(a.status) ? 1 : 0;
  const bReview = isReviewStatus(b.status) ? 1 : 0;
  return aReview - bReview || a.index - b.index;
}

async function uploadAndVerify(file) {
  await run('aws', [
    's3', 'cp',
    file.filePath,
    `s3://${BUCKET}/${file.s3Key}`,
    '--content-type', file.contentType,
    '--metadata', `sha256=${file.sha256}`,
    '--cache-control', 'public, max-age=31536000, immutable',
    '--only-show-errors',
  ]);
  const head = JSON.parse((await run('aws', [
    's3api', 'head-object',
    '--bucket', BUCKET,
    '--key', file.s3Key,
    '--output', 'json',
  ])).stdout);
  if (head.ContentLength !== file.sizeBytes || head.Metadata?.sha256 !== file.sha256) {
    throw new Error(`Artwork verification failed for ${file.s3Key}`);
  }
}

async function uploadCatalog(catalog) {
  await writeFile(LIVE_CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
  await run('aws', [
    's3', 'cp',
    LIVE_CATALOG_PATH,
    `s3://${BUCKET}/${CATALOG_KEY}`,
    '--content-type', 'application/json',
    '--cache-control', 'public, max-age=300',
    '--only-show-errors',
  ]);
}

async function main() {
  if (!new Set(['plan', 'sync']).has(command)) {
    throw new Error(`Unknown command: ${command}`);
  }
  if (!existsSync(ARTWORK_MANIFEST)) {
    throw new Error(`Artwork manifest not found: ${ARTWORK_MANIFEST}`);
  }

  await mkdir(TMP_DIR, { recursive: true });
  const [artworkPayload, uploadPlan, catalog] = await Promise.all([
    readFile(ARTWORK_MANIFEST, 'utf8').then(JSON.parse),
    readFile(UPLOAD_PLAN, 'utf8').then(JSON.parse),
    readLiveCatalog(),
  ]);
  const artworkRows = await normalizeArtworkRows(manifestRows(artworkPayload));
  const resolveTrack = buildPlanResolver(uploadPlan, catalog);
  const mappings = artworkRows.map(row => {
    const resolved = resolveTrack(row);
    return { ...row, targetS3Key: resolved.s3Key };
  });
  const mapped = mappings.filter(row => row.targetS3Key);
  const unmapped = mappings.filter(row => !row.targetS3Key);
  const uniqueFiles = [...new Map(
    mapped
      .filter(row => row.file && isConfirmedStatus(row.status))
      .map(row => [row.file.sha256, row.file])
  ).values()];

  if (command === 'sync') {
    let completed = 0;
    const nextFiles = [...uniqueFiles];
    const workers = Array.from({ length: Math.min(6, nextFiles.length) }, async () => {
      while (nextFiles.length) {
        const file = nextFiles.shift();
        await uploadAndVerify(file);
        completed += 1;
        console.log(`[${completed}/${uniqueFiles.length}] verified ${file.s3Key}`);
      }
    });
    await Promise.all(workers);
  }

  const mappingsByTrack = new Map();
  for (const mapping of mapped) {
    const group = mappingsByTrack.get(mapping.targetS3Key) || [];
    group.push(mapping);
    mappingsByTrack.set(mapping.targetS3Key, group);
  }

  let enrichedTrackCount = 0;
  let visibleArtworkCount = 0;
  const tracks = (catalog.tracks || []).map(track => {
    const group = (mappingsByTrack.get(track.s3Key) || []).sort(compareMappings);
    if (!group.length) return track;
    enrichedTrackCount += 1;
    const confirmed = group.find(row => row.file && isConfirmedStatus(row.status));
    if (confirmed) visibleArtworkCount += 1;
    const variants = group.map(row => ({
      index: row.index,
      title: row.title,
      soundcloudUrl: row.soundcloudUrl,
      artworkSourceUrl: row.artworkSourceUrl,
      status: row.status,
      confidence: row.confidence,
      notes: row.notes,
      width: row.width,
      height: row.height,
      ...(row.file ? {
        sha256: row.file.sha256,
        sizeBytes: row.file.sizeBytes,
        ...(isConfirmedStatus(row.status) ? { url: row.file.url } : {}),
      } : {}),
    }));
    const primary = confirmed || group[0];
    return {
      ...track,
      soundcloudIndex: primary.index,
      soundcloudUrl: primary.soundcloudUrl,
      artworkStatus: confirmed ? confirmed.status : primary.status,
      ...(confirmed ? { artworkUrl: confirmed.file.url } : {}),
      artworkVariants: variants,
    };
  });
  const enrichedCatalog = {
    ...catalog,
    generatedAt: new Date().toISOString(),
    tracks,
  };

  if (command === 'sync') await uploadCatalog(enrichedCatalog);

  const report = {
    generatedAt: new Date().toISOString(),
    mode: command,
    artworkManifest: ARTWORK_MANIFEST,
    manifestRows: artworkRows.length,
    mappedRows: mapped.length,
    unmappedRows: unmapped.map(row => ({
      index: row.index,
      title: row.title,
      soundcloudUrl: row.soundcloudUrl,
      status: row.status,
      notes: row.notes,
    })),
    uniqueArtworkFiles: uniqueFiles.length,
    enrichedTrackCount,
    visibleArtworkCount,
    catalogTrackCount: tracks.length,
  };
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
