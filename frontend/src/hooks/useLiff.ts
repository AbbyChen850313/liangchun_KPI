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

import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { liffAdapter } from "../adapters/liff";
import { api } from "../services/api";
import { refreshRole, SESSION_KEY } from "../services/authRefresh";

// Raw base URL — used by the session-check call that must bypass the shared
// api interceptor to prevent the 401→reload→login infinite loop.
const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

const IS_TEST = import.meta.env.VITE_IS_TEST === "true";

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

  // Guard refs — prevent double-init and double-login across React StrictMode
  // double-invocations, LIFF redirects, and page reloads triggered elsewhere.
  const initStartedRef = useRef(false);
  const loginAttemptedRef = useRef(false);

  useEffect(() => {
    // StrictMode in dev mounts twice; the ref ensures we only run once.
    if (initStartedRef.current) return;
    initStartedRef.current = true;

    async function initialise() {
      try {
        // ── 1. Existing valid session ────────────────────────────────────
        // Raw axios is used intentionally here: the shared `api` instance has
        // a 401 interceptor that calls liffAdapter.logout() + reload().
        // If that interceptor fires during session validation it restarts the
        // LIFF login flow and causes LINE to rate-limit repeated liff.login()
        // calls, producing an infinite loop. With raw axios a failed check
        // simply clears the stale token and falls through to fresh auth.
        const existing = localStorage.getItem(SESSION_KEY);
        if (existing) {
          try {
            const { data } = await axios.get(`${BASE_URL}/api/auth/check`, {
              headers: { Authorization: `Bearer ${existing}` },
            });
            setState({ ready: true, needBind: false, error: null, lineUid: null, name: data.name, role: data.role });
            refreshRole().catch(() => {});
            return;
          } catch {
            // Token is expired or invalid — discard it and fall through to
            // fresh LIFF / OAuth authentication without any page reload.
            localStorage.removeItem(SESSION_KEY);
          }
        }

        // ── 2A. External browser: LINE Login OAuth ───────────────────────
        // Detect by checking if we're NOT inside LINE's in-app browser.
        // We use the user agent to avoid loading the LIFF SDK unnecessarily.
        const isLineApp = /Line\//i.test(navigator.userAgent);

        if (!isLineApp) {
          const callback = extractOAuthCallback();

          if (callback) {
            // Returning from LINE OAuth redirect → exchange code for session.
            // Use raw axios so that a 4xx/5xx from this endpoint surfaces as
            // an error (caught below → setError) rather than triggering the
            // shared interceptor's reload path, which would restart the loop.
            const { data } = await axios.post(`${BASE_URL}/api/auth/line-oauth`, {
              code: callback.code,
              redirectUri: callback.redirectUri,
              isTest: IS_TEST,
            });
            localStorage.setItem(SESSION_KEY, data.token);
            setState({ ready: true, needBind: false, error: null, lineUid: null, name: data.name, role: data.role });
          } else {
            // First visit → redirect to LINE Login (navigates away; no state
            // update needed — the page is leaving).
            startLineLoginOAuth();
          }
          return;
        }

        // ── 2B. Inside LINE: LIFF flow ───────────────────────────────────
        await liffAdapter.init();

        if (!liffAdapter.isLoggedIn()) {
          // Guard: only call liff.login() once. If we are already back from
          // a LIFF redirect and isLoggedIn() is still false, treat it as an
          // unrecoverable error rather than looping indefinitely.
          if (loginAttemptedRef.current) {
            setState((prev) => ({
              ...prev,
              error: "LINE 登入失敗，請關閉後重新開啟此頁面",
            }));
            return;
          }
          loginAttemptedRef.current = true;
          liffAdapter.login(); // navigates away; no further code runs
          return;
        }

        const accessToken = liffAdapter.getAccessToken();
        if (!accessToken) {
          setState((prev) => ({
            ...prev,
            error: "無法取得 LINE 授權，請關閉後重新開啟此頁面",
          }));
          return;
        }

        // Use raw axios here too: a backend error (4xx/5xx) on this endpoint
        // must set an error state and stop — not trigger the shared 401
        // interceptor's reload path, which would restart the loop.
        let sessionData: any;
        try {
          const { data } = await axios.post(`${BASE_URL}/api/auth/session`, {
            accessToken,
            isTest: IS_TEST,
          });
          sessionData = data;
        } catch (sessionErr: any) {
          const responseData = sessionErr?.response?.data ?? {};
          if (responseData.needBind) {
            const bindToken = responseData.bindToken;
            if (bindToken) sessionStorage.setItem("line_bind_token", bindToken);
            setState((prev) => ({ ...prev, needBind: true }));
            return;
          }
          // Any other session-creation failure → surface the error; do NOT retry.
          const msg: string = responseData.error ?? sessionErr?.message ?? "Session 建立失敗";
          setState((prev) => ({ ...prev, ready: false, error: msg }));
          return;
        }

        localStorage.setItem(SESSION_KEY, sessionData.token);
        setState({
          ready: true,
          needBind: false,
          error: null,
          lineUid: null,
          name: sessionData.name,
          role: sessionData.role,
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

        // Terminal error — display to user; do NOT trigger any re-login.
        setState((prev) => ({ ...prev, ready: false, error: msg }));
      }
    }

    initialise();
  // Empty deps: run exactly once on mount. initStartedRef provides the real guard.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
