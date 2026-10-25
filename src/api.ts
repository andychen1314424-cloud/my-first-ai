export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('无法连接本地应用。请确认启动终端仍在运行，然后重试。');
  }
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '操作失败，请重试。');
  return value as T;
}
