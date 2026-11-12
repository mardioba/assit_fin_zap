// Erro de aplicação com status HTTP — tratado pelo middleware global.
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (msg: string, code?: string) =>
  new AppError(400, msg, code ?? "BAD_REQUEST");
export const unauthorized = (msg = "Não autenticado", code?: string) =>
  new AppError(401, msg, code ?? "UNAUTHORIZED");
export const forbidden = (msg = "Acesso negado", code?: string) =>
  new AppError(403, msg, code ?? "FORBIDDEN");
export const notFound = (msg = "Recurso não encontrado", code?: string) =>
  new AppError(404, msg, code ?? "NOT_FOUND");
export const conflict = (msg: string, code?: string) =>
  new AppError(409, msg, code ?? "CONFLICT");
