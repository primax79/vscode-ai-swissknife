import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Supported scopes for Claude Code plugins. */
export type ClaudePluginScope = 'user' | 'project' | 'local';

/**
 * Domain representation of an installed Claude Code plugin.
 */
export interface ClaudePlugin {
  id: string;
  name: string;
  marketplace: string;
  version: string;
  scope: ClaudePluginScope;
  enabled: boolean;
  installPath: string;
  projectPath?: string;
  projectEnabled?: boolean;
  installedAt: string;
  lastUpdated: string;
}

/** Component inventory discovered inside a plugin. */
export interface ClaudePluginComponents {
  skills: string[];
  agents: string[];
  commands?: string[];
  hooks: string[];
  mcpServers: string[];
  lspServers: string[];
}

/** Detailed component and token cost inventory of a plugin. */
export interface ClaudePluginDetails {
  components: ClaudePluginComponents;
  alwaysOnTokens: number;
}

/** Domain representation of an available (not yet installed) plugin. */
export interface ClaudeAvailablePlugin {
  pluginId: string;
  name: string;
  description?: string;
  marketplaceName: string;
  version?: string;
  source: unknown;
}

/** Result shape for available plugins discovery. */
export interface ClaudeAvailablePluginsResult {
  installed: ClaudePlugin[];
  available: ClaudeAvailablePlugin[];
}

/** Domain representation of a registered marketplace. */
export interface ClaudeMarketplace {
  name: string;
  source: string;
  path?: string;
  installLocation?: string;
}

/** Options for executing a Claude CLI command. */
export interface ClaudeCliRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/** Result of a CLI execution. */
export interface ClaudeCliRunResult {
  stdout: string;
  stderr: string;
  code?: number;
}

/** Injectable executor function signature. */
export type ClaudeCliExecutor = (
  args: string[],
  opts?: ClaudeCliRunOptions
) => Promise<ClaudeCliRunResult>;

// --- Constants ---

export const CLAUDE_CLI_MINIMUM_VERSION = '2.1.0';
export const CLAUDE_COMMAND_TIMEOUT_MS = 30_000;

export const CLAUDE_BINARY_FALLBACKS: readonly string[] = [
  '~/.local/bin/claude',
  '~/.claude/local/claude',
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
] as const;

// --- Typed Errors ---

export class ClaudeCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeCliError';
  }
}

export class ClaudeCliNotFound extends ClaudeCliError {
  readonly searchedLocations: string[];

  constructor(searchedLocations: string[], message?: string) {
    const defaultMsg = `Claude CLI not found. Searched PATH directories and fallback locations:\n${searchedLocations.map(loc => `  - ${loc}`).join('\n')}`;
    super(message ?? defaultMsg);
    this.name = 'ClaudeCliNotFound';
    this.searchedLocations = searchedLocations;
  }
}

export class ClaudeCliVersionError extends ClaudeCliError {
  readonly foundVersion: string;
  readonly minimumVersion: string;

  constructor(foundVersion: string, minimumVersion: string, message?: string) {
    const defaultMsg = `Claude CLI version ${foundVersion} is older than minimum supported version ${minimumVersion}`;
    super(message ?? defaultMsg);
    this.name = 'ClaudeCliVersionError';
    this.foundVersion = foundVersion;
    this.minimumVersion = minimumVersion;
  }
}

export class ClaudeCliTimeoutError extends ClaudeCliError {
  readonly command: string;
  readonly timeoutMs: number;

  constructor(command: string, timeoutMs: number, message?: string) {
    const defaultMsg = `Claude CLI command timed out after ${timeoutMs}ms [claude ${command}]`;
    super(message ?? defaultMsg);
    this.name = 'ClaudeCliTimeoutError';
    this.command = command;
    this.timeoutMs = timeoutMs;
  }
}

export class ClaudeCliParseError extends ClaudeCliError {
  readonly rawOutput: string;

  constructor(rawOutput: string, message?: string) {
    const defaultMsg = message ? `${message}\nRaw output: ${rawOutput}` : `Failed to parse Claude CLI output: ${rawOutput}`;
    super(defaultMsg);
    this.name = 'ClaudeCliParseError';
    this.rawOutput = rawOutput;
  }
}

