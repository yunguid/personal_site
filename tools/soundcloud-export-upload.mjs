#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT = resolve(import.meta.dirname, '..');
const EXPORT_ROOT = process.env.SOUNDCLOUD_EXPORT_ROOT
  || '/Users/luke/Documents/ChatGPT/music/soundcloud-export';
const MANIFEST_PATH = join(EXPORT_ROOT, 'manifest.csv');
const ORIGINALS_DIR = join(EXPORT_ROOT, 'originals');
const SITE_READY_DIR = join(EXPORT_ROOT, 'site-ready');
const CATALOG_URL = process.env.YNG_MUSIC_CATALOG_URL
  || 'https://yng-music-archive.s3.us-east-1.amazonaws.com/tracks/render-project/catalog.json';
const UPLOAD_API = process.env.YNG_MUSIC_UPLOAD_API || 'https://yng.sh/api/music-upload';
const REPORT_PATH = join(ROOT, 'tmp', 'soundcloud-upload-plan.json');
const command = process.argv[2] || 'plan';
const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
const uploadLimit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted && char === '"' && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += char;
    }
  }

  values.push(value);
  return values;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0] || '');
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
}

function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

function durationSeconds(value) {
  const parts = String(value || '').split(':').map(Number);
  if (parts.length !== 2 || parts.some(part => !Number.isFinite(part))) return 0;
  return (parts[0] * 60) + parts[1];
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

async function audioFingerprint(source) {
  try {
    const { stdout } = await execFileAsync('fpcalc', ['-json', '-length', '120', source], {
      maxBuffer: 1024 * 1024 * 4,
    });
    const result = JSON.parse(stdout);
    return {
      durationSeconds: Number(result.duration) || 0,
      fingerprint: result.fingerprint || '',
    };
  } catch {
    return { durationSeconds: 0, fingerprint: '' };
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
  return payload;
}

async function buildPlan() {
  const [manifestText, catalog] = await Promise.all([
    readFile(MANIFEST_PATH, 'utf8'),
    fetchJson(CATALOG_URL),
  ]);
  const rows = parseCsv(manifestText).filter(row => row.status === 'downloaded');
  const catalogTracks = catalog.tracks || [];
  const catalogByHash = new Map(catalogTracks.map(track => [track.sha256, track]));
  const catalogByTitle = new Map();

  for (const track of catalogTracks) {
    const title = normalizeTitle(track.title || track.fileName);
    catalogByTitle.set(title, [...(catalogByTitle.get(title) || []), track]);
  }

  const seenSourceHashes = new Map();
  const seenSiteReadyHashes = new Map();
  const seenSourceFingerprints = new Map();
  const plan = [];

  for (const row of rows) {
    const filePath = join(ORIGINALS_DIR, row.exported_filename);
    const fileStat = await stat(filePath);
    const actualHash = await sha256(filePath);
    if (actualHash !== row.sha256) {
      throw new Error(`Checksum mismatch for ${filePath}`);
    }
    if (fileStat.size !== Number(row.bytes)) {
      throw new Error(`Size mismatch for ${filePath}`);
    }

    const sourceItem = {
      filePath,
      fileName: basename(filePath),
      format: extname(filePath).slice(1).toLowerCase(),
      sizeBytes: fileStat.size,
      sha256: actualHash,
    };
    const siteReady = await siteReadyItem(sourceItem);
    const previousSource = seenSourceHashes.get(actualHash);
    const previousSiteReady = seenSiteReadyHashes.get(siteReady.sha256);
    const existingTrack = catalogByHash.get(actualHash);
    const existingSiteReadyTrack = catalogByHash.get(siteReady.sha256);
    const titleCandidates = (catalogByTitle.get(normalizeTitle(row.title)) || [])
      .filter(track => Math.abs(Number(track.durationSeconds || 0) - durationSeconds(row.duration)) <= 2);
    const localFingerprint = await audioFingerprint(filePath);
    const fingerprint = localFingerprint.fingerprint;
    const previousFingerprint = seenSourceFingerprints.get(fingerprint);
    let fingerprintDuplicate = null;

    if (
      !previousSource
      && !previousSiteReady
      && !previousFingerprint
      && !existingTrack
      && !existingSiteReadyTrack
      && titleCandidates.length > 0
    ) {
      for (const candidate of titleCandidates) {
        const remoteFingerprint = await audioFingerprint(candidate.url);
        if (fingerprint && fingerprint === remoteFingerprint.fingerprint) {
          fingerprintDuplicate = candidate;
          break;
        }
      }
    }

    let decision = 'upload';
    let reason = 'new-verified-original';
    let duplicateOf = null;

    if (previousSource) {
      decision = 'skip-clear-duplicate';
      reason = 'duplicate-sha256-in-soundcloud-export';
      duplicateOf = previousSource;
    } else if (previousSiteReady) {
      decision = 'skip-clear-duplicate';
      reason = 'duplicate-site-ready-sha256-in-soundcloud-export';
      duplicateOf = previousSiteReady;
    } else if (
      previousFingerprint
      && Math.abs(previousFingerprint.fingerprintDurationSeconds - localFingerprint.durationSeconds) <= 2
    ) {
      decision = 'skip-clear-duplicate';
      reason = 'matching-chromaprint-in-soundcloud-export';
      duplicateOf = previousFingerprint;
    } else if (existingTrack) {
      decision = 'skip-clear-duplicate';
      reason = 'duplicate-sha256-already-in-s3-catalog';
      duplicateOf = existingTrack;
    } else if (existingSiteReadyTrack) {
      decision = 'skip-clear-duplicate';
      reason = 'duplicate-site-ready-sha256-already-in-s3-catalog';
      duplicateOf = existingSiteReadyTrack;
    } else if (fingerprintDuplicate) {
      decision = 'skip-clear-duplicate';
      reason = 'matching-chromaprint-already-in-s3-catalog';
      duplicateOf = fingerprintDuplicate;
    } else if (titleCandidates.length > 0) {
      decision = 'upload-review-candidate';
      reason = 'same-title-and-duration-but-audio-not-proven-identical';
    }

    const item = {
      index: Number(row.index),
      title: row.title,
      sourceUrl: row.source_url,
      uploadDate: row.upload_date,
      duration: row.duration,
      privacy: row.privacy,
      filePath,
      fileName: basename(filePath),
      format: extname(filePath).slice(1).toLowerCase(),
      sizeBytes: fileStat.size,
      sha256: actualHash,
      siteReadySha256: siteReady.sha256,
      fingerprint,
      fingerprintDurationSeconds: localFingerprint.durationSeconds,
      decision,
      reason,
      duplicateOf: duplicateOf ? {
        index: duplicateOf.index,
        title: duplicateOf.title,
        fileName: duplicateOf.fileName,
        s3Key: duplicateOf.s3Key,
        sha256: duplicateOf.sha256,
      } : null,
      reviewCandidates: titleCandidates.map(track => ({
        title: track.title,
        duration: track.duration,
        sha256: track.sha256,
        s3Key: track.s3Key,
      })),
    };
    plan.push(item);
    if (!seenSourceHashes.has(actualHash)) seenSourceHashes.set(actualHash, item);
    if (!seenSiteReadyHashes.has(siteReady.sha256)) {
      seenSiteReadyHashes.set(siteReady.sha256, item);
    }
    if (fingerprint && !seenSourceFingerprints.has(fingerprint)) {
      seenSourceFingerprints.set(fingerprint, item);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    exportRoot: EXPORT_ROOT,
    manifestPath: MANIFEST_PATH,
    catalogUrl: CATALOG_URL,
    catalogTrackCount: catalogTracks.length,
    manifestTrackCount: rows.length,
    uploadCount: plan.filter(item => item.decision.startsWith('upload')).length,
    clearDuplicateCount: plan.filter(item => item.decision === 'skip-clear-duplicate').length,
    reviewCandidateCount: plan.filter(item => item.decision === 'upload-review-candidate').length,
    tracks: plan,
  };
}

async function postUploadAction(body, key) {
  return fetchJson(UPLOAD_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-yng-upload-key': key,
    },
    body: JSON.stringify(body),
  });
}

async function uploadTrack(item, key) {
  const uploadItem = await siteReadyItem(item);
  const contentType = uploadItem.format === 'mp3' ? 'audio/mpeg' : 'audio/wav';
  const base = {
    action: 'sign',
    title: item.title,
    fileName: uploadItem.fileName,
    contentType,
    sizeBytes: uploadItem.sizeBytes,
    sha256: uploadItem.sha256,
    durationSeconds: durationSeconds(item.duration),
  };
  const signed = await postUploadAction(base, key);
  const uploadResponse = await fetch(signed.uploadUrl, {
    method: 'PUT',
    headers: signed.headers,
    body: createReadStream(uploadItem.filePath),
    duplex: 'half',
  });
  if (!uploadResponse.ok) {
    throw new Error(`S3 upload failed for ${item.fileName}: ${uploadResponse.status}`);
  }
  return postUploadAction({ ...base, action: 'complete' }, key);
}

async function siteReadyItem(item) {
  if (!new Set(['aif', 'aiff']).has(item.format)) return item;

  await mkdir(SITE_READY_DIR, { recursive: true });
  const fileName = `${basename(item.fileName, extname(item.fileName))}.wav`;
  const filePath = join(SITE_READY_DIR, fileName);
  const probe = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=codec_name',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    item.filePath,
  ]);
  const sourceCodec = probe.stdout.trim();
  const wavCodec = sourceCodec.replace(/be$/, 'le');
  if (!/^pcm_(?:s|u|f)\d+le$/.test(wavCodec)) {
    throw new Error(`Unsupported AIFF codec ${sourceCodec} for ${item.fileName}`);
  }
  await execFileAsync('ffmpeg', [
    '-v', 'error', '-y',
    '-i', item.filePath,
    '-map', '0:a:0',
    '-c:a', wavCodec,
    filePath,
  ]);
  const fileStat = await stat(filePath);
  return {
    ...item,
    fileName,
    filePath,
    format: 'wav',
    sizeBytes: fileStat.size,
    sha256: await sha256(filePath),
  };
}

