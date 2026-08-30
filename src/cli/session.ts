import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseCodexContextPressureCliOptions,
  probeCodexContextPressure
} from '../codex-context-pressure.js';
import {
  recoverContextSnapshotRotation,
  rotateContextSnapshotsAtomic
} from '../context-snapshot-rotation.js';
import { validateCcPanesSessionSnapshot } from '../ccpanes-session-snapshot.js';
import { buildCodexSessionIndex, writeCodexSessionJson } from '../codex-session-index.js';
import { validateCodexSessionIndexArtifact } from '../codex-session-index-artifact.js';
import { generateCodexHandoff } from '../codex-session-handoff.js';
import { buildSessionFederation, assertCodexSessionFederationProject, attachCcPanesAttribution } from '../session-federation.js';
import { probeResume } from '../resume-probe.js';
import { resolveCodexSessions, renderCodexSessionResolution, validateCodexSessionResolutionArtifact } from '../codex-session-resolver.js';
import { createRetentionManifest, validateCodexSessionRetentionManifest } from '../codex-session-handoff.js';
import { scanWorkspaceTasks } from '../workspace-scan.js';
import { runCodexSidebarCli, isCodexSidebarCliAction } from '../codex-sidebar-cli.js';
import { isPathInside } from '../paths.js';
import type { RunCliOptions } from '../cli-types.js';
import {
  gitStateForTask,
  isCodexSessionIndexAction,
  isCodexSessionsAction,
  parseCodexSessionsOptions,
  parseHandoffGenerateOptions,
  valueAfter
} from '../cli-shared.js';