export class ClaudeCliExecutionError extends ClaudeCliError {
  readonly command: string;
  readonly code?: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(command: string, code: number | undefined, stdout: string, stderr: string, message?: string) {
    const defaultMsg = message ?? `Claude CLI command failed [claude ${command}] (exit code ${code}): ${stderr.trim() || stdout.trim()}`;
    super(defaultMsg);
    this.name = 'ClaudeCliExecutionError';
    this.command = command;
    this.code = code;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

// --- Binary Resolution & Caching ---

let cachedResolvedBinaryPath: string | null = null;

export function clearBinaryCache(): void {
  cachedResolvedBinaryPath = null;
}

function isExecutable(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) {
      return false;
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return false;
    }
    if (process.platform === 'win32') {
      return true;
    }
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export interface ResolveClaudeBinaryOptions {
  env?: NodeJS.ProcessEnv;
  fallbacks?: readonly string[];
  forceRefresh?: boolean;
}

/**
 * Resolves the absolute path to the `claude` CLI binary.
 * Searches PATH first, then well-known fallback directories.
 * Results are cached in-memory unless forceRefresh is true.
 * Throws ClaudeCliNotFound with all searched locations if not found.
 */
export function resolveClaudeBinary(options?: ResolveClaudeBinaryOptions): string {
  if (cachedResolvedBinaryPath && !options?.forceRefresh) {
    return cachedResolvedBinaryPath;
  }

  const env = options?.env ?? process.env;
  const pathVal = env.PATH ?? '';
  const delimiter = path.delimiter;
  const searchedLocations: string[] = [];

  const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude';

  // 1. Search directories on PATH
  if (pathVal) {
    const pathDirs = pathVal.split(delimiter).filter(Boolean);
    for (const dir of pathDirs) {
      const candidate = path.join(dir, binaryName);
      searchedLocations.push(candidate);
      if (isExecutable(candidate)) {
        cachedResolvedBinaryPath = candidate;
        return candidate;
      }
    }
  }

  // 2. Search fallback locations
  const home = os.homedir();
  const fallbacks = options?.fallbacks ?? CLAUDE_BINARY_FALLBACKS;
  for (const rawFallback of fallbacks) {
    const expanded = rawFallback.startsWith('~/')
      ? path.join(home, rawFallback.slice(2))
      : rawFallback;
    const resolved = path.resolve(expanded);
    if (!searchedLocations.includes(resolved)) {
      searchedLocations.push(resolved);
    }
    if (isExecutable(resolved)) {
      cachedResolvedBinaryPath = resolved;
      return resolved;
    }
  }

  throw new ClaudeCliNotFound(searchedLocations);
}

// --- Version Gate Helper ---

export function compareSemver(v1: string, v2: string): number {
  const parseParts = (v: string): number[] => {
    const clean = v.replace(/^v/, '').split('-')[0];
    return clean.split('.').map(part => parseInt(part, 10) || 0);
  };

  const p1 = parseParts(v1);
  const p2 = parseParts(v2);
  const len = Math.max(p1.length, p2.length);

  for (let i = 0; i < len; i++) {
    const num1 = p1[i] ?? 0;
    const num2 = p2[i] ?? 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

export function parseClaudeCliVersion(stdout: string): string {
  const match = stdout.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  if (!match) {
    throw new ClaudeCliParseError(stdout, 'Could not determine Claude CLI version from output');
  }
  return match[1];
}

// --- Default Process Executor ---

export function createDefaultExecutor(options?: {
  binaryPathResolver?: () => string;
  env?: NodeJS.ProcessEnv;
}): ClaudeCliExecutor {
  return async (args: string[], runOpts?: ClaudeCliRunOptions): Promise<ClaudeCliRunResult> => {
    const binary = options?.binaryPathResolver ? options.binaryPathResolver() : resolveClaudeBinary();
    const timeoutMs = runOpts?.timeoutMs ?? CLAUDE_COMMAND_TIMEOUT_MS;
    const env = { ...process.env, ...options?.env, ...runOpts?.env };

    return new Promise<ClaudeCliRunResult>((resolve, reject) => {
      child_process.execFile(
        binary,
        args,
        {
          cwd: runOpts?.cwd,
          env,
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error) {
            const errObj = error as Error & { killed?: boolean; signal?: string; code?: number | string };
            const timedOut = errObj.killed && (errObj.signal === 'SIGTERM' || errObj.signal === 'SIGKILL');
            if (timedOut || errObj.code === 'ETIMEDOUT') {
              reject(new ClaudeCliTimeoutError(args.join(' '), timeoutMs));
              return;
            }
            resolve({
              stdout: stdout || '',
              stderr: stderr || error.message || '',
              code: typeof errObj.code === 'number' ? errObj.code : 1,
            });
            return;
          }
          resolve({
            stdout: stdout || '',
            stderr: stderr || '',
            code: 0,
          });
        }
      );
    });
  };
}

// --- Parsers ---

function parseTokenCostNumber(val: string): number {
  const cleaned = val.replace(/[~<]/g, '').trim();
  const isK = /[kK]$/.test(cleaned);
  const numStr = cleaned.replace(/[kK]$/, '').replace(/,/g, '').trim();
  const num = parseFloat(numStr);
  if (isNaN(num)) return 0;
  return isK ? Math.round(num * 1000) : Math.round(num);
}

function parsePluginEntry(item: unknown, rawContext: string): ClaudePlugin {
  if (!item || typeof item !== 'object') {
    throw new ClaudeCliParseError(rawContext, 'Plugin item is not an object');
  }
  const obj = item as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id : '';
  if (!id) {
    throw new ClaudeCliParseError(rawContext, 'Plugin is missing required "id" field');
  }

  const atIdx = id.indexOf('@');
  const derivedName = atIdx > 0 ? id.slice(0, atIdx) : id;
  const derivedMarketplace = atIdx > 0 ? id.slice(atIdx + 1) : '';

  const name = typeof obj.name === 'string' && obj.name ? obj.name : derivedName;
  const marketplace = typeof obj.marketplace === 'string' && obj.marketplace ? obj.marketplace : derivedMarketplace;
  const version = typeof obj.version === 'string' ? obj.version : '';
  const scope: ClaudePluginScope =
    obj.scope === 'user' || obj.scope === 'project' || obj.scope === 'local'
      ? obj.scope
      : 'user';
  const enabled = typeof obj.enabled === 'boolean' ? obj.enabled : true;
  const installPath = typeof obj.installPath === 'string' ? obj.installPath : '';
  const projectPath = typeof obj.projectPath === 'string' ? obj.projectPath : undefined;
  const projectEnabled = typeof obj.projectEnabled === 'boolean' ? obj.projectEnabled : undefined;
  const installedAt = typeof obj.installedAt === 'string' ? obj.installedAt : '';
  const lastUpdated = typeof obj.lastUpdated === 'string' ? obj.lastUpdated : '';

  return {
    id,
    name,
    marketplace,
    version,
    scope,
    enabled,
    installPath,
    projectPath,
    projectEnabled,
    installedAt,
    lastUpdated,
  };
}

export function parsePluginDetailsFromText(rawOutput: string): ClaudePluginDetails {
  const lines = rawOutput.split(/\r?\n/);

  const components: ClaudePluginComponents = {
    skills: [],
    agents: [],
    hooks: [],
    mcpServers: [],
    lspServers: [],
  };

  let alwaysOnTokens = 0;
  let inComponentInventory = false;
  let inProjectedTokenCost = false;
  let hasInventoryHeader = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^Component inventory/i.test(trimmed)) {
      inComponentInventory = true;
      hasInventoryHeader = true;
      inProjectedTokenCost = false;
      continue;
    }
    if (/^Projected token cost/i.test(trimmed)) {
      inComponentInventory = false;
      inProjectedTokenCost = true;
      continue;
    }
    if (/^Per-component/i.test(trimmed)) {
      inComponentInventory = false;
      inProjectedTokenCost = false;
      continue;
    }

    if (inComponentInventory) {
      const match = trimmed.match(/^([A-Za-z ]+?)\s*\(([0-9]+)\)(?:\s+(.*))?$/);
      if (match) {
        const category = match[1].trim().toLowerCase();
        const itemsStr = match[3] ? match[3].trim() : '';
        const items = itemsStr ? itemsStr.split(',').map(s => s.trim()).filter(Boolean) : [];

        if (category === 'skills') {
          components.skills = items;
        } else if (category === 'agents') {
          components.agents = items;
        } else if (category === 'commands') {
          components.commands = items;
        } else if (category === 'hooks') {
          components.hooks = items;
        } else if (category === 'mcp servers') {
          components.mcpServers = items;
        } else if (category === 'lsp servers') {
          components.lspServers = items;
        }
      }
    }

    if (inProjectedTokenCost) {
      const match = trimmed.match(/Always-on:\s*([~<]?\s*[0-9.,]+(?:\s*[kK])?)\s*tok/i);
      if (match) {
        alwaysOnTokens = parseTokenCostNumber(match[1]);
      }
    }
  }

  if (!hasInventoryHeader) {
    throw new ClaudeCliParseError(rawOutput, 'Could not find "Component inventory" header in plugin details');
  }

  if (alwaysOnTokens === 0) {
    const fallbackMatch = rawOutput.match(/Always-on:\s*([~<]?\s*[0-9.,]+(?:\s*[kK])?)\s*tok/i);
    if (fallbackMatch) {
      alwaysOnTokens = parseTokenCostNumber(fallbackMatch[1]);
    }
  }

  return {
    components,
    alwaysOnTokens,
  };
}

export function parsePluginDetailsFromJson(json: unknown, rawOutput: string): ClaudePluginDetails {
  if (!json || typeof json !== 'object') {
    throw new ClaudeCliParseError(rawOutput, 'Plugin details JSON is not an object');
  }
  const obj = json as Record<string, any>;
  const rawComponents = obj.components ?? {};

  const parseStringArray = (val: unknown): string[] => {
    if (Array.isArray(val)) {
      return val.filter((item): item is string => typeof item === 'string');
    }
    return [];
  };

  const components: ClaudePluginComponents = {
    skills: parseStringArray(rawComponents.skills),
    agents: parseStringArray(rawComponents.agents),
    hooks: parseStringArray(rawComponents.hooks),
    mcpServers: parseStringArray(rawComponents.mcpServers),
    lspServers: parseStringArray(rawComponents.lspServers),
  };

  if (rawComponents.commands !== undefined) {
    components.commands = parseStringArray(rawComponents.commands);
  }

  let alwaysOnTokens = 0;
  if (typeof obj.alwaysOnTokens === 'number') {
    alwaysOnTokens = obj.alwaysOnTokens;
  } else if (typeof obj.alwaysOnTokens === 'string') {
    alwaysOnTokens = parseTokenCostNumber(obj.alwaysOnTokens);
  } else if (obj.projectedTokenCost && typeof obj.projectedTokenCost.alwaysOn === 'number') {
    alwaysOnTokens = obj.projectedTokenCost.alwaysOn;
  } else if (obj.projectedTokenCost && typeof obj.projectedTokenCost.alwaysOn === 'string') {
    alwaysOnTokens = parseTokenCostNumber(obj.projectedTokenCost.alwaysOn);
  }

  return {
    components,
    alwaysOnTokens,
  };
}

// --- ClaudeCli Class & Client Options ---

export interface ClaudeCliOptions {
  executor?: ClaudeCliExecutor;
  binaryPath?: string;
  minimumVersion?: string;
  timeoutMs?: number;
  skipVersionCheck?: boolean;
}

export class ClaudeCli {
  private readonly executor: ClaudeCliExecutor;
  private readonly minimumVersion: string;
  private readonly timeoutMs: number;
  private readonly skipVersionCheck: boolean;
  private verifiedVersion: string | null = null;

