// В файле: MediaManager.ts
// Замените класс целиком:

import { mediaDevices, MediaStream } from 'react-native-webrtc';
import type { RTCPeerConnection } from 'react-native-webrtc';
import type { RealtimeClientOptionsBeforePrune } from '@react-native-openai-realtime/types';
import {
  ErrorHandler,
  SuccessHandler,
} from '@react-native-openai-realtime/handlers';

export class MediaManager {
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private options: RealtimeClientOptionsBeforePrune;
  private errorHandler: ErrorHandler;
  private successHandler: SuccessHandler;

  constructor(
    options: RealtimeClientOptionsBeforePrune,
    errorHandler: ErrorHandler,
    successHandler: SuccessHandler
  ) {
    this.options = options;
    this.errorHandler = errorHandler;
    this.successHandler = successHandler;
  }

  // ✅ ИСПРАВЛЕНО: Не вызываем errorHandler внутри
  async getUserMedia(): Promise<MediaStream> {
    // Сначала останавливаем старый stream если есть
    this.stopLocalStream();

    const constraints = this.options.media?.getUserMedia!;
    const stream = await mediaDevices.getUserMedia(constraints);
    this.localStream = stream;
    this.successHandler.getUserMediaSetted(stream);
    this.successHandler.localStreamSetted(stream);
    return stream;
  }

  addLocalStreamToPeerConnection(pc: RTCPeerConnection, stream: MediaStream) {
    // КРИТИЧНО: Проверяем, что PeerConnection не закрыт
    if (!pc || pc.connectionState === 'closed') {
      const error = new Error('Cannot add tracks: PeerConnection is closed');
      this.errorHandler.handle('local_stream', error, 'critical', false);
      throw error;
    }

    stream.getTracks().forEach((track) => {
      try {
        // Дополнительная проверка перед добавлением каждого трека
        if (pc.connectionState === 'closed') {
          throw new Error('PeerConnection closed during track addition');
        }

        pc.addTrack(track, stream);
        this.successHandler.localStreamAddedTrack(track);
      } catch (e: any) {
        this.errorHandler.handle('local_stream', e);
        throw e; // Пробрасываем ошибку, чтобы прервать connect()
      }
    });
  }

  setupRemoteStream(pc: RTCPeerConnection) {
    // @ts-ignore
    pc.ontrack = (event: any) => {
      try {
        if (!this.remoteStream) {
          this.remoteStream = new MediaStream();
        }
        this.remoteStream.addTrack(event.track);
        this.successHandler.remoteStreamSetted(this.remoteStream);
      } catch (e: any) {
        this.errorHandler.handle('remote_stream', e);
      }
    };
  }

  getLocalStream() {
    return this.localStream;
  }

  getRemoteStream() {
    return this.remoteStream;
  }

  stopLocalStream() {
    if (this.localStream) {
      try {
        this.localStream.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {}
        });
      } catch {}
      this.localStream = null;
    }
  }

  cleanup() {
    this.stopLocalStream();
    this.remoteStream = null;
  }
}
