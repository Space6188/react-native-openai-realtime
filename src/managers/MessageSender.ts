import type {
  ResponseCreateParams,
  ResponseCreateStrict,
  RealtimeClientOptionsBeforePrune,
} from '@react-native-openai-realtime/types';
import { ErrorHandler } from '@react-native-openai-realtime/handlers';
import { DataChannelManager } from './DataChannelManager';

export class MessageSender {
  private dataChannelManager: DataChannelManager;
  private options: RealtimeClientOptionsBeforePrune;
  private errorHandler: ErrorHandler;

  constructor(
    dataChannelManager: DataChannelManager,
    options: RealtimeClientOptionsBeforePrune,
    errorHandler: ErrorHandler
  ) {
    this.dataChannelManager = dataChannelManager;
    this.options = options;
    this.errorHandler = errorHandler;
  }

  async sendRaw(event: any): Promise<void> {
    try {
      if (!this.dataChannelManager.isOpen()) {
        throw new Error('DataChannel is not open');
      }

      // Outgoing middleware
      if (this.options.middleware?.outgoing) {
        for (const mw of this.options.middleware.outgoing) {
          const res = await Promise.resolve(mw(event));

          if (res === 'stop') {
            return;
          }
          if (res && typeof res === 'object') {
            event = res;
          }
        }
      }

      if (!this.dataChannelManager.isOpen()) {
        throw new Error('DataChannel is not open');
      }

      this.dataChannelManager.send(event);
    } catch (e: any) {
      this.errorHandler.handle('data_channel', e, 'warning', true, { event });
    }
  }
  sendResponse(): void;
  sendResponse(params: ResponseCreateParams): void;
  sendResponse(params?: any): void {
    const response = params ?? {};
    this.sendRaw({ type: 'response.create', response });
  }
  sendResponseStrict(options: ResponseCreateStrict) {
    this.sendRaw({ type: 'response.create', response: options });
  }

  updateSession(patch: Partial<any>) {
    this.sendRaw({ type: 'session.update', session: patch });
  }

  sendToolOutput(call_id: string, output: any) {
    this.sendRaw({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id,
        output: JSON.stringify(output),
      },
    });
  }
}
