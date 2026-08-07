import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPathInside } from './paths.js';

export interface AgentsInstallResult {
  schema: 'ccpanes.agents-entry-result.v1';
  path: string;
  changed: boolean;
  action: 'created' | 'updated' | 'unchanged';
  markerPresent: boolean;
  templatePath: string;
}

export interface AgentsValidateResult {
  schema: 'ccpanes.agents-entry-validate.v1';
  path: string;
  exists: boolean;
  markerPresent: boolean;
  valid: boolean;
}

export const AGENTS_BEGIN_MARKER = '<!-- ccpanes-hooks:begin -->';
export const AGENTS_END_MARKER = '<!-- ccpanes-hooks:end -->';

function agentsPath(projectRoot: string): string {
  return path.join(projectRoot, 'AGENTS.md');
}

function defaultTemplateCandidates(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.resolve(here, '..', '..', 'templates', 'AGENTS.ccpanes-hooks.md'),
    path.resolve(here, '..', 'templates', 'AGENTS.ccpanes-hooks.md')
  ];
}

async function firstExistingPath(paths: string[]): Promise<string> {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  throw new Error(`missing AGENTS template: ${paths.join('; ')}`);
}

async function readTemplate(templatePath?: string | null): Promise<{ path: string; text: string }> {
  const resolvedTemplatePath = templatePath ? path.resolve(templatePath) : await firstExistingPath(defaultTemplateCandidates());
  return {
    path: resolvedTemplatePath,
    text: await readFile(resolvedTemplatePath, 'utf8')
  };
}

function renderManagedBlock(templateText: string): string {
  return [
    AGENTS_BEGIN_MARKER,
    templateText.trim(),
    AGENTS_END_MARKER
  ].join('\n');
}

function mergeManagedBlock(existingText: string | null, block: string): { text: string; markerPresent: boolean } {
  if (existingText === null || existingText.trim().length === 0) {
    return { text: `${block}\n`, markerPresent: false };
  }

  const begin = existingText.indexOf(AGENTS_BEGIN_MARKER);
  const end = existingText.indexOf(AGENTS_END_MARKER);
  if (begin !== -1 && end !== -1 && end > begin) {
    const afterEnd = end + AGENTS_END_MARKER.length;
    return {
      text: `${existingText.slice(0, begin)}${block}${existingText.slice(afterEnd)}`,
      markerPresent: true
    };
  }

  const separator = existingText.endsWith('\n') ? '\n' : '\n\n';
  return {
    text: `${existingText}${separator}${block}\n`,
    markerPresent: false
  };
}

export async function installAgentsEntry(projectRoot: string, templatePath?: string | null): Promise<AgentsInstallResult> {
  const root = path.resolve(projectRoot);
  const targetPath = agentsPath(root);
  if (!isPathInside(root, targetPath)) throw new Error('AGENTS.md path must stay inside project root');
  const template = await readTemplate(templatePath);
  let existingText: string | null = null;
  try {
    existingText = await readFile(targetPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const { text, markerPresent } = mergeManagedBlock(existingText, renderManagedBlock(template.text));
  if (existingText === text) {
    return {
      schema: 'ccpanes.agents-entry-result.v1',
      path: targetPath,
      changed: false,
      action: 'unchanged',
      markerPresent: true,
      templatePath: template.path
    };
  }
  await mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = path.join(path.dirname(targetPath), `AGENTS.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, text, 'utf8');
  await rename(tempPath, targetPath);
  return {
    schema: 'ccpanes.agents-entry-result.v1',
    path: targetPath,
    changed: true,
    action: existingText === null ? 'created' : 'updated',
    markerPresent,
    templatePath: template.path
  };
}

export async function validateAgentsEntry(projectRoot: string): Promise<AgentsValidateResult> {
  const root = path.resolve(projectRoot);
  const targetPath = agentsPath(root);
  let text: string;
  try {
    text = await readFile(targetPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        schema: 'ccpanes.agents-entry-validate.v1',
        path: targetPath,
        exists: false,
        markerPresent: false,
        valid: false
      };
    }
    throw error;
  }
  const begin = text.indexOf(AGENTS_BEGIN_MARKER);
  const end = text.indexOf(AGENTS_END_MARKER);
  const markerPresent = begin !== -1 && end !== -1 && end > begin;
  return {
    schema: 'ccpanes.agents-entry-validate.v1',
    path: targetPath,
    exists: true,
    markerPresent,
    valid: markerPresent
  };
}
