import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface ProjectPolicyLedgerEntry {
  time: string;
  instruction: string;
  effectiveAction: string;
  notes: string;
}

export function projectPolicyLedgerPath(projectRoot: string): string {
  return path.join(projectRoot, '.ccpanes-task', 'policy.md');
}

export function defaultProjectPolicyLedger(): string {
  return [
    '# CC-Panes Project Policy Ledger',
    '',
    'This file is project-local. It records conversation-level constraints that Codex should apply alongside mechanical hooks.',
    '',
    '## Effective rules',
    '',
    '- No project-specific rules recorded yet.',
    '',
    '## Rule log',
    '',
    '| Time | User instruction | Effective action | Notes |',
    '|---|---|---|---|',
    '|  |  |  |  |',
    '',
    '## Mechanical counterpart',
    '',
    '- Executable rules live in `.ccpanes-task/policy.json`.',
    '- Use `policy-capture-plan` for clear plan-stage rules, `policy-capture` for exact conversation rules, and `policy-add`, `policy-disable`, `policy-clear`, `policy-list`, and `policy-validate` for mechanical rule management.',
    ''
  ].join('\n');
}

async function writeTextAtomic(filePath: string, text: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, text, 'utf8');
  await rename(tempPath, filePath);
}

export async function ensureProjectPolicyLedger(projectRoot: string): Promise<boolean> {
  const ledgerPath = projectPolicyLedgerPath(projectRoot);
  try {
    await readFile(ledgerPath, 'utf8');
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await writeTextAtomic(ledgerPath, defaultProjectPolicyLedger());
  return true;
}

function escapeMarkdownTableCell(value: string): string {
  return value
    .replace(/\r?\n/g, '<br>')
    .replace(/\|/g, '\\|')
    .trim();
}

export async function appendProjectPolicyLedgerEntry(projectRoot: string, entry: ProjectPolicyLedgerEntry): Promise<boolean> {
  const ledgerPath = projectPolicyLedgerPath(projectRoot);
  await ensureProjectPolicyLedger(projectRoot);
  const existing = await readFile(ledgerPath, 'utf8');
  const prefix = existing.endsWith('\n') ? existing : `${existing}\n`;
  const row = `| ${escapeMarkdownTableCell(entry.time)} | ${escapeMarkdownTableCell(entry.instruction)} | ${escapeMarkdownTableCell(entry.effectiveAction)} | ${escapeMarkdownTableCell(entry.notes)} |\n`;
  await writeTextAtomic(ledgerPath, `${prefix}${row}`);
  return true;
}