  constructor(options?: ClaudeCliOptions) {
    this.minimumVersion = options?.minimumVersion ?? CLAUDE_CLI_MINIMUM_VERSION;
    this.timeoutMs = options?.timeoutMs ?? CLAUDE_COMMAND_TIMEOUT_MS;
    this.skipVersionCheck = options?.skipVersionCheck ?? false;

    if (options?.executor) {
      this.executor = options.executor;
    } else {
      this.executor = createDefaultExecutor({
        binaryPathResolver: options?.binaryPath ? () => options.binaryPath! : undefined,
      });
    }
  }

  /**
   * Resolves binary location, searching PATH then fallbacks.
   */
  resolveBinary(opts?: ResolveClaudeBinaryOptions): string {
    return resolveClaudeBinary(opts);
  }

  /**
   * Enforces the minimum version gate using `claude --version`.
   */
  async ensureVersionGate(opts?: ClaudeCliRunOptions): Promise<string> {
    if (this.skipVersionCheck && this.verifiedVersion) {
      return this.verifiedVersion;
    }

    const res = await this.executor(['--version'], {
      timeoutMs: opts?.timeoutMs ?? this.timeoutMs,
      env: opts?.env,
      cwd: opts?.cwd,
    });

    if (res.code !== 0 && res.code !== undefined) {
      throw new ClaudeCliExecutionError('--version', res.code, res.stdout, res.stderr);
    }

    const version = parseClaudeCliVersion(res.stdout);
    if (compareSemver(version, this.minimumVersion) < 0) {
      throw new ClaudeCliVersionError(version, this.minimumVersion);
    }

    this.verifiedVersion = version;
    return version;
  }

