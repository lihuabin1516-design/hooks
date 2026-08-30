import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const CURRENT_NAME = 'context.md';
const PREVIOUS_NAME = 'context.prev.md';
const PREVIOUS2_NAME = 'context.prev2.md';
const JOURNAL_NAME = '.context-rotation.json';
const LOCK_NAME = '.context-rotation.lock';

const REQUIRED_SECTIONS = [
  '## 0. 快照元信息',
  '## 1. 当前任务',
  '## 2. 当前进度',
  '## 3. 当前卡点',
  '## 4. 下一步',
  '## 5. 上下文快照保留策略',
  '## 6. 避坑点',
  '## 7. 上下文压缩后的恢复步骤',
  '## 8. 本轮增量',
  '## 9. 更新检查清单'
] as const;

type SnapshotName =
  | typeof CURRENT_NAME
  | typeof PREVIOUS_NAME
  | typeof PREVIOUS2_NAME;

interface SnapshotDocument {
  content: string;
  generation: number;
  sha256: string;
}

interface StagedSnapshot {
  destination: SnapshotName;
  stageName: string;
  sha256: string;
  generation: number;
}

interface ContextSnapshotTransaction {
  schema: 'ccpanes.context-snapshot-transaction.v1';
  transactionId: string;
  createdAt: string;
  beforeGeneration: number;
  afterGeneration: number;
  currentSha256Before: string;
  targets: StagedSnapshot[];
}

export interface ContextSnapshotRotationReport {
  schema: 'ccpanes.context-snapshot-rotation.v1';
  status: 'completed';
  recoveredTransaction: boolean;
  beforeGeneration: number;
  afterGeneration: number;
  currentSha256Before: string;
  currentSha256After: string;
  previousSha256After: string;
  previous2Sha256After: string | null;
  completedAt: string;
}

export interface RotateContextSnapshotsInput {
  root: string;
  nextContent: string;
  expectedCurrentSha256: string;
  now?: string;
  faultAfterDestinationForTest?: SnapshotName;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseSnapshot(content: string, name: SnapshotName): SnapshotDocument {
  if (!content.startsWith('# 上下文压缩后先读 `context.md`')) {
    throw new Error(`${name} has an invalid first heading`);
  }
  for (const section of REQUIRED_SECTIONS) {
    if (!content.includes(section)) {
      throw new Error(`missing required section: ${section}`);
    }
  }
  if (!/^schema:\s*ccpanes\.context\.v1\s*$/mu.test(content)) {
    throw new Error(`${name} has an invalid context schema`);
  }
  if (!/^retentionPolicy:\s*current-plus-two-previous\s*$/mu.test(content)) {
    throw new Error(`${name} has an invalid retention policy`);
  }
  const generationMatch = content.match(
    /^snapshotGeneration:\s*([1-9][0-9]*)\s*$/mu
  );
  if (!generationMatch) {
    throw new Error(`${name} has an invalid snapshot generation`);
  }
  const generation = Number(generationMatch[1]);
  if (!Number.isSafeInteger(generation)) {
    throw new Error(`${name} snapshot generation is outside the safe range`);
  }
  return {
    content,
    generation,
    sha256: sha256(content)
  };
}

async function resolvedRoot(root: string): Promise<string> {
  const resolved = path.resolve(root);
  const stat = await fs.lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('context snapshot root must be a real directory');
  }
  return fs.realpath(resolved);
}

async function assertRegularFileIfPresent(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`${path.basename(filePath)} must be a regular file`);
    }
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false;
    }
    throw error;
  }
}

async function readSnapshot(
  root: string,
  name: SnapshotName,
  required: boolean
): Promise<SnapshotDocument | null> {
  const filePath = path.join(root, name);
  const exists = await assertRegularFileIfPresent(filePath);
  if (!exists) {
    if (required) throw new Error(`${name} is required`);
    return null;
  }
  return parseSnapshot(await fs.readFile(filePath, 'utf8'), name);
}

