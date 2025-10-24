// core/managers/MediaManager.ts
import { mediaDevices, MediaStream } from 'react-native-webrtc';
import type { RTCPeerConnection } from 'react-native-webrtc';
import { ErrorHandler } from '@react-native-openai-realtime/handlers/error';
import { SuccessHandler } from '@react-native-openai-realtime/handlers/success';
import type { RealtimeClientOptions } from '@react-native-openai-realtime/types';

export class MediaManager {
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private options: RealtimeClientOptions;
  private errorHandler: ErrorHandler;
  private successHandler: SuccessHandler;

  constructor(
    options: RealtimeClientOptions,
    errorHandler: ErrorHandler,
    successHandler: SuccessHandler
  ) {
    this.options = options;
    this.errorHandler = errorHandler;
    this.successHandler = successHandler;
  }

  async getUserMedia(): Promise<MediaStream> {
    try {
      const constraints = this.options.media?.getUserMedia!;
      const stream = await mediaDevices.getUserMedia(constraints);
      this.localStream = stream;
      this.successHandler.getUserMediaSetted(stream);
      this.successHandler.localStreamSetted(stream);
      return stream;
    } catch (e: any) {
      this.errorHandler.handle('get_user_media', e);
      throw e;
    }
  }

  addLocalStreamToPeerConnection(pc: RTCPeerConnection, stream: MediaStream) {
    stream.getTracks().forEach((track) => {
      try {
        pc.addTrack(track, stream);
        this.successHandler.localStreamAddedTrack(track);
      } catch (e: any) {
        this.errorHandler.handle('local_stream', e);
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