function safeDisplayName(value) {
  return String(value || 'Untitled')
    .replace(/[/\\:]/g, '-')
    .replace(/[\u0000-\u001f]/g, '')
    .trim() || 'Untitled';
}

async function prepareBrowserBatch(items) {
  const first = String(items[0]?.index || 0).padStart(6, '0');
  const last = String(items.at(-1)?.index || 0).padStart(6, '0');
  const batchDir = join(SITE_READY_DIR, 'batches', `${first}-${last}`);
  const titleCounts = new Map();
  const files = [];
  await mkdir(batchDir, { recursive: true });

  for (const item of items) {
    const count = (titleCounts.get(item.title) || 0) + 1;
    titleCounts.set(item.title, count);
    const extension = new Set(['aif', 'aiff']).has(item.format) ? '.wav' : extname(item.fileName);
    const suffix = count === 1 ? '' : ` (${count})`;
    const targetPath = join(batchDir, `${safeDisplayName(item.title)}${suffix}${extension}`);

    if (new Set(['aif', 'aiff']).has(item.format)) {
      const converted = await siteReadyItem(item);
      try {
        await link(converted.filePath, targetPath);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    } else {
      try {
        await link(item.filePath, targetPath);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    files.push(targetPath);
  }

  const listPath = join(ROOT, 'tmp', 'soundcloud-browser-upload-files.json');
  await writeFile(listPath, `${JSON.stringify({ batchDir, files }, null, 2)}\n`);
  return { batchDir, files, listPath };
}

await mkdir(join(ROOT, 'tmp'), { recursive: true });
const report = await buildPlan();
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Verified ${report.manifestTrackCount} SoundCloud originals against ${report.catalogTrackCount} catalog tracks.`);
console.log(`${report.uploadCount} queued; ${report.clearDuplicateCount} clear duplicate(s) skipped; ${report.reviewCandidateCount} uncertain match(es) retained.`);
console.log(`Wrote ${REPORT_PATH}`);

if (command === 'prepare') {
  const queue = report.tracks.filter(item => item.decision.startsWith('upload')).slice(0, uploadLimit);
  const prepared = await prepareBrowserBatch(queue);
  console.log(`Prepared ${prepared.files.length} browser-upload files in ${prepared.batchDir}`);
  console.log(`Wrote ${prepared.listPath}`);
} else if (command === 'upload') {
  const key = process.env.YNG_MUSIC_UPLOAD_KEY;
  if (!key) throw new Error('YNG_MUSIC_UPLOAD_KEY is required for upload.');
  const queue = report.tracks.filter(item => item.decision.startsWith('upload')).slice(0, uploadLimit);

  for (const [index, item] of queue.entries()) {
    await uploadTrack(item, key);
    console.log(`[${index + 1}/${queue.length}] uploaded ${item.title}`);
  }
}
