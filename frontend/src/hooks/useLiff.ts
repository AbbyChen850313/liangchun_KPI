/**
 * LIFF / LINE Login initialisation hook.
 *
 * Two paths depending on environment:
 *   A. Inside LINE's in-app browser  → LIFF SDK (auto-auth, no user action)
 *   B. External browser (any browser) → LINE Login OAuth2 (standard redirect)
 *
 * Both paths produce the same result: a signed session JWT stored in
 * localStorage, and the LiffState exposed to the rest of the app.
 */

import { useCallback, useEffect, useState } from "react";
import { liffAdapter } from "../adapters/liff";
import { api } from "../services/api";
import { refreshRole } from "../services/authRefresh";

const IS_TEST = import.meta.env.VITE_IS_TEST === "true";
const SESSION_KEY = IS_TEST ? "session_token_test" : "session_token";

// LINE Login OAuth constants (channel IDs are not sensitive)
const LINE_LOGIN_CHANNEL_ID = IS_TEST ? "2009619528" : "2009611318";
const LINE_OAUTH_STATE_KEY = "line_oauth_state";
const LINE_OAUTH_REDIRECT_PATH = "/line-auth-callback";

export interface LiffState {
  ready: boolean;
  needBind: boolean;
  error: string | null;
  lineUid: string | null;
  name: string | null;
  role: string | null;
}

// ── LINE Login OAuth helpers ───────────────────────────────────────────────

function startLineLoginOAuth(): void {
  const state = crypto.randomUUID();
  sessionStorage.setItem(LINE_OAUTH_STATE_KEY, state);
  const redirectUri = window.location.origin + LINE_OAUTH_REDIRECT_PATH;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: LINE_LOGIN_CHANNEL_ID,
    redirect_uri: redirectUri,
    state,
    scope: "profile openid",
  });
  window.location.href =
    "https://access.line.me/oauth2/v2.1/authorize?" + params.toString();
}

function extractOAuthCallback(): { code: string; redirectUri: string } | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const stored = sessionStorage.getItem(LINE_OAUTH_STATE_KEY);

  if (!code || !state || state !== stored) return null;

  sessionStorage.removeItem(LINE_OAUTH_STATE_KEY);
  // Clean OAuth params from the URL without triggering a reload
  window.history.replaceState({}, "", "/");
  return { code, redirectUri: window.location.origin + LINE_OAUTH_REDIRECT_PATH };
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useLiff(): LiffState {
  const [state, setState] = useState<LiffState>({
    ready: false,
    needBind: false,
    error: null,
    lineUid: null,
    name: null,
    role: null,
  });

  const initialise = useCallback(async () => {
    try {
      // ── 1. Existing valid session ──────────────────────────────────────
      const existing = localStorage.getItem(SESSION_KEY);
      if (existing) {
        const { data } = await api.get("/api/auth/check", {
          headers: { Authorization: `Bearer ${existing}` },
        });
        setState({ ready: true, needBind: false, error: null, lineUid: null, name: data.name, role: data.role });
        // AC1: silently refresh role in background; does not block UI
        refreshRole().catch(() => {/* failure is harmless — interceptor retries on next API call */});
        return;
      }

      // ── 2A. External browser: LINE Login OAuth ─────────────────────────
      // Detect by checking if we're NOT inside LINE's in-app browser.
      // We use the user agent to avoid loading the LIFF SDK unnecessarily.
      const isLineApp = /Line\//i.test(navigator.userAgent);

      if (!isLineApp) {
        const callback = extractOAuthCallback();

        if (callback) {
          // Returning from LINE OAuth redirect → exchange code for session
          const { data } = await api.post("/api/auth/line-oauth", {
            code: callback.code,
            redirectUri: callback.redirectUri,
            isTest: IS_TEST,
          });
          localStorage.setItem(SESSION_KEY, data.token);
          setState({ ready: true, needBind: false, error: null, lineUid: null, name: data.name, role: data.role });
        } else {
          // First visit → redirect to LINE Login
          startLineLoginOAuth();
        }
        return;
      }

      // ── 2B. Inside LINE: LIFF flow ─────────────────────────────────────
      await liffAdapter.init();

      if (!liffAdapter.isLoggedIn()) {
        liffAdapter.login();
        return;
      }

      const accessToken = liffAdapter.getAccessToken();
      if (!accessToken) {
        throw new Error("無法取得 LINE 授權，請關閉後重新開啟此頁面");
      }
      const { data } = await api.post("/api/auth/session", {
        accessToken,
        isTest: IS_TEST,
      });

      localStorage.setItem(SESSION_KEY, data.token);
      setState({
        ready: true,
        needBind: false,
        error: null,
        lineUid: null,
        name: data.name,
        role: data.role,
      });
    } catch (err: any) {
      const msg: string = err?.message ?? "初始化失敗";

      if (err?.response?.data?.needBind || err?.message === "帳號未綁定") {
        // Store short-lived bind token (for external browser bind flow)
        const bindToken = err?.response?.data?.bindToken;
        if (bindToken) sessionStorage.setItem("line_bind_token", bindToken);
        setState((prev) => ({ ...prev, needBind: true }));
        return;
      }

      setState((prev) => ({ ...prev, ready: false, error: msg }));
    }
  }, []);

  useEffect(() => {
    initialise();
  }, [initialise]);

  return state;
}

/** Retrieve the stored session token (used by API service). */
export function getSessionToken(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

/** Clear session and reload for logout. */
export function logout(): void {
  localStorage.removeItem(SESSION_KEY);
  liffAdapter.logout();
  window.location.reload();
}
