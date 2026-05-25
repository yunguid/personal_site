#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import catalog from '../src/data/yng-music.json' with { type: 'json' };

const execFileAsync = promisify(execFile);

const TMP_DIR = 'tmp';
const BUCKET = process.env.YNG_MUSIC_BUCKET || catalog.bucket || 'yng-music-archive';
const PREFIX = process.env.YNG_MUSIC_PREFIX || catalog.prefix || 'tracks/render-project';
const CATALOG_PATH = process.env.YNG_MUSIC_CATALOG_PATH || 'src/data/yng-music.json';

function hashText(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function runJson(cmd, args) {
  const { stdout } = await execFileAsync(cmd, args, { maxBuffer: 1024 * 1024 * 50 });
  return JSON.parse(stdout || '{}');
}

async function runText(cmd, args) {
  const { stdout } = await execFileAsync(cmd, args, { maxBuffer: 1024 * 1024 * 50 });
  return stdout;
}

async function headObject(key) {
  try {
    return {
      ok: true,
      head: await runJson('aws', [
        's3api',
        'head-object',
        '--bucket',
        BUCKET,
        '--key',
        key,
      ]),
    };
  } catch (error) {
    return {
      ok: false,
      error: error.stderr || error.message,
    };
  }
}

async function verifyTrack(track, index, total) {
  const result = await headObject(track.s3Key);
  if ((index + 1) % 50 === 0) console.error(`verified ${index + 1}/${total}`);

  if (!result.ok) {
    return {
      ok: false,
      fileName: track.fileName,
      s3Key: track.s3Key,
      sha256: track.sha256,
      reason: 'missing-or-head-failed',
      error: result.error,
    };
  }

  const metadataSha = result.head.Metadata?.sha256 || '';
  const contentLength = Number(result.head.ContentLength || 0);
  const sizeMatches = contentLength === Number(track.sizeBytes);
  const shaMatches = metadataSha === track.sha256;

  return {
    ok: sizeMatches && shaMatches,
    fileName: track.fileName,
    s3Key: track.s3Key,
    sha256: track.sha256,
    expectedSizeBytes: track.sizeBytes,
    remoteSizeBytes: contentLength,
    remoteSha256Metadata: metadataSha,
    sizeMatches,
    shaMatches,
    reason: sizeMatches && shaMatches ? 'verified' : 'metadata-or-size-mismatch',
  };
}

const localCatalogText = await readFile(CATALOG_PATH, 'utf8');
const remoteCatalogText = await runText('aws', [
  's3',
  'cp',
  `s3://${BUCKET}/${PREFIX}/catalog.json`,
  '-',
]);

const localCatalogSha256 = hashText(localCatalogText);
const remoteCatalogSha256 = hashText(remoteCatalogText);
const trackKeys = catalog.tracks.map(track => track.s3Key);
const trackHashes = catalog.tracks.map(track => track.sha256);
const duplicateKeys = trackKeys.length - new Set(trackKeys).size;
const duplicateHashes = trackHashes.length - new Set(trackHashes).size;

const trackResults = [];
for (const [index, track] of catalog.tracks.entries()) {
  trackResults.push(await verifyTrack(track, index, catalog.tracks.length));
}

const failures = trackResults.filter(result => !result.ok);
const report = {
  generatedAt: new Date().toISOString(),
  mode: 'read-only archive verification; no uploads, downloads to disk, deletes, or catalog/source mutations performed',
  bucket: BUCKET,
  prefix: PREFIX,
  localCatalogPath: CATALOG_PATH,
  localCatalogSha256,
  remoteCatalogSha256,
  catalogJsonMatchesRemote: localCatalogSha256 === remoteCatalogSha256,
  trackCountDeclared: catalog.trackCount,
  trackCountActual: catalog.tracks.length,
  duplicateKeys,
  duplicateHashes,
  verifiedTrackCount: trackResults.filter(result => result.ok).length,
  failedTrackCount: failures.length,
  allTracksVerified: failures.length === 0,
  failures,
  tracks: trackResults,
};

await mkdir(TMP_DIR, { recursive: true });
const reportPath = join(TMP_DIR, `music-archive-verification-${Date.now()}.json`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify({
  reportPath: join(process.cwd(), reportPath),
  catalogJsonMatchesRemote: report.catalogJsonMatchesRemote,
  localCatalogSha256,
  remoteCatalogSha256,
  trackCountDeclared: report.trackCountDeclared,
  trackCountActual: report.trackCountActual,
  duplicateKeys,
  duplicateHashes,
  verifiedTrackCount: report.verifiedTrackCount,
  failedTrackCount: report.failedTrackCount,
  allTracksVerified: report.allTracksVerified,
}, null, 2));
