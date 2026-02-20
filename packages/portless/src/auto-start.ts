import * as net from "node:net";
import { spawn, ChildProcess } from "node:child_process";
import type { ProjectConfig, AutoStartConfig, AutoStartContext } from "./types.js";
import { RouteStore } from "./routes.js";
import { findFreePort } from "./cli-utils.js";
import { findProjectConfig } from "./config.js";
import { parseHostname } from "./utils.js";

/** How often to poll for app readiness (ms) */
const READINESS_POLL_INTERVAL_MS = 250;

/** Maximum time to wait for app readiness (ms) */
const READINESS_TIMEOUT_MS = 60_000;

/** Information about an app that is currently starting */
interface StartingApp {
  hostname: string;
  projectConfig: ProjectConfig;
  port: number;
  process: ChildProcess;
  startTime: number;
}

/** In-memory tracking of apps currently being started */
const startingApps = new Map<string, StartingApp>();

/**
 * Check if an app is currently in the process of starting.
 */
export function isAppStarting(hostname: string): boolean {
  return startingApps.has(hostname);
}

/**
 * Get the port of an app that is currently starting.
 */
export function getStartingAppPort(hostname: string): number | null {
  return startingApps.get(hostname)?.port ?? null;
}

/**
 * Check if a port is accepting connections.
 */
function isPortReady(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}

/**
 * Poll until a port is ready or timeout is reached.
 */
async function waitForPortReady(
  port: number,
  timeoutMs = READINESS_TIMEOUT_MS,
  intervalMs = READINESS_POLL_INTERVAL_MS
): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (await isPortReady(port)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/**
 * Parse a command string into an array of arguments.
 * Handles quoted strings and escaping.
 */
function parseCommand(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  let escape = false;

  for (const char of command) {
    if (escape) {
      current += char;
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inQuote = char;
      continue;
    }

    if (char === " " || char === "\t") {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    args.push(current);
  }

  return args;
}

/**
 * Start an app based on its project config.
 * Returns the assigned port, or null if the app failed to start.
 */
export async function startApp(
  hostname: string,
  projectConfig: ProjectConfig,
  store: RouteStore
): Promise<number | null> {
  // Check if already starting
  if (startingApps.has(hostname)) {
    return startingApps.get(hostname)!.port;
  }

  try {
    // Find a free port
    const port = await findFreePort();

    // Parse the command
    const commandArgs = parseCommand(projectConfig.command);
    if (commandArgs.length === 0) {
      console.error(`[auto-start] Empty command for ${hostname}`);
      return null;
    }

    // Spawn the process
    const child = spawn(commandArgs[0], commandArgs.slice(1), {
      cwd: projectConfig.configDir,
      env: { ...process.env, PORT: port.toString() },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const startingApp: StartingApp = {
      hostname,
      projectConfig,
      port,
      process: child,
      startTime: Date.now(),
    };
    startingApps.set(hostname, startingApp);

    // Register the route immediately so loading page works
    store.addRoute(hostname, port, child.pid!);

    // Log output with prefix
    const prefix = `[${hostname}]`;
    child.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (line.trim()) {
          console.log(`${prefix} ${line}`);
        }
      }
    });
    child.stderr?.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (line.trim()) {
          console.error(`${prefix} ${line}`);
        }
      }
    });

    // Handle process exit
    child.on("exit", (code, signal) => {
      startingApps.delete(hostname);
      try {
        store.removeRoute(hostname);
      } catch {
        // Lock acquisition may fail; non-fatal
      }
      if (signal) {
        console.log(`${prefix} Process killed with signal ${signal}`);
      } else if (code !== 0) {
        console.log(`${prefix} Process exited with code ${code}`);
      } else {
        console.log(`${prefix} Process exited`);
      }
    });

    child.on("error", (err) => {
      startingApps.delete(hostname);
      try {
        store.removeRoute(hostname);
      } catch {
        // Lock acquisition may fail; non-fatal
      }
      console.error(`${prefix} Failed to start: ${err.message}`);
    });

    console.log(`[auto-start] Starting ${hostname} on port ${port}`);
    console.log(`[auto-start] Command: ${projectConfig.command}`);
    console.log(`[auto-start] Directory: ${projectConfig.configDir}`);

    // Start polling for readiness in the background
    waitForPortReady(port).then((ready) => {
      if (ready && startingApps.has(hostname)) {
        console.log(`[auto-start] ${hostname} is ready`);
        startingApps.delete(hostname);
      }
    });

    return port;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[auto-start] Error starting ${hostname}: ${message}`);
    return null;
  }
}

/**
 * Create an AutoStartContext for use with the proxy.
 */
export function createAutoStartContext(
  stateDir: string,
  config: AutoStartConfig,
  store: RouteStore,
  proxyPort: number,
  tls: boolean
): AutoStartContext {
  return {
    stateDir,
    config,
    proxyPort,
    tls,
    startApp: (hostname: string, projectConfig: ProjectConfig) =>
      startApp(hostname, projectConfig, store),
    isAppStarting,
    findProject: (hostname: string) => findProjectConfig(hostname, config),
  };
}

/**
 * Try to auto-start an app for a given hostname.
 * Returns the port if successful, null otherwise.
 */
export async function tryAutoStart(
  hostname: string,
  context: AutoStartContext
): Promise<number | null> {
  // Check if already starting
  if (context.isAppStarting(hostname)) {
    return getStartingAppPort(hostname);
  }

  // Find project config
  const projectConfig = context.findProject(hostname);
  if (!projectConfig) {
    return null;
  }

  // Validate that the hostname matches
  try {
    const configHostname = parseHostname(projectConfig.name);
    if (configHostname !== hostname) {
      return null;
    }
  } catch {
    return null;
  }

  // Start the app
  return context.startApp(hostname, projectConfig);
}

/**
 * Stop all auto-started apps.
 * Called when the proxy is shutting down.
 */
export function stopAllAutoStartedApps(): void {
  for (const [hostname, app] of startingApps) {
    console.log(`[auto-start] Stopping ${hostname}`);
    app.process.kill("SIGTERM");
  }
  startingApps.clear();
}
