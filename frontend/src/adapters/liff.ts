/**
 * LIFF adapter — abstracts window.liff behind an interface (DIP).
 * Tests can swap in a stub; production uses RealLiffAdapter.
 */

const IS_TEST = import.meta.env.VITE_IS_TEST === "true";
// Use separate LIFF app IDs per environment so LINE validates the endpoint URL correctly.
// Test LIFF app must have endpoint = https://linchun-hr-test.web.app
// Prod LIFF app must have endpoint = https://linchun-hr.web.app
const LIFF_ID = IS_TEST
  ? (import.meta.env.VITE_LIFF_ID_TEST as string)
  : (import.meta.env.VITE_LIFF_ID as string);
const LIFF_SDK_URL = "https://static.line-scdn.net/liff/edge/2/sdk.js";
const LIFF_INIT_TIMEOUT_MS = 12_000;
const LIFF_ENDPOINT = IS_TEST
  ? "https://linchun-hr-test.web.app"
  : "https://linchun-hr.web.app";

declare global {
  interface Window {
    liff: any;
  }
}

export interface ILiffAdapter {
  /** Load SDK + call liff.init(). Must be awaited before other methods. */
  init(): Promise<void>;
  /** True when running inside LINE's in-app browser. */
  isInClient(): boolean;
  isLoggedIn(): boolean;
  login(): void;
  /** Returns the LIFF access token; init() must have been called first. */
  getAccessToken(): string;
  logout(): void;
}

function loadSdk(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.liff) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = LIFF_SDK_URL;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("LINE SDK 載入失敗"));
    document.head.appendChild(script);
  });
}

class RealLiffAdapter implements ILiffAdapter {
  async init(): Promise<void> {
    await loadSdk();
    await Promise.race([
      window.liff.init({ liffId: LIFF_ID }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `LIFF 初始化逾時，請確認 LINE Developers Console 的 Endpoint URL 已設為 ${LIFF_ENDPOINT}`
              )
            ),
          LIFF_INIT_TIMEOUT_MS
        )
      ),
    ]);
  }

  isInClient(): boolean {
    return window.liff?.isInClient?.() ?? false;
  }

  isLoggedIn(): boolean {
    return window.liff?.isLoggedIn?.() ?? false;
  }

  login(): void {
    window.liff.login();
  }

  getAccessToken(): string {
    return window.liff.getAccessToken();
  }

  logout(): void {
    window.liff?.logout?.();
  }
}

export const liffAdapter: ILiffAdapter = new RealLiffAdapter();
