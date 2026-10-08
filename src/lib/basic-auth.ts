export type BasicAuthCredentials = {
  username: string;
  password: string;
};

export function parseBasicAuth(header: string | null): BasicAuthCredentials | null {
  if (!header?.startsWith('Basic ')) return null;

  try {
    const decoded = atob(header.slice(6));
    const separator = decoded.indexOf(':');
    if (separator <= 0) return null;

    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1)
    };
  } catch {
    return null;
  }
}

export function hasValidAdminCredentials(header: string | null): boolean {
  const expectedUsername = process.env.ADMIN_EMAIL;
  const expectedPassword = process.env.ADMIN_PASSWORD;

  if (!expectedUsername || !expectedPassword) return false;

  const credentials = parseBasicAuth(header);
  if (!credentials) return false;

  return (
    credentials.username === expectedUsername &&
    credentials.password === expectedPassword
  );
}
