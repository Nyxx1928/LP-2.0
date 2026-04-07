import { test, expect } from "@playwright/test";

test("storefront homepage renders core content", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "E-Commerce Storefront" })).toBeVisible();
  await expect(page.getByText("Practical tools for every Filipino home")).toBeVisible();
  await expect(page.getByRole("button", { name: "Login or Register" })).toBeVisible();
});
