#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TMP_DIR = 'tmp';
const DEFAULT_BATCH_SIZE = Number(process.env.ABLETON_EXPORT_BATCH_SIZE || 25);
const SUGGESTED_TAIL_BEATS = 4;

async function latestQueuePath() {
  const files = (await readdir(TMP_DIR))
    .filter(name => /^music-migration-queue-\d+\.json$/.test(name))
    .sort();
  if (files.length === 0) {
    throw new Error('No music queue found. Run npm run music:queue first.');
  }
  return join(TMP_DIR, files.at(-1));
}

function tsvEscape(value) {
  return String(value ?? '').replaceAll('\t', ' ').replaceAll('\n', ' ');
}

function toRows(projects) {
  const headers = [
    'batch_status',
    'project_file_name',
    'project_path',
    'expected_wav_path',
    'expected_wav_exists',
    'render_start_bars',
    'render_start_beats',
    'render_start_sixteenths',
    'suggested_render_length_bars_4_4',
    'suggested_render_length_beats',
    'suggested_render_length_sixteenths',
    'suggested_tail_beats',
    'evidence_status',
    'export_readiness_status',
    'content_status',
    'total_clip_count',
    'arrangement_end_beat',
    'catalog_exact_name_match_count',
    'library_exact_name_match_count',
    'library_exact_name_matches',
  ];

  return [
    headers,
    ...projects.map(project => [
      project.batchStatus,
      project.fileName,
      project.path,
      project.suggestedRenderPath,
      project.expectedWavExists ? 'yes' : 'no',
      project.renderStartBars,
      project.renderStartBeats,
      project.renderStartSixteenths,
      project.suggestedRenderLengthBars4x4,
      project.suggestedRenderLengthBeats,
      project.suggestedRenderLengthSixteenths,
      project.suggestedTailBeats,
      project.evidenceStatus,
      project.exportReadinessStatus,
      project.contentStatus,
      project.totalClipCount ?? '',
      project.arrangementEndBeat ?? '',
      project.catalogExactNameMatchCount ?? 0,
      project.libraryExactNameMatchCount ?? 0,
      (project.libraryExactNameMatches || []).map(match => match.fileName).join('; '),
    ]),
  ];
}

function rowsToTsv(rows) {
  return `${rows.map(row => row.map(tsvEscape).join('\t')).join('\n')}\n`;
}

function suggestedRenderLengthBars4x4(arrangementEndBeat) {
  const beats = Number(arrangementEndBeat);
  if (!Number.isFinite(beats) || beats <= 0) return '';
  return Math.max(1, Math.ceil((beats + SUGGESTED_TAIL_BEATS) / 4));
}

function withExportFields(project) {
  return {
    ...project,
    renderStartBars: 1,
    renderStartBeats: 1,
    renderStartSixteenths: 1,
    suggestedRenderLengthBars4x4: suggestedRenderLengthBars4x4(project.arrangementEndBeat),
    suggestedRenderLengthBeats: 0,
    suggestedRenderLengthSixteenths: 0,
    suggestedTailBeats: SUGGESTED_TAIL_BEATS,
  };
}

const queuePath = process.argv[2] || await latestQueuePath();
const batchSize = Number(process.argv[3] || DEFAULT_BATCH_SIZE);
const queue = JSON.parse(await readFile(queuePath, 'utf8'));
const projects = queue.unrenderedProjects?.projects || [];
const ready = projects
  .filter(project => project.exportReadinessStatus === 'ready-to-export')
  .map(project => withExportFields({
    ...project,
    expectedWavExists: existsSync(project.suggestedRenderPath),
  }));

const readyNoExistingEvidence = ready.filter(project => project.evidenceStatus === 'no-existing-render-evidence-found');
const readyPossibleExisting = ready.filter(project => project.evidenceStatus === 'possible-existing-render-needs-review');
const readyWithExpectedWav = ready.filter(project => project.expectedWavExists);
const possibleEmpty = projects.filter(project => project.exportReadinessStatus === 'review-empty-before-export');
const firstBatch = readyNoExistingEvidence.slice(0, batchSize).map(project => ({
  ...project,
  batchStatus: 'first-batch-ready-no-existing-evidence',
}));
const allReadyRows = [
  ...readyNoExistingEvidence.map(project => ({
    ...project,
    batchStatus: 'ready-no-existing-evidence',
  })),
  ...readyPossibleExisting.map(project => ({
    ...project,
    batchStatus: 'ready-possible-existing-render-needs-review',
  })),
];

const report = {
  generatedAt: new Date().toISOString(),
  sourceQueue: queuePath,
  mode: 'read-only Ableton export plan; no exports, uploads, deletes, or catalog/source mutations performed',
  batchSize,
  counts: {
    queuedProjects: projects.length,
    readyToExport: ready.length,
    readyNoExistingEvidence: readyNoExistingEvidence.length,
    readyPossibleExistingRenderReview: readyPossibleExisting.length,
    readyWithExpectedWav: readyWithExpectedWav.length,
    possibleEmptyReview: possibleEmpty.length,
    firstBatch: firstBatch.length,
  },
  recommendedOrder: [
    'Export first-batch-ready-no-existing-evidence rows.',
    'In Live, set Render Start to 1.1.1 and Render Length to suggested_render_length_bars_4_4.0.0 for each row.',
    'Run npm run music:scan-local-renders to preview new WAV uploads.',
    'Run npm run music:sync-local-renders only after confirming the dry-run.',
    'Review ready-possible-existing-render-needs-review rows before re-exporting.',
    'Review possible-empty projects before deciding whether silent/empty renders are desired.',
  ],
  firstBatchProjects: firstBatch,
  readyPossibleExistingProjects: readyPossibleExisting,
  possibleEmptyProjects: possibleEmpty,
};

await mkdir(TMP_DIR, { recursive: true });
const stamp = Date.now();
const jsonPath = join(TMP_DIR, `ableton-export-plan-${stamp}.json`);
const stableJsonPath = join(TMP_DIR, 'ableton-export-plan.json');
const firstBatchPath = join(TMP_DIR, `ableton-export-first-batch-${stamp}.tsv`);
const stableFirstBatchPath = join(TMP_DIR, 'ableton-export-first-batch.tsv');
const allReadyPath = join(TMP_DIR, `ableton-export-ready-all-${stamp}.tsv`);
const stableAllReadyPath = join(TMP_DIR, 'ableton-export-ready-all.tsv');

await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(stableJsonPath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(firstBatchPath, rowsToTsv(toRows(firstBatch)));
await writeFile(stableFirstBatchPath, rowsToTsv(toRows(firstBatch)));
await writeFile(allReadyPath, rowsToTsv(toRows(allReadyRows)));
await writeFile(stableAllReadyPath, rowsToTsv(toRows(allReadyRows)));

console.log(JSON.stringify({
  jsonPath: join(process.cwd(), jsonPath),
  stableJsonPath: join(process.cwd(), stableJsonPath),
  firstBatchPath: join(process.cwd(), firstBatchPath),
  stableFirstBatchPath: join(process.cwd(), stableFirstBatchPath),
  allReadyPath: join(process.cwd(), allReadyPath),
  stableAllReadyPath: join(process.cwd(), stableAllReadyPath),
  counts: report.counts,
}, null, 2));
