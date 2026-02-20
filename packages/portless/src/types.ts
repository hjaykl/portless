/** Route info used by the proxy server to map hostnames to ports. */
export interface RouteInfo {
  hostname: string;
  port: number;
}

export interface ProxyServerOptions {
  /** Called on each request to get the current route table. */
  getRoutes: () => RouteInfo[];
  /** The port the proxy is listening on (used to build correct URLs). */
  proxyPort: number;
  /** Optional error logger; defaults to console.error. */
  onError?: (message: string) => void;
  /** When provided, enables HTTP/2 over TLS (HTTPS). */
  tls?: {
    cert: Buffer;
    key: Buffer;
    /** SNI callback for per-hostname certificate selection. */
    SNICallback?: (
      servername: string,
      cb: (err: Error | null, ctx?: import("node:tls").SecureContext) => void
    ) => void;
  };
  /** Auto-start context for on-demand app startup (optional). */
  autoStart?: AutoStartContext;
}

// ---------------------------------------------------------------------------
// Auto-start configuration types
// ---------------------------------------------------------------------------

/** Per-project configuration stored in .portless.json */
export interface ProjectConfig {
  /** App name (determines hostname, e.g., "myapp" -> myapp.localhost) */
  name: string;
  /** Start command (e.g., "npm run dev") */
  command: string;
  /** Directory containing the config file (set at load time) */
  configDir: string;
}

/** Auto-start settings from the global config */
export interface AutoStartConfig {
  /** Whether on-demand auto-start is enabled (default: true) */
  enabled: boolean;
  /** Directories to scan for project configs */
  directories: string[];
  /** Maximum directory depth to scan (default: 3) */
  maxDepth: number;
  /** Glob patterns to exclude (default: ["node_modules", ".git"]) */
  exclude: string[];
}

/** Global configuration stored in ~/.portless/config.json */
export interface GlobalConfig {
  autoStart?: {
    enabled?: boolean;
    directories?: string[];
    maxDepth?: number;
    exclude?: string[];
  };
}

/** Context passed to the proxy for auto-starting apps */
export interface AutoStartContext {
  /** State directory path */
  stateDir: string;
  /** Auto-start configuration */
  config: AutoStartConfig;
  /** Proxy port */
  proxyPort: number;
  /** Whether TLS is enabled */
  tls: boolean;
  /** Callback to start an app (returns port or null if failed) */
  startApp: (hostname: string, projectConfig: ProjectConfig) => Promise<number | null>;
  /** Check if an app is currently starting */
  isAppStarting: (hostname: string) => boolean;
  /** Find a project config for a hostname */
  findProject: (hostname: string) => ProjectConfig | null;
}
