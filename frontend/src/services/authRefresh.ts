/**
 * Role-refresh utility — standalone module to avoid circular imports between
 * api.ts (interceptor) ↔ useLiff.ts (hook).
 *
 * Directly uses axios (not the shared api instance) so the 401 interceptor
 * in api.ts does not recursively call itself.
 */

import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";
const IS_TEST = import.meta.env.VITE_IS_TEST === "true";
export const SESSION_KEY = IS_TEST ? "session_token_test" : "session_token";

/**
 * POST /api/auth/refresh-role with the stored JWT.
 * On success: overwrites localStorage with fresh JWT containing latest role.
 * Returns new role string, or null if refresh is not possible.
 */
export async function refreshRole(): Promise<string | null> {
  const token = localStorage.getItem(SESSION_KEY);
  if (!token) return null;
  try {
    const { data } = await axios.post(
      `${BASE_URL}/api/auth/refresh-role`,
      {},
      { headers: { Authorization: `Bearer ${token}` } },
    );
    localStorage.setItem(SESSION_KEY, data.token);
    return data.role as string;
  } catch {
    return null;
  }
}
