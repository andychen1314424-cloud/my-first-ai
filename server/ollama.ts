import {
  AppError,
  LOCAL_MODELS,
  PLAN_SCHEMA,
  buildMessages,
  validatePlan,
} from '../shared/domain.ts';
import type { Brief, ModelName, ModelStatus } from '../shared/domain.ts';

export function createOllama(baseURL = 'http://127.0.0.1:11434', timeoutMs = 180000) {
  const base = new URL(baseURL);
  // Literal loopback avoids DNS rebinding and accidental remote providers.
  if (
    base.protocol !== 'http:' ||
    base.hostname !== '127.0.0.1' ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  ) {
    throw new Error('ZX_OLLAMA_URL 只能使用 http://127.0.0.1:端口。');
  }
  async function request(path: string, body?: unknown, signal?: AbortSignal, timeout = 5000) {
    try {
      const response = await fetch(new URL(path, base), {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]),
      });
      if (!response.ok) {
        if (response.status === 404)
          throw new AppError('找不到本地模型，请先下载所选模型，并刷新连接。', 503);
        throw new AppError(
          `Ollama 返回 ${response.status}。请检查模型、可用内存和 Ollama 日志后重试。`,
          502,
        );
      }
      // Cap provider data before parsing. Do not expose upstream response bodies.
      if (!response.body) throw new AppError('Ollama 返回空内容。', 502);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 1024 * 1024) throw new AppError('模型返回内容过长，请缩小项目范围。', 502);
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new AppError('Ollama 返回了错误的数据结构。', 502);
      return value as Record<string, unknown>;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (signal?.aborted) throw new AppError('已取消生成，未保存项目。', 499);
      if (error instanceof Error && error.name === 'TimeoutError')
        throw new AppError('本地模型响应超时。可换用较小模型，或缩短输入后重试。', 504);
      if (error instanceof SyntaxError)
        throw new AppError('Ollama 返回了无法解析的数据，请检查服务。', 502);
      throw new AppError('无法连接 Ollama。请先启动 Ollama，然后点击刷新连接。', 503);
    }
  }
  async function status(signal?: AbortSignal): Promise<ModelStatus> {
    try {
      const data = await request('/api/tags', undefined, signal);
      if (!Array.isArray(data.models)) throw new AppError('Ollama 的模型列表格式不正确。', 502);
      const names = data.models
        .filter(
          (m: { remote_host?: string; remote_model?: string } | null) =>
            m && !m.remote_host && !m.remote_model,
        )
        .map((m: { name?: string }) => m.name);
      const models = LOCAL_MODELS.filter((name) => names.includes(name)) as ModelName[];
      return {
        connected: true,
        models,
        message: models.length ? '本地模型已就绪' : '已连接 Ollama，请先下载一个 Qwen3 本地模型。',
      };
    } catch (error) {
      return {
        connected: false,
        models: [],
        message: error instanceof Error ? error.message : '无法连接 Ollama。',
      };
    }
  }
  return {
    status,
    async generate(brief: Brief, signal: AbortSignal) {
      const available = await status(signal);
      signal.throwIfAborted();
      if (!available.connected) throw new AppError(available.message, 503);
      if (!available.models.includes(brief.model))
        throw new AppError('所选模型尚未下载，请先下载或选择已安装模型。', 503);
      const info = await request('/api/show', { model: brief.model }, signal);
      if (info.remote_host || info.remote_model)
        throw new AppError('检测到云端模型，此版本仅允许本地推理。', 400);
      const data = await request(
        '/api/chat',
        {
          model: brief.model,
          messages: buildMessages(brief),
          format: PLAN_SCHEMA,
          stream: false,
          think: false,
          options: { temperature: 0.2, num_ctx: 8192, num_predict: 4000 },
        },
        signal,
        timeoutMs,
      );
      signal.throwIfAborted();
      if (data.done !== true || data.done_reason === 'length')
        throw new AppError('模型输出尚未完整结束，请缩小需求范围后重试。', 502);
      const message = data.message as { content?: string } | undefined;
      try {
        if (typeof message?.content !== 'string') throw new Error('Missing content');
        return validatePlan(JSON.parse(message.content));
      } catch {
        throw new AppError(
          '模型输出不符合项目结构，本次未保存。请简化想法或换用 4b 模型后重试。',
          502,
        );
      }
    },
  };
}
