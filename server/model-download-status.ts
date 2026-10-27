import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AIProvider } from './ai-provider.ts';

const FILES: Record<string, string> = {
  'deepseek-r1:8b': 'deepseek-r1-8b.json',
  'hf.co/bartowski/moonshotai_Kimi-Linear-48B-A3B-Instruct-GGUF:Q4_K_M': 'kimi-linear-48b-bartowski.json',
};

/** Optional local download telemetry. This module never starts a pull or inference. */
export function withDownloadStatus(ai: AIProvider, directory: string): AIProvider {
  return {
    ...ai,
    async status(signal?: AbortSignal) {
      const status = await ai.status(signal);
      status.models = await Promise.all(status.models.map(async (model) => {
        if (model.installed || !FILES[model.id]) return model;
        try {
          const content = await readFile(join(directory, FILES[model.id]), 'utf8');
          if (content.length > 8192) return model;
          const p = JSON.parse(content) as Record<string, unknown>;
          if (p.model !== model.id || p.finished === true || typeof p.updatedAt !== 'string') return model;
          const age = Date.now() - Date.parse(p.updatedAt);
          if (!Number.isFinite(age) || age < -30000 || age > 180000) return model;
          const total = p.total, completed = p.completed;
          if (!Number.isSafeInteger(total) || !Number.isSafeInteger(completed) || Number(total) <= 0 || Number(completed) < 0 || Number(completed) > Number(total)) return model;
          return { ...model, available: false, download: { completed: Number(completed), total: Number(total), status: '下载中' } };
        } catch { return model; }
      }));
      return status;
    },
  };
}
