import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ProjectConfig, AutoStartConfig, GlobalConfig } from "./types.js";
import { parseHostname } from "./utils.js";

/** Default config file name for per-project configuration */
export const PROJECT_CONFIG_FILE = ".portless.json";

/** Default global config file name */
export const GLOBAL_CONFIG_FILE = "config.json";

/** Default directories to exclude when scanning */
const DEFAULT_EXCLUDE = ["node_modules", ".git", "dist", "build", ".next", ".cache"];

/** Default maximum directory depth to scan */
const DEFAULT_MAX_DEPTH = 3;

/**
 * Load the global configuration from the state directory.
 * Returns an empty object if the config file doesn't exist or is invalid.
 */
export function loadGlobalConfig(stateDir: string): GlobalConfig {
  const configPath = path.join(stateDir, GLOBAL_CONFIG_FILE);
  try {
    if (!fs.existsSync(configPath)) {
      return {};
    }
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    return parsed as GlobalConfig;
  } catch {
    return {};
  }
}

/**
 * Extract auto-start settings from the global config with defaults applied.
 */
export function getAutoStartConfig(globalConfig: GlobalConfig): AutoStartConfig {
  const autoStart = globalConfig.autoStart;
  return {
    enabled: autoStart?.enabled !== false,
    directories: autoStart?.directories ?? [],
    maxDepth: autoStart?.maxDepth ?? DEFAULT_MAX_DEPTH,
    exclude: autoStart?.exclude ?? DEFAULT_EXCLUDE,
  };
}

/**
 * Expand a path, resolving ~ to the home directory.
 */
function expandPath(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  if (p === "~") {
    return os.homedir();
  }
  return p;
}

/**
 * Load and validate a single project config from a file path.
 * Returns null if the file doesn't exist or is invalid.
 */
export function loadProjectConfig(configPath: string): ProjectConfig | null {
  try {
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);

    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const { name, command } = parsed as { name?: unknown; command?: unknown };

    if (typeof name !== "string" || !name.trim()) {
      return null;
    }
    if (typeof command !== "string" || !command.trim()) {
      return null;
    }

    return {
      name: name.trim(),
      command: command.trim(),
      configDir: path.dirname(configPath),
    };
  } catch {
    return null;
  }
}

/**
 * Check if a directory name matches any exclude pattern.
 */
function shouldExclude(name: string, exclude: string[]): boolean {
  return exclude.some((pattern) => {
    // Simple glob matching - just check if name matches or starts with pattern
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      return regex.test(name);
    }
    return name === pattern;
  });
}

/**
 * Recursively scan a directory for project config files.
 */
function scanDirectory(
  dir: string,
  exclude: string[],
  maxDepth: number,
  currentDepth: number,
  results: ProjectConfig[]
): void {
  if (currentDepth > maxDepth) {
    return;
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    // Check for config file in this directory
    const configPath = path.join(dir, PROJECT_CONFIG_FILE);
    const config = loadProjectConfig(configPath);
    if (config) {
      results.push(config);
    }

    // Recurse into subdirectories
    for (const entry of entries) {
      if (entry.isDirectory() && !shouldExclude(entry.name, exclude)) {
        scanDirectory(
          path.join(dir, entry.name),
          exclude,
          maxDepth,
          currentDepth + 1,
          results
        );
      }
    }
  } catch {
    // Directory may not exist or be readable; skip silently
  }
}

/**
 * Build an index of all project configs found in the configured directories.
 * Returns a Map from hostname to ProjectConfig.
 */
export function buildProjectIndex(config: AutoStartConfig): Map<string, ProjectConfig> {
  const index = new Map<string, ProjectConfig>();

  if (!config.enabled || config.directories.length === 0) {
    return index;
  }

  for (const dir of config.directories) {
    const expandedDir = expandPath(dir);
    const results: ProjectConfig[] = [];
    scanDirectory(expandedDir, config.exclude, config.maxDepth, 0, results);

    for (const project of results) {
      try {
        const hostname = parseHostname(project.name);
        // First match wins - don't overwrite
        if (!index.has(hostname)) {
          index.set(hostname, project);
        }
      } catch {
        // Invalid hostname; skip this config
      }
    }
  }

  return index;
}

/**
 * Find a project config for a specific hostname.
 * Scans directories on-demand rather than building a full index.
 */
export function findProjectConfig(
  hostname: string,
  config: AutoStartConfig
): ProjectConfig | null {
  if (!config.enabled || config.directories.length === 0) {
    return null;
  }

  for (const dir of config.directories) {
    const expandedDir = expandPath(dir);
    const results: ProjectConfig[] = [];
    scanDirectory(expandedDir, config.exclude, config.maxDepth, 0, results);

    for (const project of results) {
      try {
        const projectHostname = parseHostname(project.name);
        if (projectHostname === hostname) {
          return project;
        }
      } catch {
        // Invalid hostname; skip
      }
    }
  }

  return null;
}