  /**
   * Lists installed plugins via `claude plugin list --json`.
   */
  async listPlugins(opts?: ClaudeCliRunOptions): Promise<ClaudePlugin[]> {
    if (!this.skipVersionCheck) {
      await this.ensureVersionGate(opts);
    }

    const res = await this.executor(['plugin', 'list', '--json'], {
      timeoutMs: opts?.timeoutMs ?? this.timeoutMs,
      env: opts?.env,
      cwd: opts?.cwd,
    });

    if (res.code !== 0 && res.code !== undefined) {
      throw new ClaudeCliExecutionError('plugin list --json', res.code, res.stdout, res.stderr);
    }

    const trimmed = res.stdout.trim();
    if (!trimmed) {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new ClaudeCliParseError(res.stdout, `Failed to parse JSON array from claude plugin list: ${(err as Error).message}`);
    }

    if (!Array.isArray(parsed)) {
      throw new ClaudeCliParseError(res.stdout, 'Expected array from claude plugin list --json');
    }

    return parsed.map(item => parsePluginEntry(item, res.stdout));
  }

  /**
   * Lists available and installed plugins via `claude plugin list --available --json`.
   */
  async listAvailablePlugins(opts?: ClaudeCliRunOptions): Promise<ClaudeAvailablePluginsResult> {
    if (!this.skipVersionCheck) {
      await this.ensureVersionGate(opts);
    }

    const res = await this.executor(['plugin', 'list', '--available', '--json'], {
      timeoutMs: opts?.timeoutMs ?? this.timeoutMs,
      env: opts?.env,
      cwd: opts?.cwd,
    });

    if (res.code !== 0 && res.code !== undefined) {
      throw new ClaudeCliExecutionError('plugin list --available --json', res.code, res.stdout, res.stderr);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(res.stdout);
    } catch (err) {
      throw new ClaudeCliParseError(res.stdout, `Failed to parse JSON object from claude plugin list --available: ${(err as Error).message}`);
    }

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.available)) {
      throw new ClaudeCliParseError(res.stdout, 'Expected object with available array from claude plugin list --available --json');
    }

