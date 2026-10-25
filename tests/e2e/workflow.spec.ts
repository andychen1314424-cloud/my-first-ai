import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('create through the Ollama protocol, track progress, save notes, reload, export and delete', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('本地模型已就绪')).toBeVisible();
  await page.getByRole('button', { name: '学习笔记整理' }).click();
  await page.getByRole('button', { name: '看看这个功能背后的提示词' }).click();
  await expect(page.locator('.prompt-box')).toContainText('输出结构');
  await page.getByRole('button', { name: '生成我的项目' }).click();
  await expect(
    page.getByRole('heading', { name: '我的第一台学习笔记整理器', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.source-banner')).toContainText('本地 AI 生成');
  const checkbox = page.getByRole('checkbox').first();
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await page
    .getByRole('textbox', { name: '项目复盘' })
    .fill('我学会了输入校验。<script>alert(1)</script>');
  await expect(page.getByRole('button', { name: '导出 Markdown' })).toBeDisabled();
  await page.getByRole('button', { name: '保存复盘' }).click();
  await expect(page.getByText('复盘已保存。', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('navigation', { name: '项目历史' }).getByRole('button').first().click();
  await expect(page.getByRole('checkbox').first()).toBeChecked();
  await expect(page.getByRole('textbox', { name: '项目复盘' })).toHaveValue(
    '我学会了输入校验。<script>alert(1)</script>',
  );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Markdown' }).click();
  const artifact = await download;
  const content = await readFile((await artifact.path())!, 'utf8');
  expect(content).toContain('- [x]');
  expect(content).toContain('&lt;script&gt;');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除这个项目' }).click();
  await expect(page.getByText('项目已删除。')).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile sample workflow stays usable and protects unsaved notes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: /先看看一个完成的方案/ }).click();
  await expect(page.locator('.source-banner')).toContainText('人工教学示例');
  await page.getByRole('textbox', { name: '项目复盘' }).fill('还没保存的笔记');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '新建另一个项目' }).click();
  await expect(page.getByRole('textbox', { name: '项目复盘' })).toHaveValue('还没保存的笔记');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/mobile-project.png', fullPage: true });
});

test('unavailable Ollama shows setup and keeps real generation disabled', async ({ page }) => {
  await page.route('**/api/models', (route) =>
    route.fulfill({
      json: { connected: false, models: [], message: '无法连接 Ollama，请先启动本地服务。' },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: '文件整理工具' }).click();
  await expect(page.getByRole('button', { name: '生成我的项目' })).toBeDisabled();
  await expect(page.getByText('无法连接 Ollama，请先启动本地服务。')).toBeVisible();
  await page.screenshot({ path: 'test-results/desktop-start.png', fullPage: true });
  await page.getByRole('button', { name: /先看看一个完成的方案/ }).click();
  await expect(page.locator('.source-banner')).toContainText('非 AI 生成');
  await page.screenshot({ path: 'test-results/desktop-project.png', fullPage: true });
});
