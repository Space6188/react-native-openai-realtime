import type { SuccessCallbacks } from '@react-native-openai-realtime/types';
import type { RTCPeerConnection, MediaStreamTrack } from 'react-native-webrtc';
import { MediaStream } from 'react-native-webrtc';
import type RTCDataChannel from 'react-native-webrtc/lib/typescript/RTCDataChannel';

export class SuccessHandler {
  private callbacks: SuccessCallbacks;
  private onSuccess?: (stage: string, data?: any) => void;

  constructor(
    callbacks: SuccessCallbacks = {},
    onSuccess?: (stage: string, data?: any) => void
  ) {
    this.callbacks = callbacks;
    this.onSuccess = onSuccess;
  }

  hangUpStarted() {
    this.onSuccess?.('hang_up_started');
    this.callbacks.onHangUpStarted?.();
  }
  hangUpDone() {
    this.onSuccess?.('hang_up_done');
    this.callbacks.onHangUpDone?.();
  }

  peerConnectionCreatingStarted() {
    this.onSuccess?.('peer_connection_creating_started');
    this.callbacks.onPeerConnectionCreatingStarted?.();
  }
  peerConnectionCreated(pc: RTCPeerConnection) {
    this.onSuccess?.('peer_connection_created', { pc });
    this.callbacks.onPeerConnectionCreated?.(pc as any);
  }

  rtcPeerConnectionStateChange(
    state:
      | 'new'
      | 'connecting'
      | 'connected'
      | 'disconnected'
      | 'failed'
      | 'closed'
  ) {
    this.onSuccess?.('rtc_peer_connection_state_change', { state });
    this.callbacks.onRTCPeerConnectionStateChange?.(state);
  }

  getUserMediaSetted(stream: MediaStream) {
    this.onSuccess?.('get_user_media_setted', { stream });
    this.callbacks.onGetUserMediaSetted?.(stream as any);
  }
  localStreamSetted(stream: MediaStream) {
    this.onSuccess?.('local_stream_setted', { stream });
    this.callbacks.onLocalStreamSetted?.(stream as any);
  }
  localStreamAddedTrack(track: MediaStreamTrack) {
    this.onSuccess?.('local_stream_added_track', { track });
    this.callbacks.onLocalStreamAddedTrack?.(track as any);
  }
  localStreamRemovedTrack(track: MediaStreamTrack) {
    this.onSuccess?.('local_stream_removed_track', { track });
    this.callbacks.onLocalStreamRemovedTrack?.(track as any);
  }
  remoteStreamSetted(stream: MediaStream) {
    this.onSuccess?.('remote_stream_setted', { stream });
    this.callbacks.onRemoteStreamSetted?.(stream as any);
  }

  dataChannelOpen(channel: RTCDataChannel) {
    this.onSuccess?.('data_channel_open', { channel });
    this.callbacks.onDataChannelOpen?.(channel);
  }
  dataChannelMessage(message: any) {
    this.onSuccess?.('data_channel_message', { message });
    this.callbacks.onDataChannelMessage?.(message);
  }
  dataChannelClose() {
    this.onSuccess?.('data_channel_close');
    this.callbacks.onDataChannelClose?.();
  }

  iceGatheringComplete() {
    this.onSuccess?.('ice_gathering_complete');
    this.callbacks.onIceGatheringComplete?.();
  }
  iceGatheringTimeout() {
    this.onSuccess?.('ice_gathering_timeout');
    this.callbacks.onIceGatheringTimeout?.();
  }
  iceGatheringStateChange(state: string) {
    this.onSuccess?.('ice_gathering_state_change', { state });
    this.callbacks.onIceGatheringStateChange?.(state);
  }

  microphonePermissionGranted() {
    this.onSuccess?.('microphone_permission_granted');
    this.callbacks.onMicrophonePermissionGranted?.();
  }
  microphonePermissionDenied() {
    this.onSuccess?.('microphone_permission_denied');
    this.callbacks.onMicrophonePermissionDenied?.();
  }

  iosTransceiverSetted() {
    this.onSuccess?.('ios_transceiver_setted');
    this.callbacks.onIOSTransceiverSetted?.();
  }
}
