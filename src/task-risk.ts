export type TaskRiskTier = 'light' | 'standard' | 'heavy';

export interface TaskRiskDimensions {
  touchesCode: boolean;
  crossesPackages: boolean;
  breaksInterface: boolean;
  touchesUserConfig: boolean;
  externalSideEffect: boolean;
  migration: boolean;
  destructive: boolean;
  security: boolean;
  production: boolean;
}

export interface TaskRiskResult {
  schema: 'ccpanes.task-risk.v1';
  tier: TaskRiskTier;
  reason: string;
  signals: string[];
  dimensions: TaskRiskDimensions;
  promptLength: number;
  cwd: string | null;
}

export interface ClassifyTaskRiskInput {
  prompt: string;
  cwd?: string | null;
}

const codePathPattern = /(?:^|[\s`"'（(])(?:[A-Za-z]:[\\/][^\s`"')）]+|\.{1,2}[\\/][^\s`"')）]+|[A-Za-z_][A-Za-z0-9_.-]{0,60}[\\/][^\s`"')）]+|[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|rs|py|go|java|toml|ya?ml|sh|ps1|css|html|sql))(?:$|[\s`"',.，。；;)）])/u;
const intentVerbPattern = /\b(implement|fix|bugfix|refactor|rewrite|modify|edit|update|add|remove|delete|build|wire|integrate|change)\b|实现|修复|修改|编辑|更新|新增|添加|删除|移除|重构|重写|改造|接入|增强/u;
const explanatoryPattern = /\b(explain|why|what is|how does|how to|compare|reference value|review whether)\b|解释|说明|介绍|为什么|是什么|怎么|如何|有没有参考价值|是否有参考价值/u;
const questionPattern = /[?？]|\b(can you explain|could you explain|tell me|怎么看)\b|请问|能否说明/u;
const codeObjectPattern = /\b(src|test|tests|lib|package|packages|component|hook|cli|api|schema|module|function|class|config|typescript|javascript|node|vitest)\b|代码|文件|模块|函数|接口|配置|测试|组件/u;
const productionPattern = /\b(prod|production|deploy|release|publish|ship|rollout|cutover)\b|生产|上线|部署|发布|发版|投产|切流/u;
const migrationPattern = /\b(migrate|migration|schema|database|db|ddl|backfill)\b|迁移|数据库|数据表|表结构|回填|重建/u;
const securityPattern = /\b(auth|permission|credential|secret|token|certificate|security|vulnerability|oauth|acl|rbac)\b|认证|授权|权限|凭据|密钥|令牌|证书|安全|漏洞/u;
const userConfigPattern = /\.codex|\.claude|\.cc-panes|hooks\.json|config\.toml|providers\.json|launch-profiles\.json|用户配置|全局配置/u;
const externalSideEffectPattern = /\b(git\s+push|npm\s+publish|pnpm\s+publish|yarn\s+npm\s+publish|terraform\s+apply|kubectl\s+apply|gh\s+pr\s+merge)\b|远端写入|推送|发布包/u;
const destructivePattern = /\b(reset\s+--hard|git\s+clean|drop|delete|remove|destroy|destructive|irreversible|breaking)\b|删除|移除|破坏|不可逆|清空|重置/u;
const interfacePattern = /\b(api|interface|contract|endpoint|protocol|schema|public)\b|接口|契约|协议|端点|公开/u;
const breakingInterfacePattern = /\b(breaking change|break api|break interface|break contract|remove endpoint|delete endpoint|drop endpoint|rename endpoint|deprecate api|deprecate endpoint)\b|破坏.*(api|接口|契约|协议)|删除.*(endpoint|接口|端点)|移除.*(endpoint|接口|端点)|重命名.*(endpoint|接口|端点)/u;
const policyIntentPattern = /\bpolicy\b|策略|禁止|不要|阻止|限制|允许|开放|放开|清除|解除/u;

function normalizePrompt(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim().toLowerCase();
}

function hasCodeObject(prompt: string): boolean {
  return codePathPattern.test(prompt) || codeObjectPattern.test(prompt);
}

function isExplanatoryQuestion(prompt: string, normalized: string): boolean {
  return (questionPattern.test(prompt) || explanatoryPattern.test(normalized)) && !intentVerbPattern.test(prompt);
}

function topLevelPathSegments(prompt: string): string[] {
  const segments = new Set<string>();
  const tokens = prompt
    .replace(/[^\p{L}\p{N}_./\\` -]+/gu, ' ')
    .split(/[\s`]+/u)
    .filter(Boolean);
  for (const token of tokens) {
    const normalized = token.replace(/\\/g, '/');
    if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('http://') || normalized.startsWith('https://')) continue;
    const match = normalized.match(/^([A-Za-z_][A-Za-z0-9_.-]{0,40})\/.+/u);
    if (match?.[1]) segments.add(match[1]);
  }
  return [...segments].sort();
}

function addSignal(signals: string[], name: string, present: boolean): void {
  if (present) signals.push(name);
}

export function classifyTaskRisk(input: ClassifyTaskRiskInput): TaskRiskResult {
  const prompt = input.prompt ?? '';
  const normalized = normalizePrompt(prompt);
  const pathSegments = topLevelPathSegments(prompt);
  const policyIntent = policyIntentPattern.test(normalized);
  const dimensions: TaskRiskDimensions = {
    touchesCode: hasCodeObject(prompt) || intentVerbPattern.test(prompt),
    crossesPackages: pathSegments.length >= 2,
    breaksInterface: !policyIntent && (breakingInterfacePattern.test(normalized) || (interfacePattern.test(normalized) && destructivePattern.test(normalized))),
    touchesUserConfig: userConfigPattern.test(normalized),
    externalSideEffect: !policyIntent && externalSideEffectPattern.test(normalized),
    migration: !policyIntent && migrationPattern.test(normalized),
    destructive: !policyIntent && destructivePattern.test(normalized),
    security: !policyIntent && securityPattern.test(normalized),
    production: !policyIntent && productionPattern.test(normalized)
  };

  const signals: string[] = [];
  addSignal(signals, 'explanatory-question', isExplanatoryQuestion(prompt, normalized));
  addSignal(signals, 'intent-verb', intentVerbPattern.test(prompt));
  addSignal(signals, 'code-object', hasCodeObject(prompt));
  addSignal(signals, 'crosses-packages', dimensions.crossesPackages);
  addSignal(signals, 'breaks-interface', dimensions.breaksInterface);
  addSignal(signals, 'touches-user-config', dimensions.touchesUserConfig);
  addSignal(signals, 'external-side-effect', dimensions.externalSideEffect);
  addSignal(signals, 'migration', dimensions.migration);
  addSignal(signals, 'destructive', dimensions.destructive);
  addSignal(signals, 'security', dimensions.security);
  addSignal(signals, 'production', dimensions.production);

  let tier: TaskRiskTier = 'light';
  let reason = 'no_concrete_task_signal';
  if (signals.includes('explanatory-question') && !dimensions.touchesCode) {
    tier = 'light';
    reason = 'explanatory_question';
  } else if (
    dimensions.production ||
    dimensions.migration ||
    dimensions.touchesUserConfig ||
    dimensions.externalSideEffect ||
    dimensions.security ||
    dimensions.breaksInterface ||
    (dimensions.destructive && dimensions.touchesCode)
  ) {
    tier = 'heavy';
    reason = 'heavy_risk_signal';
  } else if (dimensions.touchesCode || intentVerbPattern.test(prompt)) {
    tier = 'standard';
    reason = 'standard_code_task';
  }

  return {
    schema: 'ccpanes.task-risk.v1',
    tier,
    reason,
    signals,
    dimensions,
    promptLength: prompt.length,
    cwd: input.cwd ?? null
  };
}
