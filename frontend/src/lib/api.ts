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

/**
 * Baixa um arquivo autenticado (CSV/PDF) via cookies httpOnly.
 * Retorna o nome sugerido pelo servidor (Content-Disposition).
 */
export async function downloadFile(path: string): Promise<void> {
  const res = await fetch(`/api${path}`, { credentials: "include" });
  if (!res.ok) {
    if (res.status === 401) window.location.assign("/login");
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(res.status, data.message ?? "Falha ao baixar arquivo");
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ?? "arquivo";

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
