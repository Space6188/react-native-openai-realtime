export interface SuccessCallbacks {
  onHangUpStarted?: () => void;
  onHangUpDone?: () => void;

  onPeerConnectionCreatingStarted?: () => void;
  onPeerConnectionCreated?: (pc: RTCPeerConnection) => void;
  onRTCPeerConnectionStateChange?: (
    state:
      | 'new'
      | 'connecting'
      | 'connected'
      | 'disconnected'
      | 'failed'
      | 'closed'
  ) => void;

  onGetUserMediaSetted?: (stream: MediaStream) => void;
  onLocalStreamSetted?: (stream: MediaStream) => void;
  onLocalStreamAddedTrack?: (track: MediaStreamTrack) => void;
  onLocalStreamRemovedTrack?: (track: MediaStreamTrack) => void;
  onRemoteStreamSetted?: (stream: MediaStream) => void;

  onDataChannelOpen?: (channel: any) => void;
  onDataChannelMessage?: (message: any) => void;
  onDataChannelClose?: () => void;

  onIceGatheringComplete?: () => void;
  onIceGatheringTimeout?: () => void;
  onIceGatheringStateChange?: (state: string) => void;

  onMicrophonePermissionGranted?: () => void;
  onMicrophonePermissionDenied?: () => void;

  onIOSTransceiverSetted?: () => void;
}

export interface BaseProps extends SuccessCallbacks {
  onError?: (event: ErrorEvent) => void;
  onSuccess?: (stage: string, data?: any) => void;
}
