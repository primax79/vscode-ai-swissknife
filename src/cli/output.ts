import type { ErrorCode, CliErrorResponse } from './types';

export class CliError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'CliError';
    this.code = code;
  }
}

export function formatError(code: ErrorCode, message: string): CliErrorResponse {
  return {
    error: {
      code,
      message,
    },
  };
}

export function emit(data: unknown): void {
  const jsonStr = JSON.stringify(data, null, 2);
  process.stdout.write(jsonStr + '\n');
}

export function fail(code: ErrorCode, message: string): never {
  const errPayload = formatError(code, message);
  process.stdout.write(JSON.stringify(errPayload, null, 2) + '\n');
  process.exit(1);
}
