import { test, expect } from '@playwright/test';

test('model center shows three local families, blocks uninstalled models and remembers the selected local model', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#/settings');
  const center = page.getByRole('region', { name: '本地模型中心' });
  await expect(center.getByRole('heading', { name: 'DeepSeek', exact: true })).toBeVisible();
  await expect(center.getByRole('heading', { name: 'Kimi', exact: true })).toBeVisible();
  await expect(center.getByText('Kimi Linear · 48B-A3B', { exact: true })).toBeVisible();
  const kimi = center.locator('article').filter({ hasText: 'Kimi Linear · 48B-A3B' });
  await expect(kimi.getByRole('button', { name: '使用此模型' })).toBeDisabled();
  await expect(center.getByText('DeepSeek R1 · 1.5B 蒸馏版', { exact: true })).toBeVisible();
  const qwen = center.locator('article').filter({ hasText: 'Qwen3 · 4B' });
  await qwen.getByRole('button', { name: '使用此模型' }).click();
  await page.reload();
  await expect(qwen.getByRole('button', { name: '当前选择' })).toBeVisible();
  await page.screenshot({ path: 'test-results/model-center-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/model-center-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('local chat streams a fixture reply, survives reload and closing the tab, then deletes with confirmation', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#/assistant');
  const model = page.getByLabel('选择本地模型');
  await expect(model).toBeEnabled();
  await model.selectOption('deepseek-r1:1.5b');
  const question = `合成持久对话-${Date.now()}`;
  await page.getByRole('textbox', { name: '消息', exact: true }).fill(question);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const log = page.getByRole('log', { name: '聊天消息' });
  await expect(log).toContainText('本地协议夹具：这是一条合成回答。');
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
  await expect(log.getByText('DeepSeek R1 · 1.5B 蒸馏版', { exact: true })).toBeVisible();
  const saved = (await (await request.get('/api/chat/conversations')).json()).find((c: { title: string }) => c.title === question);
  expect(saved.messages).toHaveLength(2);
  expect(saved.messages[1].status).toBe('complete');
  await page.reload(); await expect(log).toContainText(question);
  const reopened = await page.context().newPage();
  await page.close(); page = reopened;
  await page.goto('/#/assistant');
  await expect(page.getByRole('log', { name: '聊天消息' })).toContainText('本地协议夹具：这是一条合成回答。');
  await page.screenshot({ path: 'test-results/local-chat-desktop.png', fullPage: true });
  await page.getByRole('button', { name: `删除对话：${question}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除这段对话？' });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect((await request.get(`/api/chat/conversations/${saved.id}`)).status()).toBe(200);
  await page.getByRole('button', { name: `删除对话：${question}`, exact: true }).click();
  await dialog.getByRole('button', { name: '删除', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await request.get(`/api/chat/conversations/${saved.id}`)).status()).toBe(404);
  expect(errors).toEqual([]);
});

test('mobile chat stops and retains partial output, retries by explicit new question and displays failures', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/assistant');
  await page.getByLabel('选择本地模型').selectOption('deepseek-r1:1.5b');
  const composer = page.getByRole('textbox', { name: '消息', exact: true });
  const question = `合成中止测试[慢速]-${Date.now()}`;
  await composer.fill(question); await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('log', { name: '聊天消息' })).toContainText('本地协议夹具：');
  await page.getByRole('button', { name: '停止生成' }).click();
  await expect(page.getByText('已停止 · 回答未完成', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
  const saved = (await (await request.get('/api/chat/conversations')).json()).find((c: { title: string }) => c.title.startsWith('合成中止测试'));
  expect(saved.messages[1].status).toBe('stopped');
  expect(saved.messages[1].text).toContain('本地协议夹具：');
  await page.getByRole('button', { name: '重新提问', exact: true }).click();
  await expect(composer).toHaveValue(question);
  await composer.fill('合成失败测试[错误]'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('本地模型返回 500');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/local-chat-mobile.png', fullPage: true });
});

test('a conversation started in another tab refreshes from pending to authoritative completion', async ({ page, request }) => {
  const created = await (await request.post('/api/chat/conversations', { data: { title: '合成跨窗口对话' } })).json();
  const response = await fetch(`http://127.0.0.1:4174/api/chat/conversations/${created.id}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '合成跨窗口[慢速]', modelId: 'deepseek-r1:1.5b', requestId: crypto.randomUUID() }),
  });
  expect(response.status).toBe(200);
  const body = response.text();
  await page.goto('/#/assistant');
  const log = page.getByRole('log', { name: '聊天消息' });
  await expect(log).toBeVisible();
  await body;
  await expect(log).toContainText('合成慢速片段。'.repeat(8));
  await expect(log).not.toContainText('尚未确认完成');
  const persisted = await (await request.get(`/api/chat/conversations/${created.id}`)).json();
  expect(persisted.messages.at(-1).status).toBe('complete');
  await request.delete(`/api/chat/conversations/${created.id}`);
});
