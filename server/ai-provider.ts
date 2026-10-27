import { AppError } from '../shared/domain.ts';
import { CHAT_MODELS, isChatModel } from '../shared/chat.ts';
import type { AIStatus } from '../shared/chat.ts';

export interface ProviderMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface AIProvider {
  status(signal?: AbortSignal): Promise<AIStatus>;
  assertModel(modelId: string, signal?: AbortSignal): Promise<void>;
  stream(modelId: string, messages: ProviderMessage[], signal: AbortSignal, onDelta: (text: string) => void): Promise<void>;
}

export const CHAT_SYSTEM_PROMPT = '你是 ZX AI 本地助手，用准确简洁的中文回答，只给最终答案。你没有联网、文件、命令或账本工具，不能执行操作或读取财务数据。不要编造用户的账户、收支、负债、预算数字；请用户提供数据或到财务页面核对。不要冒充其他型号或云端旗舰。上下文仅最近最多 10 完整轮、正文合计 12000 字符，早期内容可能未包含。';

/** Replaceable local-provider boundary. There is deliberately no cloud implementation. */
export function createAiProvider(baseURL = 'http://127.0.0.1:11434', timeoutMs?: number): AIProvider {
  const base = new URL(baseURL);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password || base.pathname !== '/' || base.search || base.hash)
    throw new Error('ZX_OLLAMA_URL 只能使用 http://127.0.0.1:端口。');
  async function request(path: string, body?: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    let response: Response | undefined;
    try {
      response = await fetch(new URL(path, base), {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]),
      });
      if (!response.ok) throw new AppError(`本地模型服务返回 ${response.status}，请检查模型安装状态。`, 503);
      if (!response.body) throw new AppError('本地模型服务没有返回内容。', 502);
      const chunks: Uint8Array[] = []; let bytes = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 1024 * 1024) throw new AppError('本地模型服务返回的元数据过大。', 502);
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AppError('本地模型服务的数据格式不正确。', 502);
      return data as Record<string, unknown>;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (signal?.aborted) throw new AppError('模型请求已停止。', 499);
      throw new AppError('无法连接本机 Ollama，请启动服务后刷新。', 503);
    } finally { await response?.body?.cancel().catch(() => {}); }
  }
  async function status(signal?: AbortSignal): Promise<AIStatus> {
    let connected = false;
    let message = '无法连接本机 Ollama，请启动服务后刷新。';
    let installed: Record<string, unknown>[] = [];
    try {
      const data = await request('/api/tags', undefined, signal);
      if (!Array.isArray(data.models)) throw new AppError('本地模型列表格式不正确。', 502);
      installed = data.models.filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && !Array.isArray(m));
      connected = true;
      message = '已连接本机 Ollama；仅调用已安装的本地权重。';
    } catch (error) { message = error instanceof AppError ? error.message : message; }
    return {
      connected, message, cloudEnabled: false,
      models: CHAT_MODELS.map((m) => {
        const found = installed.find((entry) => typeof entry.name === 'string' && entry.name.toLowerCase() === m.id.toLowerCase());
        const remote = !!found && (!!found.remote_host || !!found.remote_model);
        const local = !!found && !remote;
        return {
          ...m, provider: 'ollama', installed: local, available: connected && local,
          status: !connected || remote ? 'unavailable' : local ? 'ready' : 'not_installed',
          detail: remote ? `${m.detail} 检测到远程代理，已禁止调用。` : m.detail,
          ...(local && Number.isSafeInteger(found.size) && Number(found.size) > 0 ? { sizeBytes: Number(found.size) } : {}),
          installCommand: `ollama pull ${m.id}`,
        };
      }),
    };
  }
  async function assertModel(modelId: string, signal?: AbortSignal) {
    if (!isChatModel(modelId)) throw new AppError('请选择支持的本地模型。');
    const available = await status(signal);
    if (!available.connected) throw new AppError(available.message, 503);
    if (!available.models.some((m) => m.id === modelId && m.available))
      throw new AppError('所选本地模型未安装或不可用，请在模型设置中查看状态。', 503);
    const info = await request('/api/show', { model: modelId }, signal);
    if (info.remote_host || info.remote_model) throw new AppError('已阻止云端代理模型；此版本仅允许本地权重。', 403);
  }
  return {
    status, assertModel,
    async stream(modelId, messages, signal, onDelta) {
      if (!isChatModel(modelId)) throw new AppError('请选择支持的本地模型。');
      await assertModel(modelId, signal);
      // Installed Qwen3 templates may append an opening <think> even for
      // Ollama's think:false. Keep Ollama's native thinking parser enabled for
      // Qwen so reasoning is kept in message.thinking, which is never displayed.
      // Also request Qwen's documented per-turn non-thinking soft switch. The
      // soft switch is model-dependent, so it is not treated as a safety parser.
      // Only the copied provider payload changes; saved user text is unchanged.
      // https://huggingface.co/Qwen/Qwen3-4B#advanced-usage-switching-between-thinking-and-non-thinking-modes-via-user-input
      const providerMessages = messages.map((message) => ({ ...message }));
      const qwen = modelId.startsWith('qwen3:');
      // The 30 GB Kimi GGUF cannot allocate CUDA_Host buffers on this machine.
      // CPU memory mapping uses the same local weights without a GPU copy.
      const kimi = CHAT_MODELS.some((model) => model.id === modelId && model.family === 'Kimi');
      if (qwen) {
        const latestUser = providerMessages.findLastIndex((message) => message.role === 'user');
        if (latestUser >= 0) providerMessages[latestUser].content += '\n/no_think';
      }
      const timeout = AbortSignal.timeout(timeoutMs ?? (kimi ? 900000 : 180000));
      const combined = AbortSignal.any([signal, timeout]);
      let response: Response | undefined;
      let completed = false;
      let outputLength = 0;
      let visibleAnswer = false;
      let insideThinking = false;
      let pendingText = '';
      const emit = (value: string) => {
        if (!value) return;
        outputLength += value.length;
        if (outputLength > 65536) throw new AppError('回复超过 65536 字符上限，已保留此前内容。', 502);
        if (value.trim()) visibleAnswer = true;
        onDelta(value);
      };
      // Hold incomplete tag prefixes across network boundaries; never stream think blocks.
      const clean = (value: string, final = false) => {
        pendingText += value;
        while (pendingText) {
          const tag = insideThinking ? '</think>' : '<think>';
          const index = pendingText.indexOf(tag);
          if (index >= 0) {
            if (!insideThinking) emit(pendingText.slice(0, index).replaceAll('</think>', ''));
            pendingText = pendingText.slice(index + tag.length);
            insideThinking = !insideThinking;
            continue;
          }
          let keep = 0;
          if (!final) for (let n = 1; n < tag.length; n++) if (pendingText.endsWith(tag.slice(0, n))) keep = n;
          const safe = pendingText.slice(0, pendingText.length - keep);
          if (!insideThinking) emit(safe.replaceAll('</think>', ''));
          pendingText = keep ? pendingText.slice(-keep) : '';
          break;
        }
      };
      try {
        response = await fetch(new URL('/api/chat', base), {
          method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelId, messages: [{ role: 'system', content: CHAT_SYSTEM_PROMPT }, ...providerMessages], stream: true, think: qwen, options: { temperature: 0.5, num_ctx: 16384, num_predict: qwen ? 4096 : 2048, ...(kimi ? { num_gpu: 0, use_mmap: true } : {}) } }),
          signal: combined,
        });
        if (!response.ok) throw new AppError(`本地模型返回 ${response.status}，请检查 Ollama 日志与模型兼容性。`, 502);
        if (!response.body) throw new AppError('本地模型返回空内容。', 502);
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let buffered = ''; let bytes = 0;
        const line = (raw: string) => {
          if (!raw.trim()) return;
          let data: Record<string, unknown>;
          try {
            const parsed: unknown = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
            data = parsed as Record<string, unknown>;
          } catch { throw new AppError('本地模型流格式错误，已保留已收到的回复。', 502); }
          if (completed) throw new AppError('模型在结束标记后继续返回内容，回复未被确认完整。', 502);
          if (data.error) throw new AppError('本地模型生成失败，请检查 Ollama 日志后重试。', 502);
          const msg = data.message;
          if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
            const content = (msg as Record<string, unknown>).content;
            if (content !== undefined && typeof content !== 'string') throw new AppError('本地模型返回的消息格式不正确。', 502);
            if (typeof content === 'string') clean(content);
            // message.thinking is intentionally ignored.
          }
          if (data.done === true) {
            clean('', true);
            if (data.done_reason === 'length') throw new AppError('回复达到模型输出上限，内容可能不完整。', 502);
            if (!visibleAnswer) throw new AppError('模型没有返回可显示的最终答案，请重新提问。', 502);
            completed = true;
          }
        };
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            bytes += next.value.byteLength;
            if (bytes > 8 * 1024 * 1024) throw new AppError('本地模型流超过大小上限，已保留此前内容。', 502);
            buffered += decoder.decode(next.value, { stream: true });
            let end: number;
            while ((end = buffered.indexOf('\n')) >= 0) {
              line(buffered.slice(0, end)); buffered = buffered.slice(end + 1);
            }
            if (buffered.length > 1024 * 1024) throw new AppError('本地模型单条流数据过大。', 502);
          }
          buffered += decoder.decode();
          if (buffered.trim()) line(buffered);
          if (!completed) throw new AppError('模型连接在完成前中断，已保留已收到的回复。', 502);
        } finally { await reader.cancel().catch(() => {}); }
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (signal.aborted) throw new AppError('生成已停止，已保留已收到的回复。', 499);
        if (timeout.aborted) throw new AppError('本地模型响应超时，已保留已收到的回复。', 504);
        throw new AppError('本地模型连接中断，已保留已收到的回复。', 502);
      } finally { await response?.body?.cancel().catch(() => {}); }
    },
  };
}
