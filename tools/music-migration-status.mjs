#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TMP_DIR = 'tmp';

async function latestPath(prefix) {
  try {
    const files = (await readdir(TMP_DIR))
      .filter(name => name.startsWith(prefix) && name.endsWith('.json'))
      .sort();
    return files.length ? join(TMP_DIR, files.at(-1)) : null;
  } catch {
    return null;
  }
}

async function readJson(path) {
  if (!path) return null;
  return JSON.parse(await readFile(path, 'utf8'));
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

async function approvalSummary() {
  const path = join(TMP_DIR, 'music-library-approval.tsv');
  try {
    const rows = parseTsv(await readFile(path, 'utf8'));
    const decisions = rows.reduce((acc, row) => {
      const decision = String(row.decision || '').trim().toLowerCase() || 'blank';
      acc[decision] = (acc[decision] || 0) + 1;
      return acc;
    }, {});

    return {
      path,
      rowCount: rows.length,
      approvedCount: (decisions.approve || 0) + (decisions.approved || 0) + (decisions.yes || 0) + (decisions.y || 0),
      rejectedCount: (decisions.reject || 0) + (decisions.rejected || 0) + (decisions.no || 0) + (decisions.n || 0),
      blankCount: decisions.blank || 0,
      decisions,
    };
  } catch {
    return {
      path,
      rowCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      blankCount: 0,
      decisions: {},
    };
  }
}

function statusLabel(done) {
  return done ? 'complete' : 'incomplete';
}

function mdEscape(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function renderMarkdown(report) {
  const checklistRows = report.completionChecklist.map(item => (
    `| ${mdEscape(item.requirement)} | ${mdEscape(item.status)} | ${mdEscape(item.evidence)} |`
  )).join('\n');

  const gateRows = report.openGates.map(item => (
    `| ${mdEscape(item.gate)} | ${mdEscape(item.count)} | ${mdEscape(item.nextStep)} |`
  )).join('\n') || '| None | 0 | No known remaining gate. |';

  return `# Music Migration Status

Generated: ${report.generatedAt}

## Current Counts

- Public archive catalog tracks: ${report.counts.catalogTracks}
- Verified public archive tracks: ${report.counts.verifiedPublicArchiveTracks}
- Verified AIF masters: ${report.counts.verifiedMasterTracks}
- Unrendered Ableton projects: ${report.counts.unrenderedAbletonProjects}
- Ableton projects ready to export: ${report.counts.abletonProjectsReadyToExport}
- Ableton projects needing empty-project review: ${report.counts.abletonProjectsNeedingEmptyReview}
- Ableton projects with no existing render evidence: ${report.counts.abletonProjectsWithNoExistingRenderEvidence}
- Ableton projects with possible existing render evidence: ${report.counts.abletonProjectsWithPossibleExistingRenderEvidence}
- Ableton export-plan ready rows: ${report.counts.abletonExportPlanReadyToExport}
- Ableton export-plan first batch rows: ${report.counts.abletonExportPlanFirstBatch}
- Ableton export-plan rows where expected WAV already exists: ${report.counts.abletonExportPlanReadyWithExpectedWav}
- Ableton export-progress rendered WAVs found: ${report.counts.abletonExportProgressRendered}
- Ableton export-progress WAVs ready to upload: ${report.counts.abletonExportProgressUploadReady}
- Ableton export-progress rows not yet rendered: ${report.counts.abletonExportProgressNotRendered}
- Ableton projects audited for clips/samples: ${report.counts.abletonProjectsAudited}
- Ableton audited projects with relocated sample-path candidates: ${report.counts.abletonProjectsWithRelocatedSampleCandidates}
- Ableton audited projects with unresolved missing sample refs: ${report.counts.abletonProjectsWithUnresolvedMissingSamples}
- Ableton audited projects possibly empty: ${report.counts.abletonProjectsPossiblyEmpty}
- Library review manual rows: ${report.counts.libraryApprovalRows}
- Library approvals: ${report.counts.libraryApproved}
- Library rejects: ${report.counts.libraryRejected}
- Library blanks: ${report.counts.libraryBlank}
- Public SoundCloud tracks visible: ${report.counts.soundCloudPublicTracks}

## Completion Checklist

| Requirement | Status | Evidence |
| --- | --- | --- |
${checklistRows}

## Open Gates

| Gate | Count | Next step |
| --- | ---: | --- |
${gateRows}

## Artifacts

- Inventory: ${report.artifacts.inventory || 'missing'}
- Queue: ${report.artifacts.queue || 'missing'}
- Ableton render queue HTML: ${report.artifacts.abletonRenderQueue || 'missing'}
- Ableton manual render TSV: ${report.artifacts.abletonManualRenderQueue || 'missing'}
- Ableton export plan: ${report.artifacts.abletonExportPlan || 'missing'}
- Ableton export progress: ${report.artifacts.abletonExportProgress || 'missing'}
- Ableton export progress TSV: ${report.artifacts.abletonExportProgressTsv || 'missing'}
- Ableton rendered upload manifest: ${report.artifacts.abletonRenderedUploadManifest || 'missing'}
- Ableton first export batch TSV: ${report.artifacts.abletonExportFirstBatch || 'missing'}
- Ableton all ready exports TSV: ${report.artifacts.abletonExportReadyAll || 'missing'}
- Ableton possible-existing review TSV: ${report.artifacts.abletonPossibleExistingRenderReview || 'missing'}
- Ableton possibly-empty review TSV: ${report.artifacts.abletonPossiblyEmptyProjects || 'missing'}
- Ableton project audit: ${report.artifacts.abletonProjectAudit || 'missing'}
- Ableton project audit TSV: ${report.artifacts.abletonProjectAuditTsv || 'missing'}
- Ableton sample repair plan: ${report.artifacts.abletonSampleRepairPlan || 'missing'}
- Public archive verification: ${report.artifacts.archiveVerification || 'missing'}
- Master verification: ${report.artifacts.masterVerification || 'missing'}
- SoundCloud report: ${report.artifacts.soundCloudReport || 'missing'}
- Library review: ${report.artifacts.libraryReview || 'missing'}
- Library approval TSV: ${report.artifacts.libraryApproval || 'missing'}
`;
}

const artifacts = {
  inventory: await latestPath('music-migration-inventory-'),
  queue: await latestPath('music-migration-queue-'),
  archiveVerification: await latestPath('music-archive-verification-'),
  masterVerification: await latestPath('yng-music-source-verification-'),
  soundCloudReport: await latestPath('soundcloud-owner-track-report-'),
  libraryReview: await latestPath('music-library-review-'),
  libraryApproval: join(TMP_DIR, 'music-library-approval.tsv'),
  abletonRenderQueue: join(TMP_DIR, 'ableton-render-queue.html'),
  abletonManualRenderQueue: join(TMP_DIR, 'ableton-manual-render-queue.tsv'),
  abletonExportPlan: join(TMP_DIR, 'ableton-export-plan.json'),
  abletonExportProgress: await latestPath('ableton-export-progress-'),
  abletonExportProgressTsv: join(TMP_DIR, 'ableton-export-progress.tsv'),
  abletonRenderedUploadManifest: join(TMP_DIR, 'ableton-rendered-upload-manifest.tsv'),
  abletonExportFirstBatch: join(TMP_DIR, 'ableton-export-first-batch.tsv'),
  abletonExportReadyAll: join(TMP_DIR, 'ableton-export-ready-all.tsv'),
  abletonPossibleExistingRenderReview: join(TMP_DIR, 'ableton-possible-existing-render-review.tsv'),
  abletonPossiblyEmptyProjects: join(TMP_DIR, 'ableton-possibly-empty-projects.tsv'),
  abletonProjectAudit: await latestPath('ableton-project-audit-'),
  abletonProjectAuditTsv: join(TMP_DIR, 'ableton-project-audit.tsv'),
  abletonSampleRepairPlan: join(TMP_DIR, 'ableton-sample-repair-plan.json'),
};

const inventory = await readJson(artifacts.inventory);
const queue = await readJson(artifacts.queue);
const archiveVerification = await readJson(artifacts.archiveVerification);
const masterVerification = await readJson(artifacts.masterVerification);
const soundCloudReport = await readJson(artifacts.soundCloudReport);
const libraryReview = await readJson(artifacts.libraryReview);
const abletonProjectAudit = await readJson(artifacts.abletonProjectAudit);
const abletonExportPlan = await readJson(artifacts.abletonExportPlan).catch(() => null);
const abletonExportProgress = await readJson(artifacts.abletonExportProgress).catch(() => null);
const approvals = await approvalSummary();

const counts = {
  catalogTracks: inventory?.catalog?.trackCountActual || 0,
  duplicateCatalogHashes: inventory?.catalog?.duplicateHashes || 0,
  duplicateCatalogKeys: inventory?.catalog?.duplicateKeys || 0,
  s3CatalogKeysMissing: inventory?.s3?.archive?.catalogKeysMissingInS3?.length || 0,
  s3ArchiveObjectsNotInCatalog: inventory?.s3?.archive?.archiveObjectsNotInCatalog?.length || 0,
  verifiedPublicArchiveTracks: archiveVerification?.verifiedTrackCount || 0,
  failedPublicArchiveTracks: archiveVerification?.failedTrackCount || 0,
  verifiedMasterTracks: masterVerification?.verifiedCount || 0,
  failedMasterTracks: masterVerification?.failedCount || 0,
  localAifMasters: queue?.masterUploadPlan?.count || 0,
  missingRemoteMasters: queue?.masterUploadPlan?.missingRemoteCount || 0,
  unrenderedAbletonProjects: queue?.unrenderedProjects?.count || 0,
  abletonProjectsReadyToExport: queue?.unrenderedProjects?.exportReadinessSummary?.['ready-to-export'] || 0,
  abletonProjectsNeedingEmptyReview: queue?.unrenderedProjects?.exportReadinessSummary?.['review-empty-before-export'] || 0,
  abletonProjectsNeedingSampleRepair: queue?.unrenderedProjects?.exportReadinessSummary?.['repair-samples-before-export'] || 0,
  abletonProjectsNeedingAudit: queue?.unrenderedProjects?.exportReadinessSummary?.['needs-audit-before-export'] || 0,
  abletonProjectsWithNoExistingRenderEvidence: queue?.unrenderedProjects?.evidenceSummary?.['no-existing-render-evidence-found'] || 0,
  abletonProjectsWithPossibleExistingRenderEvidence: queue?.unrenderedProjects?.evidenceSummary?.['possible-existing-render-needs-review'] || 0,
  abletonExportPlanReadyToExport: abletonExportPlan?.counts?.readyToExport || 0,
  abletonExportPlanReadyNoExistingEvidence: abletonExportPlan?.counts?.readyNoExistingEvidence || 0,
  abletonExportPlanReadyPossibleExistingRenderReview: abletonExportPlan?.counts?.readyPossibleExistingRenderReview || 0,
  abletonExportPlanReadyWithExpectedWav: abletonExportPlan?.counts?.readyWithExpectedWav || 0,
  abletonExportPlanFirstBatch: abletonExportPlan?.counts?.firstBatch || 0,
  abletonExportProgressRendered: abletonExportProgress?.renderedCount || 0,
  abletonExportProgressUploadReady: abletonExportProgress?.uploadReadyCount || 0,
  abletonExportProgressNotRendered: abletonExportProgress?.counts?.['not-rendered'] || 0,
  abletonExportProgressAlreadyInCatalog: abletonExportProgress?.counts?.['already-in-catalog-by-sha256'] || 0,
  abletonExportProgressDuplicateRenders: abletonExportProgress?.counts?.['duplicate-render-sha256'] || 0,
  abletonExportProgressSuspiciousRenders: abletonExportProgress?.counts?.['suspicious-render-needs-review'] || 0,
  abletonProjectsAudited: abletonProjectAudit?.projectCount || 0,
  abletonProjectsWithMissingSamples: abletonProjectAudit?.projectsWithMissingSamplesCount || 0,
  abletonProjectsWithRelocatedSampleCandidates: abletonProjectAudit?.projectsWithRelocatedSampleCandidatesCount || 0,
  abletonProjectsWithUnresolvedMissingSamples: abletonProjectAudit?.projectsWithUnresolvedMissingSamplesCount || 0,
  abletonProjectsPossiblyEmpty: abletonProjectAudit?.possiblyEmptyProjectsCount || 0,
  libraryReviewScanned: libraryReview?.scannedCount || 0,
  libraryManualReviewRequired: queue?.libraryReview?.manualReviewRequiredCount || 0,
  libraryApprovalRows: approvals.rowCount,
  libraryApproved: approvals.approvedCount,
  libraryRejected: approvals.rejectedCount,
  libraryBlank: approvals.blankCount,
  soundCloudPublicTracks: soundCloudReport?.publicTracksCount || inventory?.soundcloud?.publicTracksCount || 0,
  soundCloudOfficialDownloadsVerified: soundCloudReport?.officialOriginalDownloadsVerifiedCount || 0,
  soundCloudOfficialDownloadsPending: soundCloudReport?.officialOriginalDownloadsPendingCount || 0,
};

const publicArchiveVerified = Boolean(
  archiveVerification?.catalogJsonMatchesRemote &&
  archiveVerification?.allTracksVerified &&
  counts.failedPublicArchiveTracks === 0 &&
  counts.duplicateCatalogHashes === 0 &&
  counts.duplicateCatalogKeys === 0
);
const mastersVerified = Boolean(
  masterVerification?.prefix === 'masters/render-project' &&
  masterVerification?.tracks?.every(track => track.verified) &&
  counts.verifiedMasterTracks === counts.localAifMasters &&
  counts.failedMasterTracks === 0
);
const abletonExportsComplete = counts.unrenderedAbletonProjects === 0;
const libraryReviewComplete = counts.libraryApprovalRows > 0 && counts.libraryBlank === 0;
const soundCloudOwnerAccessComplete = counts.soundCloudOfficialDownloadsPending === 0 &&
  !String(inventory?.soundcloud?.privateOrOwnerOnlyStatus || '').includes('not inventoried');

const completionChecklist = [
  {
    requirement: 'Public catalog archive is deduped and S3-verified',
    status: statusLabel(publicArchiveVerified),
    evidence: artifacts.archiveVerification || 'missing archive verification report',
  },
  {
    requirement: 'AIF master uploads are S3-verified',
    status: statusLabel(mastersVerified),
    evidence: artifacts.masterVerification || 'missing master verification report',
  },
  {
    requirement: 'Ableton projects have matching rendered exports',
    status: statusLabel(abletonExportsComplete),
    evidence: `${counts.unrenderedAbletonProjects} unrendered projects in ${artifacts.queue || 'missing queue'}`,
  },
  {
    requirement: 'Local Music library candidates are adjudicated',
    status: statusLabel(libraryReviewComplete),
    evidence: `${counts.libraryBlank} blank approval rows in ${approvals.path}`,
  },
  {
    requirement: 'SoundCloud owner/private/original inventory is complete',
    status: statusLabel(soundCloudOwnerAccessComplete),
    evidence: inventory?.soundcloud?.privateOrOwnerOnlyStatus || artifacts.soundCloudReport || 'missing SoundCloud evidence',
  },
];

const openGates = [
  counts.abletonExportProgressUploadReady > 0 ? {
    gate: 'Rendered Ableton WAVs ready for dry-run/upload',
    count: counts.abletonExportProgressUploadReady,
    nextStep: `run npm run music:scan-rendered-exports, inspect tmp/yng-music-dry-run.json, then run npm run music:sync-rendered-exports`,
  } : null,
  counts.abletonExportProgressSuspiciousRenders > 0 ? {
    gate: 'Rendered Ableton WAVs needing review',
    count: counts.abletonExportProgressSuspiciousRenders,
    nextStep: `inspect ${artifacts.abletonExportProgressTsv}`,
  } : null,
  counts.unrenderedAbletonProjects > 0 ? {
    gate: 'Ableton projects without rendered export',
    count: counts.unrenderedAbletonProjects,
    nextStep: `export first batch from ${artifacts.abletonExportFirstBatch || queue?.unrenderedProjects?.abletonRenderQueueHtmlPath || artifacts.abletonRenderQueue}, then run npm run music:ableton-export-progress`,
  } : null,
  counts.abletonProjectsWithUnresolvedMissingSamples > 0 ? {
    gate: 'Ableton projects with unresolved missing sample references',
    count: counts.abletonProjectsWithUnresolvedMissingSamples,
    nextStep: `inspect ${artifacts.abletonProjectAuditTsv}`,
  } : null,
  counts.abletonProjectsNeedingEmptyReview > 0 ? {
    gate: 'Ableton projects that look possibly empty',
    count: counts.abletonProjectsNeedingEmptyReview,
    nextStep: `review ${artifacts.abletonPossiblyEmptyProjects}`,
  } : null,
  counts.libraryBlank > 0 ? {
    gate: 'Library review rows awaiting approve/reject',
    count: counts.libraryBlank,
    nextStep: `review ${approvals.path} or tmp/music-library-review.html`,
  } : null,
  counts.soundCloudOfficialDownloadsPending > 0 || !soundCloudOwnerAccessComplete ? {
    gate: 'SoundCloud original/private owner access pending',
    count: counts.soundCloudOfficialDownloadsPending,
    nextStep: 'log into SoundCloud in Chrome and use official Download file/data export/support routes',
  } : null,
].filter(Boolean);

const report = {
  generatedAt: new Date().toISOString(),
  mode: 'read-only consolidated migration status; no uploads, downloads, exports, deletes, or catalog/source mutations performed',
  artifacts,
  counts,
  completionChecklist,
  openGates,
  complete: completionChecklist.every(item => item.status === 'complete'),
};

await mkdir(TMP_DIR, { recursive: true });
const stamp = Date.now();
const jsonPath = join(TMP_DIR, `music-migration-status-${stamp}.json`);
const mdPath = join(TMP_DIR, `music-migration-status-${stamp}.md`);
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(mdPath, renderMarkdown(report));

console.log(JSON.stringify({
  jsonPath: join(process.cwd(), jsonPath),
  mdPath: join(process.cwd(), mdPath),
  complete: report.complete,
  checklist: report.completionChecklist.map(item => ({
    requirement: item.requirement,
    status: item.status,
  })),
  openGates: report.openGates,
}, null, 2));
