/**
 * Where the console finds vendor-control and the vendor realm. The server reads them from its
 * environment on every request and the root layout hands them to the browser, so one image works
 * wherever it runs. The defaults are the platform's local ports (deploy/platform).
 *
 * The CONSOLE_ prefix keeps them apart from the tenant stack's KEYCLOAK_URL and KEYCLOAK_REALM,
 * which the root .env may put in a developer's shell.
 */
export type ConsoleConfig = {
  /** vendor-control as the browser reaches it, without a trailing slash */
  vendorControlUrl: string;
  keycloakUrl: string;
  keycloakRealm: string;
  oidcClientId: string;
};

declare global {
  interface Window {
    __CONSOLE_CONFIG__?: ConsoleConfig;
  }
}

/** Server only: this deployment's settings. */
export function serverConsoleConfig(env: NodeJS.ProcessEnv = process.env): ConsoleConfig {
  return {
    vendorControlUrl: (env.CONSOLE_VENDOR_CONTROL_URL || 'http://localhost:4050').replace(/\/+$/, ''),
    keycloakUrl: (env.CONSOLE_KEYCLOAK_URL || 'http://localhost:8180').replace(/\/+$/, ''),
    keycloakRealm: env.CONSOLE_KEYCLOAK_REALM || 'vendor',
    oidcClientId: env.CONSOLE_OIDC_CLIENT_ID || 'vendor-console',
  };
}

/** The settings in the browser (handed over by the layout) and during server rendering alike. */
export function consoleConfig(): ConsoleConfig {
  if (typeof window === 'undefined') return serverConsoleConfig();
  return window.__CONSOLE_CONFIG__ ?? serverConsoleConfig();
}

/** The inline script that hands the settings to the browser before any client code runs. */
export function consoleConfigScript(config: ConsoleConfig = serverConsoleConfig()) {
  // Escaping `<` keeps a value from closing the script tag.
  return `window.__CONSOLE_CONFIG__=${JSON.stringify(config).replace(/</g, '\\u003c')};`;
}
