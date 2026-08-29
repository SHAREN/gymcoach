export class McpOperationError extends Error {
  readonly errorCode: string;
  readonly field?: string;
  readonly input?: unknown;
  readonly details?: Record<string, unknown>;

  constructor(
    errorCode: string,
    message: string,
    options?: { field?: string; input?: unknown; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = 'McpOperationError';
    this.errorCode = errorCode;
    this.field = options?.field;
    this.input = options?.input;
    this.details = options?.details;
  }

  toIssue() {
    return {
      errorCode: this.errorCode,
      message: this.message,
      ...(this.field ? { field: this.field } : {}),
      ...(this.input !== undefined ? { input: this.input } : {}),
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function asMcpIssue(error: unknown) {
  if (error instanceof McpOperationError) return error.toIssue();
  return {
    errorCode: 'INTERNAL_OPERATION_ERROR',
    message: error instanceof Error ? error.message : 'Unknown operation error.',
  };
}
