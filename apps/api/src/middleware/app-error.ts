// The one error type services throw. No Express here — services import it.
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new AppError(400, "BAD_REQUEST", message, details);

export const forbidden = (message = "Forbidden") => new AppError(403, "FORBIDDEN", message);

export const notFound = (message = "Not found") => new AppError(404, "NOT_FOUND", message);

export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(409, code, message, details);
