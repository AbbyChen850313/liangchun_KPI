/**
 * E2E: HR 後台操作
 *
 * 覆蓋：
 *  - HR Dashboard 顯示管理後台入口
 *  - 導航至 /admin
 *  - /admin 分頁列正常渲染（評分進度、系統設定、員工名單）
 *  - 分頁切換可操作
 */

import { expect, test } from "@playwright/test";
import { HR_FIXTURE, injectAuth } from "./helpers/auth";

test.describe("HR 後台操作", () => {
  test.beforeEach(async ({ page }) => {
    await injectAuth(page, HR_FIXTURE);
  });

  test("Dashboard 顯示 HR 管理後台入口", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("button", { name: /HR 管理後台|進入.*後台/ }),
    ).toBeVisible();
  });

  test("點擊進入 HR 管理後台導航至 /admin", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /HR 管理後台|進入.*後台/ }).click();
    await expect(page).toHaveURL(/\/admin/);
  });

  test("/admin 頁面顯示完整分頁列", async ({ page }) => {
    await page.goto("/admin");

    // Tab bar must show all expected tabs
    await expect(page.getByRole("button", { name: "評分進度" })).toBeVisible();
    await expect(page.getByRole("button", { name: "系統設定" })).toBeVisible();
    await expect(page.getByRole("button", { name: "員工名單" })).toBeVisible();
  });

  test("HR 可切換分頁至「系統設定」", async ({ page }) => {
    await page.goto("/admin");

    await page.getByRole("button", { name: "系統設定" }).click();

    // The active tab changes — settings content should appear
    // At minimum the button itself should be in active state or settings section visible
    const settingsBtn = page.getByRole("button", { name: "系統設定" });
    await expect(settingsBtn).toHaveClass(/active/);
  });

  test("HR 可切換分頁至「員工名單」", async ({ page }) => {
    await page.goto("/admin");

    await page.getByRole("button", { name: "員工名單" }).click();

    const employeesBtn = page.getByRole("button", { name: "員工名單" });
    await expect(employeesBtn).toHaveClass(/active/);
  });
});
