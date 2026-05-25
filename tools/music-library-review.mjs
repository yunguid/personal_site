#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import catalog from '../src/data/yng-music.json' with { type: 'json' };

const execFileAsync = promisify(execFile);

const TMP_DIR = 'tmp';
const AUDIO_EXTENSIONS = new Set(['.aif', '.aiff', '.wav', '.mp3']);
const REVIEW_DIRS = (process.env.YNG_MUSIC_REVIEW_DIRS || '/Users/luke/Music/Music/Media.localized/Music/Unknown Artist/Unknown Album')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\p{L}\p{N}\s.-]+/gu, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
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

async function latestFile(prefix) {
  try {
    const files = (await readdir(TMP_DIR))
      .filter(name => name.startsWith(prefix) && name.endsWith('.json'))
      .sort();
    return files.length ? join(TMP_DIR, files.at(-1)) : null;
  } catch {
    return null;
  }
}

async function readLatestSoundCloudReport() {
  const path = await latestFile('soundcloud-owner-track-report-');
  if (!path) return { path: null, tracks: [] };
  const report = JSON.parse(await readFile(path, 'utf8'));
  return { path, tracks: report.tracks || [] };
}

async function listOlderHomepageKeys() {
  try {
    const { stdout } = await execFileAsync('aws', [
      's3api',
      'list-objects-v2',
      '--bucket',
      'lukemusicbucket',
    ], { maxBuffer: 1024 * 1024 * 10 });
    return (JSON.parse(stdout || '{}').Contents || []).map(item => item.Key);
  } catch {
    return [];
  }
}

function catalogNameIndex() {
  const index = new Map();

  for (const track of catalog.tracks) {
    for (const value of [track.title, track.fileName, track.s3Key]) {
      const key = normalize(basename(String(value || ''), extname(String(value || ''))));
      if (!key) continue;
      index.set(key, [
        ...(index.get(key) || []),
        {
          title: track.title,
          fileName: track.fileName,
          s3Key: track.s3Key,
          sha256: track.sha256,
        },
      ]);
    }
  }

  return index;
}

function soundCloudMatches(normalizedName, soundCloudTracks) {
  return soundCloudTracks.flatMap(track => {
    const normalizedTitle = normalize(track.title);
    if (!normalizedTitle) return [];
    if (normalizedName === normalizedTitle) return [{ ...track, matchType: 'exact-title' }];
    if (normalizedName.includes(normalizedTitle) || normalizedTitle.includes(normalizedName)) {
      return [{ ...track, matchType: 'contains-title' }];
    }
    return [];
  });
}

async function scanReviewAudio() {
  const items = [];

  for (const root of REVIEW_DIRS) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = extname(entry.name).toLowerCase();
      if (!AUDIO_EXTENSIONS.has(ext)) continue;

      const path = join(root, entry.name);
      const fileStat = await stat(path);
      items.push({
        path,
        root,
        fileName: entry.name,
        normalizedBase: normalize(basename(entry.name, ext)),
        ext,
        sizeBytes: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
      });
    }
  }

  return items;
}

