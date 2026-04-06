/**
 * E2E: 主管評分流程
 *
 * 覆蓋：
 *  - 主管 Dashboard 顯示科別員工清單（section 隔離）
 *  - 點擊員工進入 /score 評分頁面
 *  - /score 頁面顯示 6 個評分項目
 *  - 主管可儲存草稿
 */

import { expect, test } from "@playwright/test";
import { MANAGER_FIXTURE, injectAuth } from "./helpers/auth";

test.describe("主管評分流程", () => {
  test.beforeEach(async ({ page }) => {
    await injectAuth(page, MANAGER_FIXTURE);
  });

  test("Dashboard 顯示主管視角與科別員工清單", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("測試主管")).toBeVisible();
    await expect(page.getByText("115Q1")).toBeVisible();

    // Both mock employees should appear
    await expect(page.getByText("員工甲")).toBeVisible();
    await expect(page.getByText("員工乙")).toBeVisible();

    // Score status badges
    await expect(page.getByText("未評分")).toBeVisible();
    await expect(page.getByText("草稿")).toBeVisible();
  });

  test("點擊員工卡片導航至 /score", async ({ page }) => {
    await page.goto("/");

    // Click first employee card
    await page.getByText("員工甲").click();
    await expect(page).toHaveURL(/\/score/);
    await expect(page).toHaveURL(/name=%E5%93%A1%E5%B7%A5%E7%94%B2/);
  });

  test("評分頁面顯示員工姓名與 6 個評分項目", async ({ page }) => {
    await page.goto("/");
    await page.getByText("員工甲").click();
    await expect(page).toHaveURL(/\/score/);

    // All 6 items must render
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

    // Grade buttons present
    await expect(
      page.getByRole("button", { name: "甲" }).first(),
    ).toBeVisible();
  });

  test("評分頁面可選評分並儲存草稿", async ({ page }) => {
    await page.goto("/");
    await page.getByText("員工甲").click();
    await expect(page).toHaveURL(/\/score/);

    // Select 乙 for the first scoring item
    await page.getByRole("button", { name: "乙" }).first().click();

    // Save as draft
    await page.getByRole("button", { name: /儲存草稿/ }).click();

    await expect(page.getByText(/草稿已儲存/)).toBeVisible();
  });
});
