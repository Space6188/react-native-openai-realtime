import { ErrorHandler } from '@react-native-openai-realtime/handlers/error';
import { SuccessHandler } from '@react-native-openai-realtime/handlers/success';
import type { RealtimeClientOptions } from '@react-native-openai-realtime/types';
import { RTCPeerConnection } from 'react-native-webrtc';

export class PeerConnectionManager {
  private pc: RTCPeerConnection | null = null;
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

  create(): RTCPeerConnection {
    try {
      this.successHandler.peerConnectionCreatingStarted();

      const pc = new RTCPeerConnection(
        this.options.webrtc?.configuration ??
          ({
            iceServers: this.options.webrtc?.iceServers,
            iceCandidatePoolSize:
              this.options.webrtc?.configuration?.iceCandidatePoolSize ?? 10,
          } as RTCConfiguration)
      );

      this.pc = pc;
      this.successHandler.peerConnectionCreated(pc);

      // Setup listeners
      this.setupListeners(pc);

      return pc;
    } catch (e: any) {
      this.errorHandler.handle('peer_connection', e);
      throw e;
    }
  }

  private setupListeners(pc: RTCPeerConnection) {
    // @ts-ignore
    pc.onconnectionstatechange = () =>
      this.successHandler.rtcPeerConnectionStateChange(pc.connectionState);

    // @ts-ignore
    pc.onicecandidate = (e: any) => {
      if (!e.candidate) {
        this.successHandler.iceGatheringComplete();
      }
    };

    // @ts-ignore
    pc.oniceconnectionstatechange = () =>
      this.successHandler.iceGatheringStateChange(pc.iceConnectionState);
  }

  async createOffer() {
    if (!this.pc) {
      throw new Error('PeerConnection not created');
    }

    try {
      const offerOptions = this.options.webrtc?.offerOptions as any;
      const offer = await this.pc.createOffer(offerOptions);
      return offer;
    } catch (e: any) {
      this.errorHandler.handle('create_offer', e);
      throw e;
    }
  }

  async setLocalDescription(offer: any) {
    if (!this.pc) {
      throw new Error('PeerConnection not created');
    }

    try {
      await this.pc.setLocalDescription(offer);
    } catch (e: any) {
      this.errorHandler.handle('set_local_description', e);
      throw e;
    }
  }

  async setRemoteDescription(answer: string) {
    if (!this.pc) {
      throw new Error('PeerConnection not created');
    }

    try {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: answer });
    } catch (e: any) {
      this.errorHandler.handle('set_remote_description', e);
      throw e;
    }
  }

  async waitForIceGathering(): Promise<void> {
    if (!this.pc) {
      throw new Error('PeerConnection not created');
    }

    return new Promise((resolve) => {
      try {
        if (this.pc!.iceGatheringState === 'complete') {
          this.successHandler.iceGatheringComplete();
          resolve();
          return;
        }

        const timeout = setTimeout(() => {
          this.successHandler.iceGatheringTimeout();
          // @ts-ignore
          this.pc!.onicegatheringstatechange = null;
          resolve();
        }, 2500);

        // @ts-ignore
        this.pc!.onicegatheringstatechange = () => {
          this.successHandler.iceGatheringStateChange(
            this.pc!.iceGatheringState
          );
          if (this.pc!.iceGatheringState === 'complete') {
            clearTimeout(timeout);
            // @ts-ignore
            this.pc!.onicegatheringstatechange = null;
            this.successHandler.iceGatheringComplete();
            resolve();
          }
        };
      } catch (e: any) {
        this.errorHandler.handle('ice_gathering', e, 'warning', true);
        resolve();
      }
    });
  }

  getPeerConnection() {
    return this.pc;
  }

  close() {
    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
      this.pc = null;
    }
  }

  isConnected() {
    return !!this.pc && this.pc.connectionState === 'connected';
  }
}
