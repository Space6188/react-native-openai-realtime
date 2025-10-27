// src/handlers/error.ts
import type {
  ErrorEvent,
  ErrorStage,
  ErrorSeverity,
} from '@react-native-openai-realtime/types';

export class ErrorHandler {
  private onError?: (event: ErrorEvent) => void;
  private logger?: { error?: (...a: any[]) => void };

  constructor(
    onError?: (event: ErrorEvent) => void,
    logger?: { error?: (...a: any[]) => void }
  ) {
    this.onError = onError;
    this.logger = logger;
  }

  handle(
    stage: ErrorStage,
    error: Error | string,
    severity: ErrorSeverity = 'critical',
    recoverable: boolean = false,
    context?: Record<string, any>
  ) {
    const errorEvent: ErrorEvent = {
      stage,
      error: error instanceof Error ? error : new Error(String(error)),
      severity,
      recoverable,
      timestamp: Date.now(),
      context,
    };

    (this.logger?.error ?? console.error)(
      `[${stage}] ${severity}:`,
      errorEvent.error,
      context
    );

    if (this.onError) {
      this.onError(errorEvent);
    }
    return errorEvent;
  }
}
