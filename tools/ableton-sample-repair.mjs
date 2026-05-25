#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const TMP_DIR = 'tmp';
const AUDIT_PATH = join(TMP_DIR, 'ableton-project-audit.json');
const REPAIR_PATH = join(TMP_DIR, 'ableton-sample-repair-plan.json');
const ZIP_SOURCES = [
  '/Users/luke/Downloads/ANALOG MAGIC ONE SHOT KIT-20230504T024646Z-001.zip',
];
const ROOT_RELOCATIONS = [
  {
    missingRoot: '/Users/luke/Desktop/si Project',
    targetRoot: '/Users/luke/Desktop/si-project',
  },
  {
    missingRoot: '/Users/luke/Desktop/render Project',
    targetRoot: '/Users/luke/Desktop/render-project',
  },
];

async function pathStatus(path) {
  try {
    const item = await lstat(path);
    return {
      exists: true,
      isDirectory: item.isDirectory(),
      isSymbolicLink: item.isSymbolicLink(),
    };
  } catch {
    return {
      exists: false,
      isDirectory: false,
      isSymbolicLink: false,
    };
  }
}

async function zipContains(zipPath, entryName) {
  try {
    await execFileAsync('unzip', ['-p', zipPath, entryName], {
      encoding: 'buffer',
      maxBuffer: 1024 * 1024 * 80,
    });
    return true;
  } catch {
    return false;
  }
}

function zipEntryForExpectedPath(expectedPath) {
  return relative('/Users/luke/Downloads', expectedPath);
}

async function buildPlan(audit) {
  const symlinks = [];
  for (const relocation of ROOT_RELOCATIONS) {
    const missingStatus = await pathStatus(relocation.missingRoot);
    const targetStatus = await pathStatus(relocation.targetRoot);
    symlinks.push({
      ...relocation,
      action: 'create-symlink',
      status: missingStatus.exists
        ? 'skip-existing-missing-root-path'
        : targetStatus.exists
          ? 'ready'
          : 'blocked-target-root-missing',
      missingRootStatus: missingStatus,
      targetRootStatus: targetStatus,
    });
  }

  const unresolvedSamplePaths = [
    ...new Set((audit.projectsWithUnresolvedMissingSamples || [])
      .flatMap(project => project.unresolvedMissingSamplePaths || [])),
  ];
  const extractions = [];
  for (const expectedPath of unresolvedSamplePaths) {
    const expectedStatus = await pathStatus(expectedPath);
    const entryName = zipEntryForExpectedPath(expectedPath);
    const matchingZip = expectedStatus.exists ? null : await findZipWithEntry(entryName);

    extractions.push({
      action: 'extract-single-zip-entry',
      expectedPath,
      entryName,
      zipPath: matchingZip,
      status: expectedStatus.exists
        ? 'skip-existing-expected-path'
        : matchingZip
          ? 'ready'
          : 'blocked-zip-entry-not-found',
      expectedPathStatus: expectedStatus,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: 'Ableton sample repair plan; apply mode only creates symlinks and extracts missing sample files, never edits .als files or deletes anything',
    auditPath: AUDIT_PATH,
    symlinks,
    extractions,
    readyActionCount: [...symlinks, ...extractions].filter(item => item.status === 'ready').length,
    blockedActionCount: [...symlinks, ...extractions].filter(item => item.status.startsWith('blocked')).length,
  };
}

async function findZipWithEntry(entryName) {
  for (const zipPath of ZIP_SOURCES) {
    if (!existsSync(zipPath)) continue;
    if (await zipContains(zipPath, entryName)) return zipPath;
  }
  return null;
}

async function applyPlan(plan) {
  const applied = [];
  const skipped = [];
  const blocked = [];

  for (const action of plan.symlinks) {
    if (action.status !== 'ready') {
      (action.status.startsWith('blocked') ? blocked : skipped).push(action);
      continue;
    }

    await symlink(action.targetRoot, action.missingRoot, 'dir');
    applied.push(action);
  }

  for (const action of plan.extractions) {
    if (action.status !== 'ready') {
      (action.status.startsWith('blocked') ? blocked : skipped).push(action);
      continue;
    }

    const { stdout } = await execFileAsync('unzip', ['-p', action.zipPath, action.entryName], {
      encoding: 'buffer',
      maxBuffer: 1024 * 1024 * 80,
    });
    await mkdir(dirname(action.expectedPath), { recursive: true });
    await writeFile(action.expectedPath, stdout);
    applied.push(action);
  }

  return {
    appliedCount: applied.length,
    skippedCount: skipped.length,
    blockedCount: blocked.length,
    applied,
    skipped,
    blocked,
  };
}

const command = process.argv[2] || 'plan';
if (!['plan', 'apply'].includes(command)) {
  throw new Error(`Unknown command "${command}". Use "plan" or "apply".`);
}

const audit = JSON.parse(await readFile(AUDIT_PATH, 'utf8'));
const plan = await buildPlan(audit);
await mkdir(TMP_DIR, { recursive: true });
await writeFile(REPAIR_PATH, `${JSON.stringify(plan, null, 2)}\n`);

if (command === 'plan') {
  console.log(JSON.stringify({
    repairPlanPath: join(process.cwd(), REPAIR_PATH),
    readyActionCount: plan.readyActionCount,
    blockedActionCount: plan.blockedActionCount,
    symlinks: plan.symlinks.map(item => ({
      missingRoot: item.missingRoot,
      targetRoot: item.targetRoot,
      status: item.status,
    })),
    extractions: plan.extractions.map(item => ({
      expectedPath: item.expectedPath,
      zipPath: item.zipPath,
      entryName: item.entryName,
      status: item.status,
    })),
  }, null, 2));
} else {
  const result = await applyPlan(plan);
  const appliedPlan = {
    ...plan,
    appliedAt: new Date().toISOString(),
    result,
  };
  await writeFile(REPAIR_PATH, `${JSON.stringify(appliedPlan, null, 2)}\n`);
  console.log(JSON.stringify({
    repairPlanPath: join(process.cwd(), REPAIR_PATH),
    appliedCount: result.appliedCount,
    skippedCount: result.skippedCount,
    blockedCount: result.blockedCount,
    applied: result.applied.map(item => ({
      action: item.action,
      path: item.missingRoot || item.expectedPath,
      target: item.targetRoot || item.zipPath,
    })),
    blocked: result.blocked.map(item => ({
      action: item.action,
      path: item.missingRoot || item.expectedPath,
      status: item.status,
    })),
  }, null, 2));
}
