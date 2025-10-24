// core/managers/OpenAIApiClient.ts
import { ErrorHandler } from '@react-native-openai-realtime/handlers/error';

export class OpenAIApiClient {
  private errorHandler: ErrorHandler;

  constructor(errorHandler: ErrorHandler) {
    this.errorHandler = errorHandler;
  }

  async postSDP(localSdp: string, ephemeralKey: string): Promise<string> {
    try {
      const resp = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp',
          'OpenAI-Beta': 'realtime=v1',
        },
        body: localSdp || '',
      });

      const text = await resp.text();

      if (!resp.ok) {
        this.errorHandler.handle(
          'openai_api',
          new Error(`OpenAI ${resp.status}: ${text.slice(0, 200)}`)
        );
        throw new Error(text);
      }

      if (!text.startsWith('v=')) {
        this.errorHandler.handle(
          'openai_api',
          new Error(`Invalid SDP from OpenAI: ${text.slice(0, 100)}`)
        );
        throw new Error('Invalid SDP');
      }

      return text;
    } catch (e: any) {
      this.errorHandler.handle('openai_api', e);
      throw e;
    }
  }
}
