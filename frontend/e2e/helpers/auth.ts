/**
 * Playwright auth helper.
 *
 * Strategy:
 *  1. Use a synthetic token (no real backend call needed).
 *  2. Inject the token into localStorage via addInitScript (runs before React boots).
 *  3. Mock /api/auth/check so useLiff.ts validates the token without a real backend.
 *  4. Mock all data endpoints so tests are deterministic regardless of Firestore state.
 *
 * No Flask backend is required — all auth and data calls are intercepted by page.route().
 * This makes tests work in CI headless environments without the backend running.
 */

import type { Page } from "@playwright/test";

/** SESSION_KEY used when VITE_IS_TEST=true (set by webServer env in playwright.config.ts) */
const SESSION_KEY = "session_token_test";

export interface RoleFixture {
  role: "同仁" | "主管" | "HR";
  name: string;
  empId: string;
}

export const EMPLOYEE_FIXTURE: RoleFixture = {
  role: "同仁",
  name: "測試員工甲",
  empId: "E001",
};
export const MANAGER_FIXTURE: RoleFixture = {
  role: "主管",
  name: "測試主管",
  empId: "M001",
};
export const HR_FIXTURE: RoleFixture = {
  role: "HR",
  name: "測試HR",
  empId: "H001",
};

/** Score items shared across all role mocks */
const MOCK_SCORE_ITEMS = [
  { code: "A", name: "工作品質", description: "工作完成品質與正確性" },
  { code: "B", name: "工作效率", description: "準時完成工作任務" },
  { code: "C", name: "出勤狀況", description: "出勤準時與穩定性" },
  { code: "D", name: "溝通協調", description: "與同仁溝通合作" },
  { code: "E", name: "學習成長", description: "主動學習與進修" },
  { code: "F", name: "服從性", description: "服從主管與公司規定" },
];

/**
 * Set up auth + API mocks for the given role fixture.
 * Must be called before page.goto().
 */
export async function injectAuth(
  page: Page,
  fixture: RoleFixture,
): Promise<void> {
  // 1. Use a synthetic token — no real backend needed.
  //    useLiff.ts only checks `if (existing)` before calling /api/auth/check,
  //    which we mock below, so the token value itself is irrelevant.
  const token = `test-token-${fixture.role}-${fixture.empId}`;

  // 2. Mock /api/auth/check so useLiff.ts succeeds without a real Flask backend.
  //    This prevents the CI failure path: auth check → token cleared → LINE OAuth redirect.
  await page.route("**/api/auth/check", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        name: fixture.name,
        role: fixture.role,
        isTest: true,
        bound: true,
      }),
    }),
  );

  // 3. Inject token before React's useEffect reads localStorage.
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) =>
      localStorage.setItem(key, value),
    { key: SESSION_KEY, value: token },
  );

  // 4. Mock data endpoints.
  await setupDataMocks(page, fixture, token);
}

async function setupDataMocks(
  page: Page,
  fixture: RoleFixture,
  token: string,
): Promise<void> {
  // refresh-role: return the same token to avoid Firestore lookup
  await page.route("**/api/auth/refresh-role", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token, name: fixture.name, role: fixture.role }),
    }),
  );

  // Dashboard: return role-appropriate structure
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildDashboardMock(fixture)),
    }),
  );

  // Scoring items (6 fixed items)
  await page.route("**/api/scoring/items", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_SCORE_ITEMS),
    }),
  );

  // Employee's own self-score (null = not yet started)
  await page.route("**/api/scoring/my-self-score", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "null",
    }),
  );

  // Manager's existing scores for employees
  await page.route("**/api/scoring/my-scores*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    }),
  );

  // Employee scoring history (used by Score page)
  await page.route("**/api/scoring/employee-history*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "null",
    }),
  );

  // Save endpoints (draft + submit)
  await page.route("**/api/scoring/self-draft", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true }),
    }),
  );
  await page.route("**/api/scoring/self-submit", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true }),
    }),
  );
  await page.route("**/api/scoring/score", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        status: "草稿",
        rawScore: 85,
        finalScore: 90,
        weightedScore: 90,
      }),
    }),
  );

  // HR admin endpoints
  await page.route("**/api/admin/progress*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        employees: [],
        quarter: "115Q1",
        total: 0,
        scored: 0,
        draft: 0,
        pending: 0,
      }),
    }),
  );
  await page.route("**/api/admin/settings", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    }),
  );
  await page.route("**/api/admin/employees", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    }),
  );
}

function buildDashboardMock(fixture: RoleFixture): unknown {
  if (fixture.role === "同仁") {
    return {
      isEmployee: true,
      empName: fixture.name,
      quarter: "115Q1",
      selfScoreStatus: "未填寫",
      settings: {},
    };
  }

  if (fixture.role === "HR") {
    return { isHR: true };
  }

  // 主管
  return {
    quarter: "115Q1",
    quarterDescription: "115年第一季",
    managerName: fixture.name,
    total: 2,
    scored: 0,
    draft: 1,
    pending: 1,
    employees: [
      {
        name: "員工甲",
        dept: "業務部",
        section: "業務一科",
        joinDate: "2020-01-01",
        tenure: "5年",
        isProbation: false,
        daysWorked: 91,
        weight: 1.0,
        scoreStatus: "未評分",
      },
      {
        name: "員工乙",
        dept: "業務部",
        section: "業務一科",
        joinDate: "2022-06-01",
        tenure: "2年",
        isProbation: false,
        daysWorked: 91,
        weight: 1.0,
        scoreStatus: "草稿",
      },
    ],
    myScores: {},
    diffAlerts: [],
    settings: {},
  };
}