    const installed = Array.isArray(parsed.installed)
      ? parsed.installed.map((item: unknown) => parsePluginEntry(item, res.stdout))
      : [];

    const available: ClaudeAvailablePlugin[] = parsed.available.map((item: any) => {
      if (!item || typeof item !== 'object') {
        throw new ClaudeCliParseError(res.stdout, 'Available plugin item is not an object');
      }
      const pluginId = String(item.pluginId || item.id || '');
      if (!pluginId) {
        throw new ClaudeCliParseError(res.stdout, 'Available plugin item missing pluginId');
      }

      const atIdx = pluginId.indexOf('@');
      const derivedName = atIdx > 0 ? pluginId.slice(0, atIdx) : pluginId;
      const derivedMarketplace = atIdx > 0 ? pluginId.slice(atIdx + 1) : '';

      const name = typeof item.name === 'string' && item.name ? item.name : derivedName;
      const marketplaceName = typeof item.marketplaceName === 'string' && item.marketplaceName
        ? item.marketplaceName
        : derivedMarketplace;
      const description = typeof item.description === 'string' ? item.description : undefined;
      const version = typeof item.version === 'string' ? item.version : undefined;
      const source = item.source;

      return {
        pluginId,
        name,
        description,
        marketplaceName,
        version,
        source,
      };
    });

