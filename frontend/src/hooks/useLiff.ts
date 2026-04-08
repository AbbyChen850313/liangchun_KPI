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
import { refreshRole, SESSION_KEY } from "../services/authRefresh";

// Raw base URL — used by the session-check call that must bypass the shared
// api interceptor to prevent the 401→reload→login infinite loop.
const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

const IS_TEST = import.meta.env.VITE_IS_TEST === "true";

// LINE Login OAuth constants (channel IDs are not sensitive)
const LINE_LOGIN_CHANNEL_ID = IS_TEST ? "2009619528" : "2009611318";
const LINE_OAUTH_STATE_KEY = "line_oauth_state";
const LINE_OAUTH_REDIRECT_PATH = "/line-auth-callback";

// Persists across LIFF redirects (useRef resets on page navigation).
// sessionStorage survives in-tab navigation but clears when the tab is closed.
const LIFF_LOGIN_ATTEMPTED_KEY = "liff_login_attempted";

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

  // Guard refs — prevent double-init within the same React lifecycle (StrictMode).
  // loginAttemptedRef uses sessionStorage instead of useRef because liff.login()
  // navigates away and back, resetting all useRef values. sessionStorage persists
  // across in-tab navigations so the "already tried once" guard survives the
  // LIFF redirect and prevents the infinite login loop.
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
            const freshRole = await refreshRole().catch(() => null);
            setState({ ready: true, needBind: false, error: null, lineUid: null, name: data.name, role: freshRole ?? data.role });
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
          // Guard: only call liff.login() once per tab session.
          //
          // useRef is NOT sufficient here: liff.login() navigates the page away
          // and LIFF redirects back, which resets all React state including refs.
          // sessionStorage survives in-tab navigation, so it catches the case
          // where we're already returning from a LIFF redirect but isLoggedIn()
          // is still false — that means LIFF auth genuinely failed, so we surface
          // an error instead of looping indefinitely.
          const alreadyAttempted =
            loginAttemptedRef.current ||
            sessionStorage.getItem(LIFF_LOGIN_ATTEMPTED_KEY) === "1";

          if (alreadyAttempted) {
            // Clear the flag so the user can retry by reloading manually.
            sessionStorage.removeItem(LIFF_LOGIN_ATTEMPTED_KEY);
            loginAttemptedRef.current = false;
            setState((prev) => ({
              ...prev,
              error: "LINE 登入失敗，請關閉後重新開啟此頁面",
            }));
            return;
          }

          loginAttemptedRef.current = true;
          sessionStorage.setItem(LIFF_LOGIN_ATTEMPTED_KEY, "1");
          // Safety net: if LINE server is unresponsive and the page never navigates
          // away within 10 s, clear the flag and surface a timeout error so the user
          // can retry instead of staring at a frozen screen indefinitely.
          setTimeout(() => {
            sessionStorage.removeItem(LIFF_LOGIN_ATTEMPTED_KEY);
            loginAttemptedRef.current = false;
            setState((prev) => ({ ...prev, error: "LINE 登入逾時，請重新整理頁面" }));
          }, 10_000);
          liffAdapter.login(); // navigates away; no further code runs
          return;
        }

        // Successfully logged in — clear the login-attempt flag.
        sessionStorage.removeItem(LIFF_LOGIN_ATTEMPTED_KEY);

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
        let sessionData: { token: string; name: string; role: string };
        try {
          const { data } = await axios.post<{ token: string; name: string; role: string }>(`${BASE_URL}/api/auth/session`, {
            accessToken,
            isTest: IS_TEST,
          });
          sessionData = data;
        } catch (sessionCreateErr: any) {
          const sessionErrBody = sessionCreateErr?.response?.data ?? {};
          if (sessionErrBody.needBind) {
            const bindToken = sessionErrBody.bindToken;
            if (bindToken) sessionStorage.setItem("line_bind_token", bindToken);
            setState((prev) => ({ ...prev, needBind: true }));
            return;
          }
          // Any other session-creation failure → surface the error; do NOT retry.
          const msg: string = sessionErrBody.error ?? sessionCreateErr?.message ?? "Session 建立失敗";
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
      } catch (initErr: any) {
        const msg: string = initErr?.message ?? "初始化失敗";

        if (initErr?.response?.data?.needBind || initErr?.message === "帳號未綁定") {
          // Store short-lived bind token (for external browser bind flow)
          const bindToken = initErr?.response?.data?.bindToken;
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
