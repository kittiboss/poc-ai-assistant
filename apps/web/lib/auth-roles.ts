/** UI hint only. All authorization is enforced by the API using a verified access token. */
export function userRoles(user?: {
  profile?: unknown;
  access_token?: string;
} | null): string[] {
  const profile = user?.profile as
    | { realm_access?: { roles?: unknown } }
    | undefined;
  if (Array.isArray(profile?.realm_access?.roles))
    return profile.realm_access.roles.filter(
      (role): role is string => typeof role === "string",
    );
  try {
    const payload = user?.access_token?.split(".")[1];
    if (!payload) return [];
    const claims = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    ) as {
      realm_access?: { roles?: unknown };
    };
    return Array.isArray(claims.realm_access?.roles)
      ? claims.realm_access.roles.filter(
          (role): role is string => typeof role === "string",
        )
      : [];
  } catch {
    return [];
  }
}
