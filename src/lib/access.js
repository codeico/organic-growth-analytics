/**
 * @param {string} path
 * @param {{ id: string } | null} user
 */
export function routeForUser(path, user) {
  if (path.startsWith("/dashboard") && !user) return "/login";
  if ((path === "/login" || path === "/auth/confirm") && user)
    return "/dashboard";
  return path;
}