    return {
      installed,
      available,
    };
  }

  /**
   * Retrieves component details and projected token cost for a plugin.
   * Defensively checks for JSON mode first; falls back to text parsing.
   */
  async pluginDetails(id: string, opts?: ClaudeCliRunOptions): Promise<ClaudePluginDetails> {
    if (!this.skipVersionCheck) {
      await this.ensureVersionGate(opts);
    }

    const res = await this.executor(['plugin', 'details', id], {
      timeoutMs: opts?.timeoutMs ?? this.timeoutMs,
      env: opts?.env,
      cwd: opts?.cwd,
    });

    if (res.code !== 0 && res.code !== undefined) {
      throw new ClaudeCliExecutionError(`plugin details ${id}`, res.code, res.stdout, res.stderr);
    }

    const trimmed = res.stdout.trim();
    if (trimmed.startsWith('{')) {
      try {
        const json = JSON.parse(trimmed);
        return parsePluginDetailsFromJson(json, res.stdout);
      } catch {
        // Fall back to text parsing if JSON parse fails
      }
    }

    return parsePluginDetailsFromText(res.stdout);
  }

  /**
   * Lists marketplaces via `claude plugin marketplace list --json`.
   */
  async listMarketplaces(opts?: ClaudeCliRunOptions): Promise<ClaudeMarketplace[]> {
    if (!this.skipVersionCheck) {
      await this.ensureVersionGate(opts);
    }

    const res = await this.executor(['plugin', 'marketplace', 'list', '--json'], {
      timeoutMs: opts?.timeoutMs ?? this.timeoutMs,
      env: opts?.env,
      cwd: opts?.cwd,
    });

    if (res.code !== 0 && res.code !== undefined) {
      throw new ClaudeCliExecutionError('plugin marketplace list --json', res.code, res.stdout, res.stderr);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(res.stdout);
    } catch (err) {
      throw new ClaudeCliParseError(res.stdout, `Failed to parse JSON array from claude plugin marketplace list: ${(err as Error).message}`);
    }

    if (!Array.isArray(parsed)) {
      throw new ClaudeCliParseError(res.stdout, 'Expected array from claude plugin marketplace list --json');
    }

    return parsed.map((item: any) => {
      if (!item || typeof item !== 'object') {
        throw new ClaudeCliParseError(res.stdout, 'Marketplace item is not an object');
      }
      const name = String(item.name || '');
      if (!name) {
        throw new ClaudeCliParseError(res.stdout, 'Marketplace missing name');
      }
      const source = String(item.source || '');
      const pathVal = typeof item.path === 'string' ? item.path : undefined;
      const installLocation = typeof item.installLocation === 'string' ? item.installLocation : undefined;

      return {
        name,
        source,
        path: pathVal,
        installLocation,
      };
    });
  }

  // --- Write Functions (Declared here; implemented in 45.4 / 45.5) ---

  async installPlugin(_plugin: string, _opts?: { scope?: ClaudePluginScope }): Promise<void> {
    throw new Error('installPlugin is not implemented in 45.2 (scheduled for 45.5)');
  }

  async uninstallPlugin(_pluginId: string, _opts?: { scope?: ClaudePluginScope }): Promise<void> {
    throw new Error('uninstallPlugin is not implemented in 45.2 (scheduled for 45.4)');
  }

  async enablePlugin(_pluginId: string, _opts?: { scope?: ClaudePluginScope }): Promise<void> {
    throw new Error('enablePlugin is not implemented in 45.2 (scheduled for 45.4)');
  }

  async disablePlugin(_pluginId: string, _opts?: { scope?: ClaudePluginScope }): Promise<void> {
    throw new Error('disablePlugin is not implemented in 45.2 (scheduled for 45.4)');
  }

  async updatePlugin(_pluginId: string): Promise<void> {
    throw new Error('updatePlugin is not implemented in 45.2 (scheduled for 45.4)');
  }

  async addMarketplace(_location: string): Promise<void> {
    throw new Error('addMarketplace is not implemented in 45.2 (scheduled for 45.5)');
  }

  async removeMarketplace(_name: string): Promise<void> {
    throw new Error('removeMarketplace is not implemented in 45.2 (scheduled for 45.5)');
  }
}

// --- Convenience Factory & Top-Level Functions ---

export function createClaudeCli(options?: ClaudeCliOptions): ClaudeCli {
  return new ClaudeCli(options);
}

export async function listPlugins(options?: ClaudeCliOptions, runOpts?: ClaudeCliRunOptions): Promise<ClaudePlugin[]> {
  const cli = new ClaudeCli(options);
  return cli.listPlugins(runOpts);
}

export async function listAvailablePlugins(
  options?: ClaudeCliOptions,
  runOpts?: ClaudeCliRunOptions
): Promise<ClaudeAvailablePluginsResult> {
  const cli = new ClaudeCli(options);
  return cli.listAvailablePlugins(runOpts);
}

export async function pluginDetails(
  id: string,
  options?: ClaudeCliOptions,
  runOpts?: ClaudeCliRunOptions
): Promise<ClaudePluginDetails> {
  const cli = new ClaudeCli(options);
  return cli.pluginDetails(id, runOpts);
}

export async function listMarketplaces(
  options?: ClaudeCliOptions,
  runOpts?: ClaudeCliRunOptions
): Promise<ClaudeMarketplace[]> {
  const cli = new ClaudeCli(options);
  return cli.listMarketplaces(runOpts);
}