function classify(item) {
  if (item.exactCatalogMatch) return 'already-in-archive-by-sha256';
  if (item.catalogNameMatchCount > 0) return 'possible-archive-duplicate-by-name';
  if (item.soundCloudMatches.some(match => match.matchType === 'exact-title')) return 'soundcloud-title-match-needs-owner-review';
  if (item.olderHomepageNameMatches.length > 0) return 'older-homepage-name-match-needs-review';
  if (item.soundCloudMatches.length > 0) return 'loose-soundcloud-title-match-needs-review';
  return 'needs-owner-review-before-upload';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function mb(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(1)} MB`;
}

function renderReviewHtml(report, approvalTemplatePath) {
  const rows = report.candidates
    .map(item => {
      const matches = [
        ...item.soundCloudMatches.map(match => `SoundCloud: ${match.title} (${match.matchType})`),
        ...item.olderHomepageNameMatches.map(match => `old bucket: ${match}`),
        item.catalogNameMatchCount > 0 ? `archive name matches: ${item.catalogNameMatchCount}` : '',
        item.exactSourceDuplicateOf ? `source duplicate of: ${item.exactSourceDuplicateOf}` : '',
      ].filter(Boolean).join('<br>');
      const audioSrc = pathToFileURL(item.path).href;

      return `<tr data-status="${escapeHtml(item.reviewStatus)}">
        <td class="status">${escapeHtml(item.reviewStatus)}</td>
        <td class="decision">${escapeHtml(item.uploadEligibility)}</td>
        <td>
          <div class="name">${escapeHtml(item.fileName)}</div>
          <div class="meta">${escapeHtml(item.ext)} · ${escapeHtml(mb(item.sizeBytes))} · ${escapeHtml(item.sha256.slice(0, 12))}</div>
        </td>
        <td><audio controls preload="none" src="${escapeHtml(audioSrc)}"></audio></td>
        <td class="matches">${matches || '&nbsp;'}</td>
        <td><code>${escapeHtml(item.path)}</code></td>
      </tr>`;
    })
    .join('\n');

  const statusButtons = Object.entries(report.byReviewStatus)
    .map(([status, count]) => `<button type="button" data-filter="${escapeHtml(status)}">${escapeHtml(status)} (${count})</button>`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Music Library Review</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f7f7f4; color: #171717; }
    header { position: sticky; top: 0; z-index: 2; background: #fffffb; border-bottom: 1px solid #d8d6cf; padding: 16px 20px; }
    h1 { margin: 0 0 8px; font-size: 22px; font-weight: 650; }
    .summary { display: flex; flex-wrap: wrap; gap: 12px; font-size: 13px; color: #555; }
    .filters { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    button { border: 1px solid #bbb7ad; background: #fff; border-radius: 6px; padding: 7px 10px; font: inherit; cursor: pointer; }
    button.active { background: #171717; border-color: #171717; color: #fff; }
    main { padding: 18px 20px 32px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d8d6cf; }
    th, td { border-bottom: 1px solid #e4e2dc; padding: 10px; text-align: left; vertical-align: top; font-size: 13px; }
    th { background: #efeee9; position: sticky; top: 105px; z-index: 1; }
    audio { width: 260px; max-width: 28vw; }
    code { white-space: pre-wrap; word-break: break-word; font-size: 11px; color: #555; }
    .name { font-weight: 650; max-width: 280px; word-break: break-word; }
    .meta, .matches { color: #666; line-height: 1.35; }
    .status, .decision { white-space: nowrap; }
    tr.hidden { display: none; }
    @media (max-width: 900px) {
      th:nth-child(6), td:nth-child(6) { display: none; }
      audio { max-width: 100%; width: 190px; }
      th { top: 138px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Music Library Review</h1>
    <div class="summary">
      <span>${report.scannedCount} files scanned</span>
      <span>${report.uniqueHashes} unique hashes</span>
      <span>${report.duplicateHashes} duplicate hashes</span>
      <span>Approval template: <code>${escapeHtml(approvalTemplatePath)}</code></span>
    </div>
    <div class="filters">
      <button type="button" data-filter="all" class="active">All (${report.scannedCount})</button>
      ${statusButtons}
    </div>
  </header>
  <main>
    <table>
      <thead>
        <tr>
          <th>Status</th>
          <th>Eligibility</th>
          <th>File</th>
          <th>Listen</th>
          <th>Matches</th>
          <th>Path</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </main>
  <script>
    const buttons = [...document.querySelectorAll('button[data-filter]')];
    const rows = [...document.querySelectorAll('tbody tr')];
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const filter = button.dataset.filter;
        for (const item of buttons) item.classList.toggle('active', item === button);
        for (const row of rows) row.classList.toggle('hidden', filter !== 'all' && row.dataset.status !== filter);
      });
    }
  </script>
</body>
</html>
`;
}

const catalogHashes = new Set(catalog.tracks.map(track => track.sha256));
const catalogNames = catalogNameIndex();
const { path: soundCloudReportPath, tracks: soundCloudTracks } = await readLatestSoundCloudReport();
const olderHomepageKeys = await listOlderHomepageKeys();
const olderHomepageNames = new Map(olderHomepageKeys.map(key => [
  normalize(basename(key, extname(key))),
  key,
]));

const scanned = await scanReviewAudio();
const seenHashes = new Map();
const candidates = [];

for (const [index, item] of scanned.entries()) {
  item.sha256 = await sha256(item.path);
  if ((index + 1) % 50 === 0) console.error(`hashed ${index + 1}/${scanned.length}`);

  const catalogMatches = catalogNames.get(item.normalizedBase) || [];
  const scMatches = soundCloudMatches(item.normalizedBase, soundCloudTracks);
  const oldHomepageMatch = olderHomepageNames.get(item.normalizedBase);
  const duplicateOf = seenHashes.get(item.sha256);

  const candidate = {
    ...item,
    exactCatalogMatch: catalogHashes.has(item.sha256),
    exactSourceDuplicateOf: duplicateOf || null,
    catalogNameMatchCount: catalogMatches.length,
    catalogNameMatches: catalogMatches.slice(0, 5),
    soundCloudMatches: scMatches.map(match => ({
      id: match.id,
      title: match.title,
      url: match.url,
      matchType: match.matchType,
    })),
    olderHomepageNameMatches: oldHomepageMatch ? [oldHomepageMatch] : [],
  };
  candidate.reviewStatus = classify(candidate);
  candidate.uploadEligibility = candidate.reviewStatus === 'already-in-archive-by-sha256'
    ? 'skip'
    : 'manual-review-required';

  candidates.push(candidate);
  if (!duplicateOf) seenHashes.set(item.sha256, item.path);
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: 'read-only library audio review; no uploads, downloads, deletes, or catalog/source mutations performed',
  reviewDirs: REVIEW_DIRS,
  sourceSoundCloudReport: soundCloudReportPath,
  scannedCount: scanned.length,
  uniqueHashes: new Set(candidates.map(item => item.sha256)).size,
  duplicateHashes: scanned.length - new Set(candidates.map(item => item.sha256)).size,
  byExtension: candidates.reduce((acc, item) => {
    acc[item.ext] = (acc[item.ext] || 0) + 1;
    return acc;
  }, {}),
  byReviewStatus: candidates.reduce((acc, item) => {
    acc[item.reviewStatus] = (acc[item.reviewStatus] || 0) + 1;
    return acc;
  }, {}),
  candidates,
};

