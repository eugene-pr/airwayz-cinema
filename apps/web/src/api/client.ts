// Every fetch in apps/web goes through here. Errors keep the wire's
// { error: { code, message } } so callers can branch on status and code.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => undefined);
  if (!res.ok) {
    const error = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(res.status, error?.code ?? "INTERNAL", error?.message ?? `${method} ${path} failed`);
  }
  return json as T;
}