function validateChain(
  current: SnapshotDocument,
  previous: SnapshotDocument | null,
  previous2: SnapshotDocument | null
): void {
  if (previous && previous.generation !== current.generation - 1) {
    throw new Error('context.prev.md generation is not immediately previous');
  }
  if (!previous && previous2) {
    throw new Error('context.prev2.md exists without context.prev.md');
  }
  if (previous2 && previous2.generation !== current.generation - 2) {
    throw new Error('context.prev2.md generation is not two generations behind');
  }
}

async function writeFileDurableExclusive(
  filePath: string,
  text: string
): Promise<void> {
  const handle = await fs.open(filePath, 'wx');
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeJsonAtomic(
  root: string,
  name: string,
  value: unknown
): Promise<void> {
  const finalPath = path.join(root, name);
  const tempPath = path.join(
    root,
    `${name}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    await writeFileDurableExclusive(
      tempPath,
      `${JSON.stringify(value, null, 2)}\n`
    );
    await fs.rename(tempPath, finalPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'EPERM'
    ) {
      return true;
    }
    return false;
  }
}

async function acquireLock(root: string): Promise<() => Promise<void>> {
  const lockPath = path.join(root, LOCK_NAME);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFileDurableExclusive(
        lockPath,
        `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`
      );
      return async () => {
        await fs.rm(lockPath, { force: true });
      };
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      ) {
        throw error;
      }
      let live = true;
      try {
        const lock = asRecord(JSON.parse(await fs.readFile(lockPath, 'utf8')));
        live = processIsAlive(Number(lock?.pid));
      } catch {
        live = false;
      }
      if (live) {
        throw new Error('context snapshot rotation is already active');
      }
      await fs.rm(lockPath, { force: true });
    }
  }
  throw new Error('failed to acquire context snapshot rotation lock');
}

function validateSha256(value: string, field: string): string {
  if (!/^[0-9A-F]{64}$/u.test(value)) {
    throw new Error(`${field} must be an uppercase SHA-256`);
  }
  return value;
}

function validateStagedSnapshot(value: unknown): StagedSnapshot {
  const record = asRecord(value);
  if (!record) throw new Error('invalid staged snapshot');
  const destination = record.destination;
  if (
    destination !== CURRENT_NAME &&
    destination !== PREVIOUS_NAME &&
    destination !== PREVIOUS2_NAME
  ) {
    throw new Error('invalid staged snapshot destination');
  }
  if (
    typeof record.stageName !== 'string' ||
    !/^\.context-rotation-[0-9a-f-]+\.(current|previous|previous2)\.stage$/u
      .test(record.stageName)
  ) {
    throw new Error('invalid staged snapshot name');
  }
  if (!Number.isSafeInteger(record.generation) || Number(record.generation) <= 0) {
    throw new Error('invalid staged snapshot generation');
  }
  return {
    destination,
    stageName: record.stageName,
    sha256: validateSha256(String(record.sha256), 'staged snapshot SHA-256'),
    generation: Number(record.generation)
  };
}

function validateTransaction(value: unknown): ContextSnapshotTransaction {
  const record = asRecord(value);
  if (
    !record ||
    record.schema !== 'ccpanes.context-snapshot-transaction.v1' ||
    typeof record.transactionId !== 'string' ||
    typeof record.createdAt !== 'string' ||
    !Number.isSafeInteger(record.beforeGeneration) ||
    !Number.isSafeInteger(record.afterGeneration) ||
    !Array.isArray(record.targets)
  ) {
    throw new Error('invalid context snapshot transaction journal');
  }
  const targets = record.targets.map(validateStagedSnapshot);
  const destinations = new Set(targets.map((target) => target.destination));
  if (
    !destinations.has(CURRENT_NAME) ||
    !destinations.has(PREVIOUS_NAME) ||
    destinations.size !== targets.length
  ) {
    throw new Error('invalid context snapshot transaction targets');
  }
  return {
    schema: 'ccpanes.context-snapshot-transaction.v1',
    transactionId: record.transactionId,
    createdAt: record.createdAt,
    beforeGeneration: Number(record.beforeGeneration),
    afterGeneration: Number(record.afterGeneration),
    currentSha256Before: validateSha256(
      String(record.currentSha256Before),
      'current SHA-256 before'
    ),
    targets
  };
}

async function stageSnapshot(
  root: string,
  transactionId: string,
  label: 'current' | 'previous' | 'previous2',
  destination: SnapshotName,
  snapshot: SnapshotDocument
): Promise<StagedSnapshot> {
  const stageName = `.context-rotation-${transactionId}.${label}.stage`;
  await writeFileDurableExclusive(
    path.join(root, stageName),
    snapshot.content
  );
  return {
    destination,
    stageName,
    sha256: snapshot.sha256,
    generation: snapshot.generation
  };
}

async function atomicReplaceFromStage(
  root: string,
  transactionId: string,
  target: StagedSnapshot
): Promise<void> {
  const stagePath = path.join(root, target.stageName);
  if (!await assertRegularFileIfPresent(stagePath)) {
    throw new Error(`staged ${target.destination} is missing`);
  }
  const content = await fs.readFile(stagePath, 'utf8');
  if (sha256(content) !== target.sha256) {
    throw new Error(`staged ${target.destination} SHA-256 mismatch`);
  }
  const parsed = parseSnapshot(content, target.destination);
  if (parsed.generation !== target.generation) {
    throw new Error(`staged ${target.destination} generation mismatch`);
  }
  const tempPath = path.join(
    root,
    `.${target.destination}.${transactionId}.${process.pid}.tmp`
  );
  try {
    await writeFileDurableExclusive(tempPath, content);
    await fs.rename(tempPath, path.join(root, target.destination));
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

async function cleanupTransaction(
  root: string,
  transaction: ContextSnapshotTransaction
): Promise<void> {
  for (const target of transaction.targets) {
    await fs.rm(path.join(root, target.stageName), { force: true });
  }
  await fs.rm(path.join(root, JOURNAL_NAME), { force: true });
}

function targetFor(
  transaction: ContextSnapshotTransaction,
  destination: SnapshotName
): StagedSnapshot {
  const target = transaction.targets.find(
    (candidate) => candidate.destination === destination
  );
  if (!target) throw new Error(`transaction target missing: ${destination}`);
  return target;
}

async function applyTransaction(
  root: string,
  transaction: ContextSnapshotTransaction,
  recoveredTransaction: boolean,
  now: string,
  faultAfterDestinationForTest?: SnapshotName
): Promise<ContextSnapshotRotationReport> {
  const order: SnapshotName[] = transaction.targets.some(
    (target) => target.destination === PREVIOUS2_NAME
  )
    ? [PREVIOUS2_NAME, PREVIOUS_NAME, CURRENT_NAME]
    : [PREVIOUS_NAME, CURRENT_NAME];
  for (const destination of order) {
    await atomicReplaceFromStage(
      root,
      transaction.transactionId,
      targetFor(transaction, destination)
    );
    if (faultAfterDestinationForTest === destination) {
      throw new Error('synthetic context rotation interruption');
    }
  }

  const current = await readSnapshot(root, CURRENT_NAME, true);
  const previous = await readSnapshot(root, PREVIOUS_NAME, true);
  const previous2 = await readSnapshot(root, PREVIOUS2_NAME, false);
  if (!current || !previous) throw new Error('rotation verification failed');
  validateChain(current, previous, previous2);
  if (
    current.generation !== transaction.afterGeneration ||
    current.sha256 !== targetFor(transaction, CURRENT_NAME).sha256
  ) {
    throw new Error('context.md did not reach the committed transaction state');
  }
  await cleanupTransaction(root, transaction);
  return {
    schema: 'ccpanes.context-snapshot-rotation.v1',
    status: 'completed',
    recoveredTransaction,
    beforeGeneration: transaction.beforeGeneration,
    afterGeneration: transaction.afterGeneration,
    currentSha256Before: transaction.currentSha256Before,
    currentSha256After: current.sha256,
    previousSha256After: previous.sha256,
    previous2Sha256After: previous2?.sha256 ?? null,
    completedAt: now
  };
}

async function readPendingTransaction(
  root: string
): Promise<ContextSnapshotTransaction | null> {
  const journalPath = path.join(root, JOURNAL_NAME);
  const exists = await assertRegularFileIfPresent(journalPath);
  if (!exists) return null;
  return validateTransaction(JSON.parse(await fs.readFile(journalPath, 'utf8')));
}

async function recoverLocked(
  root: string,
  now: string
): Promise<ContextSnapshotRotationReport | null> {
  const transaction = await readPendingTransaction(root);
  return transaction
    ? applyTransaction(root, transaction, true, now)
    : null;
}

export async function recoverContextSnapshotRotation(
  root: string,
  now = new Date().toISOString()
): Promise<ContextSnapshotRotationReport | null> {
  const trustedRoot = await resolvedRoot(root);
  const release = await acquireLock(trustedRoot);
  try {
    return await recoverLocked(trustedRoot, now);
  } finally {
    await release();
  }
}

export async function rotateContextSnapshotsAtomic(
  input: RotateContextSnapshotsInput
): Promise<ContextSnapshotRotationReport> {
  const root = await resolvedRoot(input.root);
  const expectedCurrentSha256 = validateSha256(
    input.expectedCurrentSha256,
    'expected current SHA-256'
  );
  const now = input.now ?? new Date().toISOString();
  const release = await acquireLock(root);
  try {
    const recovered = await recoverLocked(root, now);
    if (
      recovered &&
      recovered.currentSha256Before === expectedCurrentSha256 &&
      recovered.currentSha256After === sha256(input.nextContent)
    ) {
      return recovered;
    }

    const current = await readSnapshot(root, CURRENT_NAME, true);
    const previous = await readSnapshot(root, PREVIOUS_NAME, false);
    const previous2 = await readSnapshot(root, PREVIOUS2_NAME, false);
    if (!current) throw new Error('context.md is required');
    validateChain(current, previous, previous2);
    if (current.sha256 !== expectedCurrentSha256) {
      throw new Error('current context SHA-256 changed');
    }
    const next = parseSnapshot(input.nextContent, CURRENT_NAME);
    const expectedGeneration = current.generation + 1;
    if (next.generation !== expectedGeneration) {
      throw new Error(
        `next snapshot generation must be ${expectedGeneration}`
      );
    }

    const transactionId = randomUUID();
    const targets: StagedSnapshot[] = [];
    try {
      if (previous) {
        targets.push(await stageSnapshot(
          root,
          transactionId,
          'previous2',
          PREVIOUS2_NAME,
          previous
        ));
      }
      targets.push(await stageSnapshot(
        root,
        transactionId,
        'previous',
        PREVIOUS_NAME,
        current
      ));
      targets.push(await stageSnapshot(
        root,
        transactionId,
        'current',
        CURRENT_NAME,
        next
      ));
      const transaction: ContextSnapshotTransaction = {
        schema: 'ccpanes.context-snapshot-transaction.v1',
        transactionId,
        createdAt: now,
        beforeGeneration: current.generation,
        afterGeneration: next.generation,
        currentSha256Before: current.sha256,
        targets
      };
      await writeJsonAtomic(root, JOURNAL_NAME, transaction);
      return await applyTransaction(
        root,
        transaction,
        false,
        now,
        input.faultAfterDestinationForTest
      );
    } catch (error) {
      const journalExists = await assertRegularFileIfPresent(
        path.join(root, JOURNAL_NAME)
      );
      if (!journalExists) {
        for (const target of targets) {
          await fs.rm(path.join(root, target.stageName), { force: true });
        }
      }
      throw error;
    }
  } finally {
    await release();
  }
}
