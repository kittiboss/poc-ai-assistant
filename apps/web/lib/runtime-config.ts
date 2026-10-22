/**
 * Settings that differ per customer deployment. The server reads them from its environment on every
 * request and the root layout hands them to the browser, so one web image serves every customer.
 * The build-time NEXT_PUBLIC_* values remain the fallback, so the single-installation stack is unchanged.
 */
export type RuntimeConfig = {
  /** The API including its global `/api` prefix */
  apiUrl: string;
  keycloakUrl: string;
  keycloakRealm: string;
  oidcClientId: string;
  vendorManaged: boolean;
};

declare global {
  interface Window {
    __APP_CONFIG__?: RuntimeConfig;
  }
}

/** Server only: this deployment's settings. */
export function serverRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    apiUrl: env.APP_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api',
    keycloakUrl: env.APP_KEYCLOAK_URL || process.env.NEXT_PUBLIC_KEYCLOAK_URL || 'http://localhost:8080',
    keycloakRealm: env.APP_KEYCLOAK_REALM || process.env.NEXT_PUBLIC_KEYCLOAK_REALM || 'enterprise-ai',
    oidcClientId: env.APP_OIDC_CLIENT_ID || process.env.NEXT_PUBLIC_OIDC_CLIENT_ID || 'enterprise-ai-web',
    vendorManaged: env.APP_MODEL_ACCESS === 'vendor-gateway',
  };
}

/** The settings in the browser (handed over by the layout) and during server rendering alike. */
export function runtimeConfig(): RuntimeConfig {
  if (typeof window === 'undefined') return serverRuntimeConfig();
  return window.__APP_CONFIG__ ?? serverRuntimeConfig();
}

/** The inline script that hands the settings to the browser before any client code runs. */
export function runtimeConfigScript(config: RuntimeConfig = serverRuntimeConfig()) {
  // Escaping `<` keeps a value from closing the script tag.
  return `window.__APP_CONFIG__=${JSON.stringify(config).replace(/</g, '\\u003c')};`;
}