export async function handleSessionCommands(
  args: string[],
  stdinText: string | undefined,
  options: RunCliOptions
): Promise<string | null> {
  const command = args[0];

  if (command === 'codex-context-pressure') {
    const parsed = parseCodexContextPressureCliOptions(args.slice(1));
    const result = await probeCodexContextPressure(parsed);
    return `${JSON.stringify(result, null, 2)}\n`;
  }

  if (command === 'codex-context-snapshot') {
    const action = args[1];
    if (action !== 'rotate' && action !== 'recover') {
      throw new Error(`unknown codex-context-snapshot command: ${action}`);
    }
    const rootValue = valueAfter(args, '--root');
    if (!rootValue) throw new Error('missing --root');
    const root = await fs.promises.realpath(path.resolve(rootValue));
    if (action === 'recover') {
      const report = await recoverContextSnapshotRotation(root);
      return `${JSON.stringify(report ?? {
        schema: 'ccpanes.context-snapshot-recovery.v1',
        status: 'no-pending-transaction'
      }, null, 2)}\n`;
    }
    const nextValue = valueAfter(args, '--next');
    const expectedCurrentSha256 = valueAfter(
      args,
      '--expected-current-sha256'
    );
    if (!nextValue) throw new Error('missing --next');
    if (!expectedCurrentSha256) {
      throw new Error('missing --expected-current-sha256');
    }
    const nextPath = await fs.promises.realpath(path.resolve(nextValue));
    if (!isPathInside(root, nextPath)) {
      throw new Error('--next must resolve inside --root');
    }
    const nextStat = await fs.promises.lstat(nextPath);
    if (!nextStat.isFile() || nextStat.isSymbolicLink()) {
      throw new Error('--next must be a regular file');
    }
    const report = await rotateContextSnapshotsAtomic({
      root,
      nextContent: await readFile(nextPath, 'utf8'),
      expectedCurrentSha256
    });
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  if (command === 'codex-sessions') {
    const action = args[1];
    if (!isCodexSessionsAction(action)) {
      throw new Error(`unknown codex-sessions command: ${action}`);
    }
    if (isCodexSidebarCliAction(action)) {
      return runCodexSidebarCli(
        action,
        args.slice(2),
        options.createCodexAppServerClient
      );
    }
    if (!isCodexSessionIndexAction(action)) {
      throw new Error(`unknown codex-sessions command: ${action}`);
    }
    const parsed = parseCodexSessionsOptions(action, args.slice(2));
    const project = parsed.project !== null && (
      parsed.action === 'graph' || parsed.snapshotPath !== null
    )
      ? assertCodexSessionFederationProject(parsed.project)
      : parsed.project;
    const codexRoot = path.join(os.homedir(), '.codex');
    const sessionsDir = parsed.sessionsDir ?? path.join(codexRoot, 'sessions');
    const stateDb = parsed.stateDb ?? path.join(codexRoot, 'state_5.sqlite');
    const threadHistoryDb = parsed.threadHistoryDb ?? path.join(codexRoot, 'thread_history_1.sqlite');
    const taskContext = parsed.taskContextPath ??
      (project && fs.existsSync(path.join(project, '.ccpanes-task', 'current-task.json'))
        ? path.join(project, '.ccpanes-task', 'current-task.json')
        : null);
    const snapshot = parsed.snapshotPath
      ? validateCcPanesSessionSnapshot(
          JSON.parse(await readFile(path.resolve(parsed.snapshotPath), 'utf8'))
        )
      : null;
    const index = await buildCodexSessionIndex({
      sessionsDir,
      stateDb,
      threadHistoryDb,
      taskContext,
      project
    });
    const enrichedSessions = project
      ? attachCcPanesAttribution({
          project,
          sessions: index.sessions,
          ccpanes: snapshot
        })
      : index.sessions;
    const enrichedIndex = validateCodexSessionIndexArtifact({
      ...index,
      sessions: enrichedSessions
    });
    const projectedSessions = enrichedIndex.sessions;
    if (parsed.action === 'scan') {
      const outPath = parsed.outPath ?? path.join(process.cwd(), 'live', 'codex-session-index.json');
      await writeCodexSessionJson(outPath, enrichedIndex);
      return `${JSON.stringify(enrichedIndex, null, 2)}\n`;
    }
    if (parsed.action === 'resolve') {
      if (!project) throw new Error('missing --project');
      const result = validateCodexSessionResolutionArtifact(
        resolveCodexSessions(projectedSessions, project, {
          includeArchived: parsed.includeArchived,
          includeSubagents: parsed.includeSubagents,
          includeRelated: parsed.includeRelated,
          includeAmbient: parsed.includeAmbient
        })
      );
      return parsed.json ? `${JSON.stringify(result, null, 2)}\n` : renderCodexSessionResolution(result);
    }
    if (parsed.action === 'retention') {
      const manifest = validateCodexSessionRetentionManifest(
        createRetentionManifest(projectedSessions)
      );
      const outPath = parsed.outPath ?? path.join(process.cwd(), 'live', 'session-retention-manifest.json');
      await writeCodexSessionJson(outPath, manifest);
      return `${JSON.stringify(manifest, null, 2)}\n`;
    }
    if (parsed.action === 'graph') {
      if (!project) throw new Error('missing --project');
      const federation = buildSessionFederation({
        project,
        codexSessions: projectedSessions,
        ccpanes: snapshot
      });
      const outPath = parsed.outPath ??
        path.join(process.cwd(), 'live', 'session-federation.json');
      await writeCodexSessionJson(outPath, federation);
      return `${JSON.stringify(federation, null, 2)}\n`;
    }
  }

  if (command === 'handoff' && args[1] === 'generate') {
    const parsed = parseHandoffGenerateOptions(args.slice(2));
    const { project, mode } = parsed;
    const codexRoot = path.join(os.homedir(), '.codex');
    const sessionsDir = parsed.sessionsDir ?? path.join(codexRoot, 'sessions');
    const stateDb = parsed.stateDb ?? path.join(codexRoot, 'state_5.sqlite');
    const threadHistoryDb = parsed.threadHistoryDb ?? path.join(codexRoot, 'thread_history_1.sqlite');
    const defaultTaskContextPath = path.join(
      project,
      '.ccpanes-task',
      'current-task.json'
    );
    const taskContextPath = parsed.taskContextPath ??
      (fs.existsSync(defaultTaskContextPath) ? defaultTaskContextPath : null);
    const indexPath = parsed.indexPath ??
      path.join(process.cwd(), 'live', 'codex-session-index.json');
    const index = await buildCodexSessionIndex({ sessionsDir, stateDb, threadHistoryDb, taskContext: taskContextPath, project });
    const resolution = resolveCodexSessions(index.sessions, project);
    return `${await generateCodexHandoff({ mode, project, indexPath, taskContextPath, resolution })}\n`;
  }

  if (command === 'probe') {
    const utterance = valueAfter(args, '--utterance') ?? '';
    const session = valueAfter(args, '--session');
    const workspaceRoot = valueAfter(args, '--workspace-root');
    if (workspaceRoot) {
      const scan = await scanWorkspaceTasks(workspaceRoot);
      const tasks = scan.tasks.map((item) => item.task);
      const gitStates = new Map<string, ReturnType<typeof gitStateForTask>>();
      for (const task of tasks) {
        gitStates.set(task.worktreeRoot, gitStateForTask(task));
      }
      const result = probeResume({ utterance, currentSessionId: session, tasks, gitStates });
      return `${JSON.stringify({ ...result, scanErrors: scan.errors }, null, 2)}\n`;
    }
    const result = probeResume({ utterance, currentSessionId: session, tasks: [], gitStates: new Map() });
    return `${JSON.stringify(result, null, 2)}\n`;
  }

  return null;
}
