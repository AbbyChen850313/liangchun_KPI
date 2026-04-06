/**
 * E2E: 員工自評流程
 *
 * 安全硬限制驗證：
 *  - 員工 Dashboard 不含 finalScore / 主管分數
 *  - 員工只能看到自己的自評狀態
 */

import { expect, test } from "@playwright/test";
import { EMPLOYEE_FIXTURE, injectAuth } from "./helpers/auth";

test.describe("員工自評流程", () => {
  test.beforeEach(async ({ page }) => {
    await injectAuth(page, EMPLOYEE_FIXTURE);
  });

  test("Dashboard 顯示員工視角且不暴露 finalScore", async ({ page }) => {
    await page.goto("/");

    // Employee name and self-score status are visible
    await expect(page.getByText("測試員工甲")).toBeVisible();
    await expect(page.getByText("自評狀態")).toBeVisible();
    await expect(page.getByText("未填寫")).toBeVisible();

    // finalScore must never appear — backend enforces this via EmployeeDashboard type
    // which excludes manager/final score fields entirely
    const pageContent = await page.content();
    expect(pageContent).not.toMatch(/finalScore|最終分數|主管分數/);
  });

  test("點擊「填寫自評」按鈕導航至 /self-score", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /填寫自評|查看自評/ }).click();
    await expect(page).toHaveURL(/\/self-score/);
  });

  test("自評頁面載入全部 6 個評分項目", async ({ page }) => {
    await page.goto("/self-score");

    // All 6 scoring item names must render
    const itemNames = [
      "工作品質",
      "工作效率",
      "出勤狀況",
      "溝通協調",
      "學習成長",
      "服從性",
    ];
    for (const name of itemNames) {
      await expect(page.getByText(name)).toBeVisible();
    }

    // Grade buttons (甲 乙 丙 丁) must be present
    await expect(
      page.getByRole("button", { name: "甲" }).first(),
    ).toBeVisible();
  });

  test("自評頁面可選評分並儲存草稿", async ({ page }) => {
    await page.goto("/self-score");

    // Select 甲 for the first item
    await page.getByRole("button", { name: "甲" }).first().click();

    // Click save draft
    await page.getByRole("button", { name: /儲存草稿/ }).click();

    // Toast confirmation should appear
    await expect(page.getByText(/草稿已儲存/)).toBeVisible();
  });
});
