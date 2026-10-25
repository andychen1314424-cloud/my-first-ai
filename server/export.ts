import type { Project } from '../shared/domain.ts';

// Escape user/model content so exports are text, not active HTML or image links.
const escape = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_[\]#!|])/g, '\\$1');
export function toMarkdown(p: Project): string {
  const e = escape;
  return [
    `# ${e(p.plan.title)}`,
    '',
    `来源：${p.source === 'example' ? '人工教学示例（非 AI 生成）' : `Ollama 本地模型 ${e(p.brief.model)}`}`,
    `创建时间：${p.createdAt}`,
    `完成进度：${p.done.filter(Boolean).length}/${p.done.length}`,
    '',
    '## 原始想法',
    '',
    e(p.brief.idea),
    '',
    `限制：${e(p.brief.constraints || '未填写')}`,
    '',
    '## 最小可行版本',
    '',
    e(p.plan.summary),
    '',
    ...p.plan.scope.map((s) => `- ${e(s)}`),
    '',
    '## 任务清单',
    '',
    ...p.plan.tasks.flatMap((t, i) => [
      `- [${p.done[i] ? 'x' : ' '}] ${e(t.title)}（约 ${t.minutes} 分钟）`,
      `  - 操作：${e(t.action).replace(/\n/g, '\n    ')}`,
      `  - 验收：${e(t.acceptance).replace(/\n/g, '\n    ')}`,
      `  - 学习点：${e(t.learn).replace(/\n/g, '\n    ')}`,
      '',
    ]),
    '## 待确认事项',
    '',
    ...(p.plan.assumptions.length
      ? p.plan.assumptions.map((s) => `- ${e(s)}`)
      : ['暂无列出，仍需自己检查可行性。']),
    '',
    '## 复盘',
    '',
    e(p.notes || '尚未记录。'),
    '',
    '## 下一步',
    '',
    ...p.plan.nextIdeas.map((s) => `- ${e(s)}`),
    '',
  ].join('\n');
}
