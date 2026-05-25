#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import catalog from '../src/data/yng-music.json' with { type: 'json' };

const execFileAsync = promisify(execFile);

const TMP_DIR = 'tmp';
const MASTER_PREFIX = process.env.YNG_MUSIC_MASTER_PREFIX || 'masters/render-project';
const FLAT_ROOTS = [
  '/Users/luke/Desktop/render-project',
  '/Users/luke/Desktop/si-project',
];
const AUDIO_EXTENSIONS = new Set(['.aif', '.aiff', '.wav', '.mp3']);

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

function slugify(value) {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[^\w\s.-]+/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();

  return slug || 'untitled';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('`', '&#96;');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function fileLink(filePath, label = 'open') {
  return `<a href="${escapeAttribute(pathToFileURL(filePath).href)}">${escapeHtml(label)}</a>`;
}

function evidenceText(project) {
  const catalogMatches = project.catalogExactNameMatches
    .map(match => match.fileName || match.title || match.s3Key)
    .filter(Boolean);
  const libraryMatches = project.libraryExactNameMatches
    .map(match => `${match.fileName}${match.sizeBytes ? ` (${formatBytes(match.sizeBytes)})` : ''}`)
    .filter(Boolean);

  return [
    catalogMatches.length ? `Catalog: ${catalogMatches.join('; ')}` : '',
    libraryMatches.length ? `Library: ${libraryMatches.join('; ')}` : '',
  ].filter(Boolean).join(' | ') || 'No exact-name evidence found';
}

function contentLabel(status) {
  if (status === 'has-arrangement-or-session-clips') return 'ready to export';
  if (status === 'possibly-empty-no-clips-or-samples-found') return 'possibly empty';
  if (!status || status === 'not-audited') return 'not audited';
  return status;
}

function exportReadiness(project) {
  if (project.contentStatus === 'possibly-empty-no-clips-or-samples-found') return 'review-empty-before-export';
  if (project.unresolvedMissingSamplePathCount > 0 || project.missingSamplePathCount > 0) return 'repair-samples-before-export';
  if (project.contentStatus === 'has-arrangement-or-session-clips') return 'ready-to-export';
  return 'needs-audit-before-export';
}

function renderAbletonQueueHtml({ generatedAt, projects, evidenceSummary, contentSummary, exportReadinessSummary }) {
  const rows = projects.map(project => {
    const rootLabel = project.root.replace('/Users/luke/Desktop/', '');
    const evidence = evidenceText(project);
    const readiness = exportReadiness(project);
    const searchText = [
      project.fileName,
      project.path,
      project.suggestedRenderPath,
      project.normalizedBase,
      project.contentStatus,
      readiness,
      evidence,
    ].join(' ').toLowerCase();

    return `<tr data-evidence="${escapeAttribute(project.evidenceStatus)}" data-content="${escapeAttribute(project.contentStatus)}" data-readiness="${escapeAttribute(readiness)}" data-search="${escapeAttribute(searchText)}">
      <td>
        <strong>${escapeHtml(project.fileName)}</strong>
        <div class="muted">${escapeHtml(rootLabel)}</div>
      </td>
      <td>
        <span class="pill ${readiness === 'ready-to-export' ? 'ready' : readiness === 'review-empty-before-export' ? 'warn' : ''}">${escapeHtml(readiness)}</span>
        <div class="muted">${escapeHtml(contentLabel(project.contentStatus))}</div>
      </td>
      <td><span class="pill ${project.evidenceStatus === 'possible-existing-render-needs-review' ? 'warn' : ''}">${escapeHtml(project.evidenceStatus)}</span></td>
      <td>${fileLink(project.path, 'Open ALS')}<div class="path">${escapeHtml(project.path)}</div></td>
      <td><div class="path">${escapeHtml(project.suggestedRenderPath)}</div></td>
      <td>${escapeHtml(project.totalClipCount ?? '')}</td>
      <td>${escapeHtml(evidence)}</td>
    </tr>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ableton Render Queue</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f7f5;
      --text: #181816;
      --muted: #67645d;
      --line: #d8d5ce;
      --panel: #ffffff;
      --accent: #1d5c63;
      --warn: #8a4b13;
      --warn-bg: #fff1df;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 2;
      background: rgba(247, 247, 245, 0.96);
      border-bottom: 1px solid var(--line);
      padding: 18px 22px 16px;
      backdrop-filter: blur(10px);
    }
    h1 {
      margin: 0 0 12px;
      font-size: 24px;
      line-height: 1.1;
      letter-spacing: 0;
    }
    .summary {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 14px;
      color: var(--muted);
    }
    .summary strong { color: var(--text); }
    .toolbar {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) repeat(2, minmax(180px, 260px));
      gap: 10px;
      max-width: 1240px;
    }
    input, select {
      width: 100%;
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      padding: 7px 10px;
      font: inherit;
    }
    main { padding: 18px 22px 28px; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    th, td {
      padding: 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }
    th {
      position: sticky;
      top: 124px;
      z-index: 1;
      background: #eeeeea;
      font-size: 12px;
      text-transform: uppercase;
      color: var(--muted);
    }
    tr:last-child td { border-bottom: 0; }
    a { color: var(--accent); font-weight: 700; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .muted, .path {
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .pill {
      display: inline-block;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 3px 8px;
      color: var(--accent);
      background: #edf7f7;
      font-size: 12px;
      white-space: nowrap;
    }
    .pill.warn {
      color: var(--warn);
      background: var(--warn-bg);
    }
    .pill.ready {
      color: #20623a;
      background: #edf8ef;
    }
    @media (max-width: 760px) {
      .toolbar { grid-template-columns: 1fr; }
      header { position: static; }
      th { position: static; }
      table, thead, tbody, th, td, tr { display: block; }
      thead { display: none; }
      tr { border-bottom: 1px solid var(--line); }
      td { border-bottom: 0; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Ableton Render Queue</h1>
    <div class="summary">
      <span><strong id="visibleCount">${projects.length}</strong> visible</span>
      <span><strong>${projects.length}</strong> total</span>
      <span><strong>${exportReadinessSummary['ready-to-export'] || 0}</strong> ready</span>
      <span><strong>${contentSummary['possibly-empty-no-clips-or-samples-found'] || 0}</strong> possibly empty</span>
      <span><strong>${evidenceSummary['no-existing-render-evidence-found'] || 0}</strong> no evidence</span>
      <span><strong>${evidenceSummary['possible-existing-render-needs-review'] || 0}</strong> possible existing</span>
      <span>Generated ${escapeHtml(generatedAt)}</span>
    </div>
    <div class="toolbar">
      <input id="search" type="search" placeholder="Search projects, paths, or match evidence" autocomplete="off">
      <select id="evidence">
        <option value="">All evidence statuses</option>
        <option value="no-existing-render-evidence-found">No existing render evidence</option>
        <option value="possible-existing-render-needs-review">Possible existing render</option>
      </select>
      <select id="readiness">
        <option value="">All export statuses</option>
        <option value="ready-to-export">Ready to export</option>
        <option value="review-empty-before-export">Possibly empty</option>
        <option value="repair-samples-before-export">Repair samples first</option>
        <option value="needs-audit-before-export">Needs audit</option>
      </select>
    </div>
  </header>
  <main>
    <table>
      <thead>
        <tr>
          <th>Project</th>
          <th>Export Status</th>
          <th>Evidence</th>
          <th>Project File</th>
          <th>Suggested WAV Export</th>
          <th>Clips</th>
          <th>Existing Match Evidence</th>
        </tr>
      </thead>
      <tbody id="rows">
        ${rows}
      </tbody>
    </table>
  </main>
  <script>
    const search = document.getElementById('search');
    const evidence = document.getElementById('evidence');
    const readiness = document.getElementById('readiness');
    const visibleCount = document.getElementById('visibleCount');
    const rows = Array.from(document.querySelectorAll('#rows tr'));

    function applyFilters() {
      const query = search.value.trim().toLowerCase();
      const status = evidence.value;
      const exportStatus = readiness.value;
      let visible = 0;

      for (const row of rows) {
        const matchesSearch = !query || row.dataset.search.includes(query);
        const matchesStatus = !status || row.dataset.evidence === status;
        const matchesReadiness = !exportStatus || row.dataset.readiness === exportStatus;
        const show = matchesSearch && matchesStatus && matchesReadiness;
        row.style.display = show ? '' : 'none';
        if (show) visible += 1;
      }

      visibleCount.textContent = String(visible);
    }

    search.addEventListener('input', applyFilters);
    evidence.addEventListener('change', applyFilters);
    readiness.addEventListener('change', applyFilters);
  </script>
</body>
</html>
`;
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

async function latestInventoryPath() {
  const files = (await readdir(TMP_DIR))
    .filter(name => /^music-migration-inventory-\d+\.json$/.test(name))
    .sort();
  if (files.length === 0) {
    throw new Error('No music inventory found. Run npm run music:inventory first.');
  }
  return join(TMP_DIR, files.at(-1));
}

async function latestJsonPath(prefix) {
  try {
    const files = (await readdir(TMP_DIR))
      .filter(name => name.startsWith(prefix) && name.endsWith('.json'))
      .sort();
    return files.length === 0 ? null : join(TMP_DIR, files.at(-1));
  } catch {
    return null;
  }
}

async function readLatestLibraryReview() {
  const path = await latestJsonPath('music-library-review-');
  if (!path) return null;
  const review = JSON.parse(await readFile(path, 'utf8'));
  return {
    path,
    scannedCount: review.scannedCount,
    uniqueHashes: review.uniqueHashes,
    duplicateHashes: review.duplicateHashes,
    byExtension: review.byExtension,
    byReviewStatus: review.byReviewStatus,
    manualReviewRequiredCount: (review.candidates || []).filter(item => item.uploadEligibility === 'manual-review-required').length,
    skipCount: (review.candidates || []).filter(item => item.uploadEligibility === 'skip').length,
    soundCloudCandidateCount: (review.candidates || []).filter(item => (item.soundCloudMatches || []).length > 0).length,
    olderHomepageCandidateCount: (review.candidates || []).filter(item => (item.olderHomepageNameMatches || []).length > 0).length,
    candidates: review.candidates || [],
  };
}

async function readLatestAbletonAudit() {
  const path = await latestJsonPath('ableton-project-audit-');
  if (!path) return null;
  const audit = JSON.parse(await readFile(path, 'utf8'));
  const byPath = new Map((audit.projects || []).map(project => [project.path, project]));

  return {
    path,
    projectCount: audit.projectCount,
    byContentStatus: audit.byContentStatus || {},
    projectsWithMissingSamplesCount: audit.projectsWithMissingSamplesCount || 0,
    projectsWithRelocatedSampleCandidatesCount: audit.projectsWithRelocatedSampleCandidatesCount || 0,
    projectsWithUnresolvedMissingSamplesCount: audit.projectsWithUnresolvedMissingSamplesCount || 0,
    possiblyEmptyProjectsCount: audit.possiblyEmptyProjectsCount || 0,
    byPath,
  };
}

function indexByNormalizedBase(items) {
  const index = new Map();

  for (const item of items) {
    if (!item.normalizedBase) continue;
    index.set(item.normalizedBase, [
      ...(index.get(item.normalizedBase) || []),
      item,
    ]);
  }

  return index;
}

function catalogNameIndex() {
  const index = new Map();

  for (const track of catalog.tracks || []) {
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

async function readFlatRoot(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const projects = [];
  const audioByBase = new Map();

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    const normalizedBase = normalize(basename(entry.name, ext));
    const path = join(root, entry.name);

    if (ext === '.als') projects.push({ root, path, fileName: entry.name, normalizedBase });
    if (AUDIO_EXTENSIONS.has(ext)) audioByBase.set(normalizedBase, [
      ...(audioByBase.get(normalizedBase) || []),
      { root, path, fileName: entry.name, normalizedBase, ext },
    ]);
  }

  return {
    root,
    projects,
    audioByBase,
    unrenderedProjects: projects.filter(project => !audioByBase.has(project.normalizedBase)),
  };
}

async function listS3Keys(bucket, prefix) {
  const { stdout } = await execFileAsync('aws', [
    's3api',
    'list-objects-v2',
    '--bucket',
    bucket,
    '--prefix',
    `${prefix}/`,
  ], { maxBuffer: 1024 * 1024 * 20 });
  const parsed = JSON.parse(stdout || '{}');
  return new Set((parsed.Contents || []).map(item => item.Key));
}

const manifestPath = process.argv[2] || await latestInventoryPath();
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const remoteMasterKeys = await listS3Keys(manifest.catalog.bucket, MASTER_PREFIX);
const libraryReview = await readLatestLibraryReview();
const abletonAudit = await readLatestAbletonAudit();
const libraryByName = indexByNormalizedBase(libraryReview?.candidates || []);
const catalogByName = catalogNameIndex();

const masterUploadPlan = [];
for (const item of manifest.local.candidateAudio) {
  const ext = item.ext || `.${item.format}`;
  if (!['.aif', '.aiff'].includes(ext.toLowerCase())) continue;
  const s3Key = `${MASTER_PREFIX}/${slugify(basename(item.fileName, ext))}-${item.sha256.slice(0, 12)}${ext}`;
  masterUploadPlan.push({
    sourcePath: item.path,
    fileName: item.fileName,
    title: basename(item.fileName, ext).replace(/[_-]+/g, ' ').trim() || 'Untitled',
    ext,
    sizeBytes: item.sizeBytes,
    sha256: item.sha256,
    catalogNameMatchCount: item.nameCatalogMatchCount,
    exactCatalogMatch: item.exactCatalogMatch,
    s3Bucket: manifest.catalog.bucket,
    s3Key,
    remoteStatus: remoteMasterKeys.has(s3Key) ? 'already-present' : 'missing',
  });
}

const roots = [];
for (const root of FLAT_ROOTS) {
  roots.push(await readFlatRoot(root));
}

const unrenderedProjects = roots.flatMap(root => (
  root.unrenderedProjects.map(project => {
    const catalogMatches = catalogByName.get(project.normalizedBase) || [];
    const libraryMatches = libraryByName.get(project.normalizedBase) || [];
    const auditProject = abletonAudit?.byPath.get(project.path);
    const evidenceStatus = catalogMatches.length > 0 || libraryMatches.length > 0
      ? 'possible-existing-render-needs-review'
      : 'no-existing-render-evidence-found';

    return {
      root: project.root,
      path: project.path,
      fileName: project.fileName,
      normalizedBase: project.normalizedBase,
      suggestedRenderPath: join(project.root, `${basename(project.fileName, '.als')}.wav`),
      preferredFormat: 'wav',
      status: 'needs-manual-ableton-export',
      contentStatus: auditProject?.contentStatus || 'not-audited',
      exportReadinessStatus: auditProject
        ? exportReadiness(auditProject)
        : 'needs-audit-before-export',
      totalClipCount: auditProject?.totalClipCount,
      audioClipCount: auditProject?.audioClipCount,
      midiClipCount: auditProject?.midiClipCount,
      audioTrackCount: auditProject?.audioTrackCount,
      midiTrackCount: auditProject?.midiTrackCount,
      arrangementEndBeat: auditProject?.arrangementEndBeat,
      missingSamplePathCount: auditProject?.missingSamplePathCount || 0,
      unresolvedMissingSamplePathCount: auditProject?.unresolvedMissingSamplePathCount || 0,
      evidenceStatus,
      catalogExactNameMatchCount: catalogMatches.length,
      catalogExactNameMatches: catalogMatches.slice(0, 5),
      libraryExactNameMatchCount: libraryMatches.length,
      libraryExactNameMatches: libraryMatches.slice(0, 5).map(item => ({
        fileName: item.fileName,
        path: item.path,
        ext: item.ext,
        sizeBytes: item.sizeBytes,
        sha256: item.sha256,
        reviewStatus: item.reviewStatus,
        uploadEligibility: item.uploadEligibility,
      })),
    };
  })
));

const newPublicReviewCandidates = masterUploadPlan.filter(item => (
  !item.exactCatalogMatch && item.catalogNameMatchCount === 0
));
const representedByCatalogName = masterUploadPlan.filter(item => item.catalogNameMatchCount > 0);
const evidenceSummary = unrenderedProjects.reduce((acc, project) => {
  acc[project.evidenceStatus] = (acc[project.evidenceStatus] || 0) + 1;
  return acc;
}, {});
const contentSummary = unrenderedProjects.reduce((acc, project) => {
  acc[project.contentStatus] = (acc[project.contentStatus] || 0) + 1;
  return acc;
}, {});
const exportReadinessSummary = unrenderedProjects.reduce((acc, project) => {
  acc[project.exportReadinessStatus] = (acc[project.exportReadinessStatus] || 0) + 1;
  return acc;
}, {});
const artifactTimestamp = Date.now();
const queuePath = join(TMP_DIR, `music-migration-queue-${artifactTimestamp}.json`);
const manualRenderQueuePath = join(TMP_DIR, `ableton-manual-render-queue-${artifactTimestamp}.tsv`);
const possibleExistingRenderReviewPath = join(TMP_DIR, `ableton-possible-existing-render-review-${artifactTimestamp}.tsv`);
const possibleEmptyProjectsPath = join(TMP_DIR, `ableton-possibly-empty-projects-${artifactTimestamp}.tsv`);
const stableManualRenderQueuePath = join(TMP_DIR, 'ableton-manual-render-queue.tsv');
const stablePossibleExistingRenderReviewPath = join(TMP_DIR, 'ableton-possible-existing-render-review.tsv');
const stablePossibleEmptyProjectsPath = join(TMP_DIR, 'ableton-possibly-empty-projects.tsv');
const abletonRenderQueueHtmlPath = join(TMP_DIR, 'ableton-render-queue.html');

const queue = {
  generatedAt: new Date().toISOString(),
  sourceInventory: manifestPath,
  mode: 'read-only queue; no uploads, exports, deletes, or catalog/source mutations performed',
  masterPrefix: MASTER_PREFIX,
  masterUploadPlan: {
    count: masterUploadPlan.length,
    totalSizeBytes: masterUploadPlan.reduce((sum, item) => sum + item.sizeBytes, 0),
    missingRemoteCount: masterUploadPlan.filter(item => item.remoteStatus === 'missing').length,
    alreadyRemoteCount: masterUploadPlan.filter(item => item.remoteStatus === 'already-present').length,
    tracks: masterUploadPlan,
  },
  likelyNewPublicReviewCandidates: {
    count: newPublicReviewCandidates.length,
    tracks: newPublicReviewCandidates,
  },
  representedByCatalogName: {
    count: representedByCatalogName.length,
    tracks: representedByCatalogName,
  },
  unrenderedProjects: {
    count: unrenderedProjects.length,
    manualRenderQueuePath,
    stableManualRenderQueuePath,
    possibleExistingRenderReviewPath,
    stablePossibleExistingRenderReviewPath,
    possibleEmptyProjectsPath,
    stablePossibleEmptyProjectsPath,
    abletonRenderQueueHtmlPath,
    evidenceSummary,
    contentSummary,
    exportReadinessSummary,
    abletonAudit: abletonAudit ? {
      path: abletonAudit.path,
      projectCount: abletonAudit.projectCount,
      byContentStatus: abletonAudit.byContentStatus,
      projectsWithMissingSamplesCount: abletonAudit.projectsWithMissingSamplesCount,
      projectsWithUnresolvedMissingSamplesCount: abletonAudit.projectsWithUnresolvedMissingSamplesCount,
      possiblyEmptyProjectsCount: abletonAudit.possiblyEmptyProjectsCount,
    } : null,
    byRoot: roots.map(root => ({
      root: root.root,
      count: root.unrenderedProjects.length,
    })),
    projects: unrenderedProjects,
  },
  soundcloudPublicTracks: {
    count: manifest.soundcloud.publicTracksCount,
    tracks: manifest.soundcloud.publicTracks,
  },
  libraryReview,
};
if (queue.libraryReview) delete queue.libraryReview.candidates;

await mkdir(TMP_DIR, { recursive: true });
await writeFile(queuePath, `${JSON.stringify(queue, null, 2)}\n`);

const manualRenderQueueRows = [
  [
    'status',
    'export_readiness_status',
    'content_status',
    'project_path',
    'suggested_render_path',
    'preferred_format',
    'total_clip_count',
    'audio_clip_count',
    'midi_clip_count',
    'arrangement_end_beat',
    'evidence_status',
    'catalog_exact_name_match_count',
    'library_exact_name_match_count',
    'library_exact_name_matches',
    'root',
    'project_file_name',
    'normalized_base',
  ],
  ...unrenderedProjects.map(project => [
    project.status,
    project.exportReadinessStatus,
    project.contentStatus,
    project.path,
    project.suggestedRenderPath,
    project.preferredFormat,
    project.totalClipCount ?? '',
    project.audioClipCount ?? '',
    project.midiClipCount ?? '',
    project.arrangementEndBeat ?? '',
    project.evidenceStatus,
    project.catalogExactNameMatchCount,
    project.libraryExactNameMatchCount,
    project.libraryExactNameMatches.map(match => match.fileName).join('; '),
    project.root,
    project.fileName,
    project.normalizedBase,
  ]),
].map(row => row.map(value => String(value).replaceAll('\t', ' ')).join('\t'));
const manualRenderQueueText = `${manualRenderQueueRows.join('\n')}\n`;
await writeFile(manualRenderQueuePath, manualRenderQueueText);
await writeFile(stableManualRenderQueuePath, manualRenderQueueText);

const possibleExistingRenderRows = [
  [
    'project_file_name',
    'project_path',
    'export_readiness_status',
    'content_status',
    'total_clip_count',
    'catalog_exact_name_match_count',
    'library_exact_name_match_count',
    'library_exact_name_matches',
    'catalog_exact_name_matches',
  ],
  ...unrenderedProjects
    .filter(project => project.evidenceStatus === 'possible-existing-render-needs-review')
    .map(project => [
      project.fileName,
      project.path,
      project.exportReadinessStatus,
      project.contentStatus,
      project.totalClipCount ?? '',
      project.catalogExactNameMatchCount,
      project.libraryExactNameMatchCount,
      project.libraryExactNameMatches.map(match => match.fileName).join('; '),
      project.catalogExactNameMatches.map(match => match.fileName).join('; '),
    ]),
].map(row => row.map(value => String(value).replaceAll('\t', ' ')).join('\t'));
const possibleExistingRenderReviewText = `${possibleExistingRenderRows.join('\n')}\n`;
await writeFile(possibleExistingRenderReviewPath, possibleExistingRenderReviewText);
await writeFile(stablePossibleExistingRenderReviewPath, possibleExistingRenderReviewText);

const possibleEmptyProjectRows = [
  [
    'project_file_name',
    'project_path',
    'suggested_render_path',
    'audio_track_count',
    'midi_track_count',
    'total_clip_count',
    'evidence_status',
  ],
  ...unrenderedProjects
    .filter(project => project.exportReadinessStatus === 'review-empty-before-export')
    .map(project => [
      project.fileName,
      project.path,
      project.suggestedRenderPath,
      project.audioTrackCount ?? '',
      project.midiTrackCount ?? '',
      project.totalClipCount ?? '',
      project.evidenceStatus,
    ]),
].map(row => row.map(value => String(value).replaceAll('\t', ' ')).join('\t'));
const possibleEmptyProjectText = `${possibleEmptyProjectRows.join('\n')}\n`;
await writeFile(possibleEmptyProjectsPath, possibleEmptyProjectText);
await writeFile(stablePossibleEmptyProjectsPath, possibleEmptyProjectText);
await writeFile(abletonRenderQueueHtmlPath, renderAbletonQueueHtml({
  generatedAt: queue.generatedAt,
  projects: unrenderedProjects,
  evidenceSummary,
  contentSummary,
  exportReadinessSummary,
}));

console.log(JSON.stringify({
  queuePath: join(process.cwd(), queuePath),
  manualRenderQueuePath: join(process.cwd(), manualRenderQueuePath),
  stableManualRenderQueuePath: join(process.cwd(), stableManualRenderQueuePath),
  possibleExistingRenderReviewPath: join(process.cwd(), possibleExistingRenderReviewPath),
  stablePossibleExistingRenderReviewPath: join(process.cwd(), stablePossibleExistingRenderReviewPath),
  possibleEmptyProjectsPath: join(process.cwd(), possibleEmptyProjectsPath),
  stablePossibleEmptyProjectsPath: join(process.cwd(), stablePossibleEmptyProjectsPath),
  abletonRenderQueueHtmlPath: join(process.cwd(), abletonRenderQueueHtmlPath),
  masterUploadPlan: {
    count: queue.masterUploadPlan.count,
    totalSizeBytes: queue.masterUploadPlan.totalSizeBytes,
    missingRemoteCount: queue.masterUploadPlan.missingRemoteCount,
    alreadyRemoteCount: queue.masterUploadPlan.alreadyRemoteCount,
  },
  likelyNewPublicReviewCandidates: {
    count: queue.likelyNewPublicReviewCandidates.count,
    sample: queue.likelyNewPublicReviewCandidates.tracks.slice(0, 20).map(item => item.fileName),
  },
  representedByCatalogName: queue.representedByCatalogName.count,
  unrenderedProjects: {
    count: queue.unrenderedProjects.count,
    evidenceSummary: queue.unrenderedProjects.evidenceSummary,
    contentSummary: queue.unrenderedProjects.contentSummary,
    exportReadinessSummary: queue.unrenderedProjects.exportReadinessSummary,
    abletonAudit: queue.unrenderedProjects.abletonAudit,
    byRoot: queue.unrenderedProjects.byRoot,
    sample: queue.unrenderedProjects.projects.slice(0, 20).map(item => item.path),
  },
  soundcloudPublicTracks: queue.soundcloudPublicTracks.count,
  libraryReview: queue.libraryReview,
}, null, 2));
