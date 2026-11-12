export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Options = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
};

/**
 * Cliente de API: usa cookies httpOnly (credentials: include).
 * Não guarda token em localStorage (mitigação de XSS).
 */
export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method ?? "GET",
    credentials: "include",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) {
      window.location.assign("/login");
    }
    throw new ApiError(
      res.status,
      (data as { message?: string }).message ?? "Erro inesperado",
      (data as { code?: string }).code,
    );
  }

  return data as T;
}
