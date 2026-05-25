#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import catalog from '../src/data/yng-music.json' with { type: 'json' };

const execFileAsync = promisify(execFile);

const TMP_DIR = 'tmp';
const PLAN_TSV = process.env.ABLETON_EXPORT_READY_TSV || join(TMP_DIR, 'ableton-export-ready-all.tsv');
const UPLOAD_MANIFEST = join(TMP_DIR, 'ableton-rendered-upload-manifest.tsv');
const PROGRESS_TSV = join(TMP_DIR, 'ableton-export-progress.tsv');

function parseTsv(text) {
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length === 0) return [];
  const headers = lines[0].split('\t');

  return lines.slice(1).map(line => {
    const values = line.split('\t');
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
}

function tsvEscape(value) {
  return String(value ?? '').replaceAll('\t', ' ').replaceAll('\n', ' ');
}

function rowsToTsv(headers, rows) {
  return `${[
    headers,
    ...rows.map(row => headers.map(header => row[header] ?? '')),
  ].map(row => row.map(tsvEscape).join('\t')).join('\n')}\n`;
}

function slugify(value) {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();

  return slug || 'untitled';
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    createReadStream(filePath)
      .on('data', chunk => hash.update(chunk))
      .on('error', reject)
      .on('end', resolve);
  });
  return hash.digest('hex');
}

async function durationSeconds(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], { maxBuffer: 1024 * 1024 });
    const parsed = Number(stdout.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function uploadKey(filePath, hash) {
  const ext = extname(filePath).toLowerCase();
  return `${catalog.prefix}/${slugify(basename(filePath, ext))}-${hash.slice(0, 12)}${ext}`;
}

const catalogByHash = new Map(catalog.tracks.map(track => [track.sha256, track]));
const planRows = parseTsv(await readFile(PLAN_TSV, 'utf8'));
const seenRenderedHashes = new Map();
const progressRows = [];

for (const row of planRows) {
  const expectedPath = row.expected_wav_path;
  const base = {
    project_file_name: row.project_file_name,
    project_path: row.project_path,
    expected_wav_path: expectedPath,
    evidence_status: row.evidence_status,
    export_readiness_status: row.export_readiness_status,
    content_status: row.content_status,
    expected_wav_exists: existsSync(expectedPath) ? 'yes' : 'no',
    size_bytes: '',
    duration_seconds: '',
    sha256: '',
    s3_key: '',
    status: 'not-rendered',
    reason: 'expected WAV is not present yet',
  };

  if (!existsSync(expectedPath)) {
    progressRows.push(base);
    continue;
  }

  const fileStat = await stat(expectedPath);
  const hash = await sha256(expectedPath);
  const duration = await durationSeconds(expectedPath);
  const catalogMatch = catalogByHash.get(hash);
  const firstRenderedPath = seenRenderedHashes.get(hash);
  seenRenderedHashes.set(hash, firstRenderedPath || expectedPath);

  const rendered = {
    ...base,
    size_bytes: fileStat.size,
    duration_seconds: duration,
    sha256: hash,
    s3_key: uploadKey(expectedPath, hash),
  };

  if (catalogMatch) {
    progressRows.push({
      ...rendered,
      status: 'already-in-catalog-by-sha256',
      reason: catalogMatch.s3Key,
    });
  } else if (firstRenderedPath && firstRenderedPath !== expectedPath) {
    progressRows.push({
      ...rendered,
      status: 'duplicate-render-sha256',
      reason: firstRenderedPath,
    });
  } else if (fileStat.size <= 44 || duration <= 0) {
    progressRows.push({
      ...rendered,
      status: 'suspicious-render-needs-review',
      reason: 'file has no measurable audio duration',
    });
  } else {
    progressRows.push({
      ...rendered,
      status: 'ready-for-upload',
      reason: 'new rendered WAV with unique sha256',
    });
  }
}

const uploadRows = progressRows
  .filter(row => row.status === 'ready-for-upload')
  .map(row => ({
    decision: 'approve',
    path: row.expected_wav_path,
    project_path: row.project_path,
    project_file_name: row.project_file_name,
    sha256: row.sha256,
    reason: row.reason,
  }));

const counts = progressRows.reduce((acc, row) => {
  acc[row.status] = (acc[row.status] || 0) + 1;
  return acc;
}, {});

const report = {
  generatedAt: new Date().toISOString(),
  mode: 'read-only Ableton export progress; no exports, uploads, deletes, or catalog/source mutations performed',
  sourcePlanTsv: PLAN_TSV,
  uploadManifestPath: UPLOAD_MANIFEST,
  progressTsvPath: PROGRESS_TSV,
  plannedCount: planRows.length,
  renderedCount: progressRows.filter(row => row.expected_wav_exists === 'yes').length,
  uploadReadyCount: uploadRows.length,
  counts,
  rows: progressRows,
};

await mkdir(TMP_DIR, { recursive: true });
const stamp = Date.now();
const reportPath = join(TMP_DIR, `ableton-export-progress-${stamp}.json`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(PROGRESS_TSV, rowsToTsv([
  'status',
  'reason',
  'project_file_name',
  'project_path',
  'expected_wav_path',
  'expected_wav_exists',
  'size_bytes',
  'duration_seconds',
  'sha256',
  's3_key',
  'evidence_status',
  'export_readiness_status',
  'content_status',
], progressRows));
await writeFile(UPLOAD_MANIFEST, rowsToTsv([
  'decision',
  'path',
  'project_path',
  'project_file_name',
  'sha256',
  'reason',
], uploadRows));

console.log(JSON.stringify({
  reportPath: join(process.cwd(), reportPath),
  progressTsvPath: join(process.cwd(), PROGRESS_TSV),
  uploadManifestPath: join(process.cwd(), UPLOAD_MANIFEST),
  plannedCount: report.plannedCount,
  renderedCount: report.renderedCount,
  uploadReadyCount: report.uploadReadyCount,
  counts: report.counts,
}, null, 2));
