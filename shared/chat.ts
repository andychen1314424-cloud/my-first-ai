/** Local chat contract. No cloud provider or automatic financial-data access. */
export interface AIModel {
  id: string;
  name: string;
  family: 'Qwen' | 'DeepSeek' | 'Kimi';
  provider: 'ollama';
  installed: boolean;
  available: boolean;
  status: 'ready' | 'not_installed' | 'unavailable';
  detail: string;
  sizeBytes?: number;
  installCommand?: string;
  download?: { completed: number; total: number; status: string };
}
export interface AIStatus {
  connected: boolean;
  message: string;
  models: AIModel[];
  cloudEnabled: false;
}
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
  modelId?: string;
  status?: 'complete' | 'stopped' | 'error';
  error?: string;
}
export interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
}
export type ChatEvent =
  | { type: 'start'; user: ChatMessage; assistant: ChatMessage }
  | { type: 'delta'; text: string }
  | { type: 'done'; message: ChatMessage }
  | { type: 'error'; error: string; message?: ChatMessage };

export const CHAT_MODELS = [
  { id: 'qwen3:1.7b', name: 'Qwen3 · 1.7B', family: 'Qwen', detail: 'Qwen3 本地模型，1.7B 参数。' },
  { id: 'qwen3:4b', name: 'Qwen3 · 4B', family: 'Qwen', detail: 'Qwen3 本地模型，4B 参数。' },
  { id: 'qwen3:8b', name: 'Qwen3 · 8B', family: 'Qwen', detail: 'Qwen3 本地模型，8B 参数。' },
  { id: 'deepseek-r1:1.5b', name: 'DeepSeek R1 · 1.5B 蒸馏版', family: 'DeepSeek', detail: 'DeepSeek-R1-Distill-Qwen-1.5B 本地蒸馏模型，并非官方云端旗舰。' },
  { id: 'deepseek-r1:8b', name: 'DeepSeek R1 · 8B 蒸馏版', family: 'DeepSeek', detail: 'DeepSeek-R1-0528-Qwen3-8B 本地蒸馏模型，并非官方云端旗舰。' },
  { id: 'hf.co/bartowski/moonshotai_Kimi-Linear-48B-A3B-Instruct-GGUF:Q4_K_M', name: 'Kimi Linear · 48B-A3B', family: 'Kimi', detail: 'Moonshot Kimi Linear 48B-A3B-Instruct；bartowski 社区 Q4_K_M GGUF。本地权重，不是 Kimi K2/K2.5 云端旗舰。' },
] as const;

export function isChatModel(id: unknown): id is string {
  return typeof id === 'string' && CHAT_MODELS.some((m) => m.id === id);
}
