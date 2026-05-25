#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';

const gunzipAsync = promisify(gunzip);
const TMP_DIR = 'tmp';
const AUDIO_EXTENSIONS = new Set(['.aif', '.aiff', '.wav', '.mp3', '.flac', '.m4a']);
const SAMPLE_PATH_RELOCATIONS = [
  ['/Users/luke/Desktop/si Project/', '/Users/luke/Desktop/si-project/'],
  ['/Users/luke/Desktop/render Project/', '/Users/luke/Desktop/render-project/'],
];

async function latestQueuePath() {
  const files = (await readdir(TMP_DIR))
    .filter(name => /^music-migration-queue-\d+\.json$/.test(name))
    .sort();
  if (files.length === 0) {
    throw new Error('No music queue found. Run npm run music:queue first.');
  }
  return join(TMP_DIR, files.at(-1));
}

function decodeXmlAttribute(value) {
  return String(value || '')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function countMatches(xml, pattern) {
  return Array.from(xml.matchAll(pattern)).length;
}

function collectAttributeValues(xml, tagName, attributeName) {
  const values = [];
  const pattern = new RegExp(`<${tagName}\\b[^>]*\\s${attributeName}="([^"]*)"`, 'g');
  for (const match of xml.matchAll(pattern)) {
    values.push(decodeXmlAttribute(match[1]));
  }
  return values;
}

function maxNumber(values) {
  return values.reduce((max, value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > max ? parsed : max;
  }, 0);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function relocatedSampleCandidate(missingPath) {
  for (const [from, to] of SAMPLE_PATH_RELOCATIONS) {
    if (!missingPath.startsWith(from)) continue;
    const candidate = `${to}${missingPath.slice(from.length)}`;
    if (existsSync(candidate)) {
      return {
        missingPath,
        candidatePath: candidate,
        reason: `${from.replace('/Users/luke/Desktop/', '')} -> ${to.replace('/Users/luke/Desktop/', '')}`,
      };
    }
  }

  return null;
}

function summarizeProjectStatus({
  audioClipCount,
  midiClipCount,
  uniqueSamplePathCount,
  relocatedSamplePathCandidateCount,
  unresolvedMissingSamplePathCount,
}) {
  const totalClips = audioClipCount + midiClipCount;

  if (unresolvedMissingSamplePathCount > 0) return 'has-clips-or-samples-with-unresolved-missing-sample-files';
  if (relocatedSamplePathCandidateCount > 0) return 'has-clips-or-samples-with-relocated-sample-paths';
  if (totalClips > 0) return 'has-arrangement-or-session-clips';
  if (uniqueSamplePathCount > 0) return 'has-sample-references-no-clips-found';
  return 'possibly-empty-no-clips-or-samples-found';
}

async function inspectAbletonProject(project) {
  const compressed = await readFile(project.path);
  const xml = (await gunzipAsync(compressed)).toString('utf8');
  const pathValues = collectAttributeValues(xml, 'Path', 'Value');
  const samplePaths = unique(pathValues.filter(value => AUDIO_EXTENSIONS.has(extname(value).toLowerCase())));
  const absoluteSamplePaths = samplePaths.filter(value => value.startsWith('/'));
  const missingSamplePaths = absoluteSamplePaths.filter(value => !existsSync(value));
  const relocatedSamplePathCandidates = missingSamplePaths
    .map(relocatedSampleCandidate)
    .filter(Boolean);
  const relocatedMissingPaths = new Set(relocatedSamplePathCandidates.map(item => item.missingPath));
  const unresolvedMissingSamplePaths = missingSamplePaths.filter(value => !relocatedMissingPaths.has(value));
  const audioClipCount = countMatches(xml, /<AudioClip\b/g);
  const midiClipCount = countMatches(xml, /<MidiClip\b/g);
  const audioTrackCount = countMatches(xml, /<AudioTrack\b/g);
  const midiTrackCount = countMatches(xml, /<MidiTrack\b/g);
  const groupTrackCount = countMatches(xml, /<GroupTrack\b/g);
  const returnTrackCount = countMatches(xml, /<ReturnTrack\b/g);
  const arrangementEndBeat = maxNumber(collectAttributeValues(xml, 'CurrentEnd', 'Value'));
  const sampleNames = unique(collectAttributeValues(xml, 'Name', 'Value')
    .filter(value => AUDIO_EXTENSIONS.has(extname(value).toLowerCase())));

  return {
    root: project.root,
    path: project.path,
    fileUrl: pathToFileURL(project.path).href,
    fileName: project.fileName,
    normalizedBase: project.normalizedBase,
    suggestedRenderPath: project.suggestedRenderPath,
    evidenceStatus: project.evidenceStatus,
    sizeBytes: compressed.length,
    uncompressedXmlBytes: Buffer.byteLength(xml),
    audioTrackCount,
    midiTrackCount,
    groupTrackCount,
    returnTrackCount,
    audioClipCount,
    midiClipCount,
    totalClipCount: audioClipCount + midiClipCount,
    arrangementEndBeat,
    uniqueSamplePathCount: samplePaths.length,
    absoluteSamplePathCount: absoluteSamplePaths.length,
    missingSamplePathCount: missingSamplePaths.length,
    missingSamplePaths: missingSamplePaths.slice(0, 25),
    relocatedSamplePathCandidateCount: relocatedSamplePathCandidates.length,
    relocatedSamplePathCandidates: relocatedSamplePathCandidates.slice(0, 25),
    unresolvedMissingSamplePathCount: unresolvedMissingSamplePaths.length,
    unresolvedMissingSamplePaths: unresolvedMissingSamplePaths.slice(0, 25),
    sampleNameCount: sampleNames.length,
    sampleNames: sampleNames.slice(0, 25),
    contentStatus: summarizeProjectStatus({
      audioClipCount,
      midiClipCount,
      uniqueSamplePathCount: samplePaths.length,
      relocatedSamplePathCandidateCount: relocatedSamplePathCandidates.length,
      unresolvedMissingSamplePathCount: unresolvedMissingSamplePaths.length,
    }),
  };
}

function tsvEscape(value) {
  return String(value ?? '').replaceAll('\t', ' ').replaceAll('\n', ' ');
}

function toTsv(rows) {
  const headers = [
    'content_status',
    'project_file_name',
    'project_path',
    'suggested_render_path',
    'evidence_status',
    'total_clip_count',
    'audio_clip_count',
    'midi_clip_count',
    'audio_track_count',
    'midi_track_count',
    'arrangement_end_beat',
    'unique_sample_path_count',
    'missing_sample_path_count',
    'relocated_sample_path_candidate_count',
    'unresolved_missing_sample_path_count',
    'relocated_sample_path_candidates',
    'unresolved_missing_sample_paths',
    'missing_sample_paths',
  ];
  const valueForHeader = (row, header) => {
    switch (header) {
      case 'content_status':
        return row.contentStatus;
      case 'project_file_name':
        return row.fileName;
      case 'project_path':
        return row.path;
      case 'suggested_render_path':
        return row.suggestedRenderPath;
      case 'evidence_status':
        return row.evidenceStatus;
      case 'total_clip_count':
        return row.totalClipCount;
      case 'audio_clip_count':
        return row.audioClipCount;
      case 'midi_clip_count':
        return row.midiClipCount;
      case 'audio_track_count':
        return row.audioTrackCount;
      case 'midi_track_count':
        return row.midiTrackCount;
      case 'arrangement_end_beat':
        return row.arrangementEndBeat;
      case 'unique_sample_path_count':
        return row.uniqueSamplePathCount;
      case 'missing_sample_path_count':
        return row.missingSamplePathCount;
      case 'relocated_sample_path_candidate_count':
        return row.relocatedSamplePathCandidateCount;
      case 'unresolved_missing_sample_path_count':
        return row.unresolvedMissingSamplePathCount;
      case 'relocated_sample_path_candidates':
        return row.relocatedSamplePathCandidates.map(item => `${item.missingPath} => ${item.candidatePath}`).join('; ');
      case 'unresolved_missing_sample_paths':
        return row.unresolvedMissingSamplePaths.join('; ');
      case 'missing_sample_paths':
        return row.missingSamplePaths.join('; ');
      default:
        return '';
    }
  };

  return [
    headers.join('\t'),
    ...rows.map(row => headers.map(header => valueForHeader(row, header)).map(tsvEscape).join('\t')),
  ].join('\n');
}

function byStatus(rows, field) {
  return rows.reduce((acc, row) => {
    const value = row[field] || 'unknown';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

const queuePath = process.argv[2] || await latestQueuePath();
const queue = JSON.parse(await readFile(queuePath, 'utf8'));
const projects = queue.unrenderedProjects?.projects || [];
const auditedProjects = [];

for (const [index, project] of projects.entries()) {
  auditedProjects.push(await inspectAbletonProject(project));
  if ((index + 1) % 25 === 0) {
    console.error(`audited ${index + 1}/${projects.length}`);
  }
}

const byContentStatus = byStatus(auditedProjects, 'contentStatus');
const byEvidenceStatus = byStatus(auditedProjects, 'evidenceStatus');
const projectsWithMissingSamples = auditedProjects.filter(project => project.missingSamplePathCount > 0);
const projectsWithRelocatedSampleCandidates = auditedProjects.filter(project => project.relocatedSamplePathCandidateCount > 0);
const projectsWithUnresolvedMissingSamples = auditedProjects.filter(project => project.unresolvedMissingSamplePathCount > 0);
const possiblyEmptyProjects = auditedProjects.filter(project => project.contentStatus === 'possibly-empty-no-clips-or-samples-found');

const report = {
  generatedAt: new Date().toISOString(),
  sourceQueue: queuePath,
  mode: 'read-only Ableton project audit; no exports, uploads, deletes, or project mutations performed',
  projectCount: auditedProjects.length,
  byContentStatus,
  byEvidenceStatus,
  projectsWithMissingSamplesCount: projectsWithMissingSamples.length,
  projectsWithRelocatedSampleCandidatesCount: projectsWithRelocatedSampleCandidates.length,
  projectsWithUnresolvedMissingSamplesCount: projectsWithUnresolvedMissingSamples.length,
  possiblyEmptyProjectsCount: possiblyEmptyProjects.length,
  projectsWithClipsCount: auditedProjects.filter(project => project.totalClipCount > 0).length,
  maxArrangementEndBeat: maxNumber(auditedProjects.map(project => project.arrangementEndBeat)),
  projectsWithMissingSamples: projectsWithMissingSamples.map(project => ({
    path: project.path,
    fileName: project.fileName,
    missingSamplePathCount: project.missingSamplePathCount,
    relocatedSamplePathCandidateCount: project.relocatedSamplePathCandidateCount,
    unresolvedMissingSamplePathCount: project.unresolvedMissingSamplePathCount,
    relocatedSamplePathCandidates: project.relocatedSamplePathCandidates,
    unresolvedMissingSamplePaths: project.unresolvedMissingSamplePaths,
    missingSamplePaths: project.missingSamplePaths,
  })),
  projectsWithUnresolvedMissingSamples: projectsWithUnresolvedMissingSamples.map(project => ({
    path: project.path,
    fileName: project.fileName,
    unresolvedMissingSamplePathCount: project.unresolvedMissingSamplePathCount,
    unresolvedMissingSamplePaths: project.unresolvedMissingSamplePaths,
  })),
  possiblyEmptyProjects: possiblyEmptyProjects.map(project => ({
    path: project.path,
    fileName: project.fileName,
    suggestedRenderPath: project.suggestedRenderPath,
  })),
  projects: auditedProjects,
};

await mkdir(TMP_DIR, { recursive: true });
const stamp = Date.now();
const jsonPath = join(TMP_DIR, `ableton-project-audit-${stamp}.json`);
const tsvPath = join(TMP_DIR, `ableton-project-audit-${stamp}.tsv`);
const stableJsonPath = join(TMP_DIR, 'ableton-project-audit.json');
const stableTsvPath = join(TMP_DIR, 'ableton-project-audit.tsv');
const tsv = `${toTsv(auditedProjects)}\n`;

await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(stableJsonPath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(tsvPath, tsv);
await writeFile(stableTsvPath, tsv);

console.log(JSON.stringify({
  jsonPath: join(process.cwd(), jsonPath),
  stableJsonPath: join(process.cwd(), stableJsonPath),
  tsvPath: join(process.cwd(), tsvPath),
  stableTsvPath: join(process.cwd(), stableTsvPath),
  projectCount: report.projectCount,
  byContentStatus: report.byContentStatus,
  projectsWithMissingSamplesCount: report.projectsWithMissingSamplesCount,
  projectsWithRelocatedSampleCandidatesCount: report.projectsWithRelocatedSampleCandidatesCount,
  projectsWithUnresolvedMissingSamplesCount: report.projectsWithUnresolvedMissingSamplesCount,
  possiblyEmptyProjectsCount: report.possiblyEmptyProjectsCount,
  maxArrangementEndBeat: report.maxArrangementEndBeat,
}, null, 2));
