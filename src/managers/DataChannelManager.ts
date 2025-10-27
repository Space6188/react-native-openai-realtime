import type { RTCPeerConnection } from 'react-native-webrtc';
import type RTCDataChannel from 'react-native-webrtc/lib/typescript/RTCDataChannel';
import type { RealtimeClientOptionsBeforePrune } from '@react-native-openai-realtime/types';
import {
  ErrorHandler,
  SuccessHandler,
} from '@react-native-openai-realtime/handlers';

type MessageHandler = (message: any) => void | Promise<void>;

export class DataChannelManager {
  private dc: RTCDataChannel | null = null;
  private options: RealtimeClientOptionsBeforePrune;
  private errorHandler: ErrorHandler;
  private successHandler: SuccessHandler;
  private onMessage?: MessageHandler;

  constructor(
    options: RealtimeClientOptionsBeforePrune,
    errorHandler: ErrorHandler,
    successHandler: SuccessHandler
  ) {
    this.options = options;
    this.errorHandler = errorHandler;
    this.successHandler = successHandler;
  }

  create(pc: RTCPeerConnection, onMessage: MessageHandler): RTCDataChannel {
    try {
      this.onMessage = onMessage;

      // @ts-ignore
      const dc = pc.createDataChannel(this.options.webrtc?.dataChannelLabel!, {
        ordered: true,
        maxRetransmits: 3,
      });

      this.dc = dc;
      this.setupListeners(dc);

      return dc;
    } catch (e: any) {
      this.errorHandler.handle('data_channel', e);
      throw e;
    }
  }

  private setupListeners(dc: RTCDataChannel) {
    // @ts-ignore
    dc.onopen = () => {
      try {
        this.successHandler.dataChannelOpen(dc);
        this.handleOpen();
      } catch (e: any) {
        this.errorHandler.handle('data_channel', e);
      }
    };

    // @ts-ignore
    dc.onmessage = async (message: any) => {
      try {
        const text =
          typeof message.data === 'string'
            ? message.data
            : String(message.data);
        let evt: any;

        try {
          evt = JSON.parse(text);
        } catch (err: any) {
          // пробрасываем исходную ошибку парсинга + полезный контекст
          this.errorHandler.handle(
            'data_channel',
            err instanceof Error ? err : new Error(String(err)),
            'warning',
            true,
            {
              raw:
                typeof text === 'string' && text.length > 2000
                  ? text.slice(0, 2000) + '…'
                  : text,
              hint: 'Failed to JSON.parse DataChannel message',
            }
          );
          return;
        }

        this.successHandler.dataChannelMessage(evt);

        if (this.onMessage) {
          await this.onMessage(evt);
        }
      } catch (err: any) {
        this.errorHandler.handle('data_channel', err);
      }
    };

    // @ts-ignore
    dc.onclose = () => this.successHandler.dataChannelClose();

    // @ts-ignore
    dc.onerror = (error: any) =>
      this.errorHandler.handle('data_channel', error, 'warning', true);
  }

  private handleOpen() {
    // session.update (auto)
    if (this.options.autoSessionUpdate && this.options.session) {
      this.send({
        type: 'session.update',
        session: this.options.session,
      });
    }

    // greet
    if (this.options.greet?.enabled !== false) {
      const response = {
        instructions:
          this.options.greet?.response?.instructions ?? 'Привет! Я на связи.',
        modalities: this.options.greet?.response?.modalities ?? [
          'audio',
          'text',
        ],
      };
      this.send({ type: 'response.create', response });
    }

    this.options.hooks?.onOpen?.(this.dc);
  }

  send(event: any): void {
    if (!this.dc || this.dc.readyState !== 'open') {
      throw new Error('DataChannel is not open');
    }

    this.dc.send(JSON.stringify(event));
  }

  getDataChannel() {
    return this.dc;
  }

  close() {
    if (this.dc) {
      try {
        this.dc.close();
        this.successHandler.dataChannelClose();
      } catch {}
      this.dc = null;
    }
  }

  isOpen() {
    return !!this.dc && this.dc.readyState === 'open';
  }
}
