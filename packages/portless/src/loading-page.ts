import { escapeHtml } from "./utils.js";

/** Response header indicating the app is still loading */
export const PORTLESS_LOADING_HEADER = "X-Portless-Loading";

export interface LoadingPageOptions {
  /** The hostname being loaded */
  hostname: string;
  /** The proxy port */
  proxyPort: number;
  /** Whether TLS is enabled */
  tls: boolean;
}

/**
 * Generate an HTML loading page that auto-refreshes until the app is ready.
 * Uses JavaScript polling with a meta refresh fallback.
 */
export function generateLoadingPage(options: LoadingPageOptions): string {
  const { hostname, proxyPort, tls } = options;
  const safeHostname = escapeHtml(hostname);
  const protocol = tls ? "https" : "http";
  const url = `${protocol}://${safeHostname}:${proxyPort}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="3">
  <title>Starting ${safeHostname} - portless</title>
  <style>
    * {
      box-sizing: border-box;
    }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 40px 20px;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
    }
    .container {
      text-align: center;
      max-width: 500px;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin: 0 0 8px 0;
    }
    .hostname {
      font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
      font-size: 1.25rem;
      background: rgba(255,255,255,0.2);
      padding: 4px 12px;
      border-radius: 6px;
      display: inline-block;
      margin-bottom: 24px;
    }
    .spinner {
      width: 48px;
      height: 48px;
      border: 4px solid rgba(255,255,255,0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 24px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .status {
      font-size: 0.875rem;
      opacity: 0.8;
    }
    .error {
      background: rgba(255,0,0,0.2);
      border: 1px solid rgba(255,0,0,0.4);
      padding: 16px;
      border-radius: 8px;
      margin-top: 24px;
      display: none;
    }
    .error.show {
      display: block;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner" id="spinner"></div>
    <h1>Starting your app...</h1>
    <div class="hostname">${safeHostname}</div>
    <p class="status" id="status">Waiting for server to start</p>
    <div class="error" id="error">
      <strong>Timeout</strong>
      <p>The app is taking longer than expected to start. Check the terminal for errors.</p>
    </div>
  </div>
  <script>
    (function() {
      var startTime = Date.now();
      var timeout = 60000; // 60 seconds
      var pollInterval = 1000; // 1 second
      var statusEl = document.getElementById('status');
      var spinnerEl = document.getElementById('spinner');
      var errorEl = document.getElementById('error');

      function checkReady() {
        if (Date.now() - startTime > timeout) {
          statusEl.textContent = 'Timed out waiting for app';
          spinnerEl.style.display = 'none';
          errorEl.classList.add('show');
          return;
        }

        fetch(window.location.href, { method: 'HEAD' })
          .then(function(response) {
            if (!response.headers.get('${PORTLESS_LOADING_HEADER}')) {
              // App is ready - reload the page
              window.location.reload();
            } else {
              // Still loading - continue polling
              var elapsed = Math.floor((Date.now() - startTime) / 1000);
              statusEl.textContent = 'Waiting for server to start (' + elapsed + 's)';
              setTimeout(checkReady, pollInterval);
            }
          })
          .catch(function() {
            // Request failed - try again
            setTimeout(checkReady, pollInterval);
          });
      }

      // Start polling after a short delay
      setTimeout(checkReady, pollInterval);
    })();
  </script>
</body>
</html>`;
}