await mkdir(TMP_DIR, { recursive: true });
const artifactTimestamp = Date.now();
const reportPath = join(TMP_DIR, `music-library-review-${artifactTimestamp}.json`);
const reviewTsvPath = join(TMP_DIR, `music-library-review-${artifactTimestamp}.tsv`);
const approvalTemplatePath = join(TMP_DIR, `music-library-approval-template-${artifactTimestamp}.tsv`);
const reviewHtmlPath = join(TMP_DIR, `music-library-review-${artifactTimestamp}.html`);
const approvalWorkingPath = join(TMP_DIR, 'music-library-approval.tsv');
const stableReviewHtmlPath = join(TMP_DIR, 'music-library-review.html');
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

const reviewRows = [
  [
    'review_status',
    'upload_eligibility',
    'file_name',
    'ext',
    'size_bytes',
    'exact_catalog_match',
    'catalog_name_match_count',
    'soundcloud_matches',
    'older_homepage_matches',
    'exact_source_duplicate_of',
    'path',
  ],
  ...candidates.map(item => [
    item.reviewStatus,
    item.uploadEligibility,
    item.fileName,
    item.ext,
    item.sizeBytes,
    item.exactCatalogMatch,
    item.catalogNameMatchCount,
    item.soundCloudMatches.map(match => `${match.title} (${match.matchType})`).join('; '),
    item.olderHomepageNameMatches.join('; '),
    item.exactSourceDuplicateOf || '',
    item.path,
  ]),
].map(row => row.map(value => String(value).replaceAll('\t', ' ')).join('\t'));
await writeFile(reviewTsvPath, `${reviewRows.join('\n')}\n`);

const approvalRows = [
  [
    'decision',
    'review_status',
    'file_name',
    'sha256',
    'path',
    'notes',
  ],
  ...candidates
    .filter(item => item.uploadEligibility === 'manual-review-required')
    .map(item => [
      '',
      item.reviewStatus,
      item.fileName,
      item.sha256,
      item.path,
      '',
    ]),
].map(row => row.map(value => String(value).replaceAll('\t', ' ')).join('\t'));
await writeFile(approvalTemplatePath, `${approvalRows.join('\n')}\n`);
if (!existsSync(approvalWorkingPath)) {
  await writeFile(approvalWorkingPath, `${approvalRows.join('\n')}\n`);
}
const reviewHtml = renderReviewHtml(report, approvalWorkingPath);
await writeFile(reviewHtmlPath, reviewHtml);
await writeFile(stableReviewHtmlPath, reviewHtml);

console.log(JSON.stringify({
  reportPath: join(process.cwd(), reportPath),
  reviewTsvPath: join(process.cwd(), reviewTsvPath),
  approvalTemplatePath: join(process.cwd(), approvalTemplatePath),
  approvalWorkingPath: join(process.cwd(), approvalWorkingPath),
  reviewHtmlPath: join(process.cwd(), reviewHtmlPath),
  stableReviewHtmlPath: join(process.cwd(), stableReviewHtmlPath),
  scannedCount: report.scannedCount,
  uniqueHashes: report.uniqueHashes,
  duplicateHashes: report.duplicateHashes,
  byExtension: report.byExtension,
  byReviewStatus: report.byReviewStatus,
  highSignalCandidates: candidates
    .filter(item => (
      item.soundCloudMatches.length > 0 ||
      item.olderHomepageNameMatches.length > 0 ||
      item.catalogNameMatchCount > 0 ||
      item.exactCatalogMatch
    ))
    .slice(0, 40)
    .map(item => ({
      fileName: item.fileName,
      reviewStatus: item.reviewStatus,
      soundCloudMatches: item.soundCloudMatches.map(match => `${match.title} (${match.matchType})`),
      olderHomepageNameMatches: item.olderHomepageNameMatches,
      catalogNameMatchCount: item.catalogNameMatchCount,
      exactCatalogMatch: item.exactCatalogMatch,
    })),
}, null, 2));
