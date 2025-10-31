// __mocks__/react-native-webrtc.ts
export class MediaStreamTrack {
  enabled = true;
  readyState: 'live' | 'ended' = 'live';
  kind: 'audio' | 'video';
  constructor(kind: 'audio' | 'video') {
    this.kind = kind;
  }
  stop() {
    this.readyState = 'ended';
  }
}

export class MediaStream {
  private tracks: MediaStreamTrack[] = [];
  addTrack(t: MediaStreamTrack) {
    this.tracks.push(t);
  }
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
}

export const mediaDevices = {
  getUserMedia: async (constraints: any) => {
    const stream = new MediaStream();
    if (constraints?.audio) {
      stream.addTrack(new MediaStreamTrack('audio'));
    }
    if (constraints?.video) {
      stream.addTrack(new MediaStreamTrack('video'));
    }
    return stream;
  },
};

class MockRTCDataChannel {
  label: string;
  readyState: 'open' | 'closed' = 'open';
  onopen?: () => void;
  onmessage?: (ev: any) => void;
  onclose?: () => void;
  onerror?: (e: any) => void;

  constructor(label: string) {
    this.label = label;
    setTimeout(() => this.onopen?.(), 0);
  }
  send(_data: any) {}
  close() {
    this.readyState = 'closed';
    this.onclose?.();
  }
}

export class RTCPeerConnection {
  connectionState:
    | 'new'
    | 'connecting'
    | 'connected'
    | 'disconnected'
    | 'failed'
    | 'closed' = 'new';
  iceGatheringState: 'new' | 'gathering' | 'complete' = 'complete';
  iceConnectionState: string = 'completed';
  localDescription: any = null;
  remoteDescription: any = null;

  onconnectionstatechange?: () => void;
  onicecandidate?: (e: any) => void;
  oniceconnectionstatechange?: () => void;
  ontrack?: (e: any) => void;

  private _senders: any[] = [];

  createDataChannel(label: string, _init?: any) {
    if (!label || typeof label !== 'string') {
      throw new TypeError('Invalid label');
    }
    return new MockRTCDataChannel(label) as any;
  }

  createOffer(_options?: any) {
    this.connectionState = 'connecting';
    this.onconnectionstatechange?.();
    // Сообщим об окончании ICE
    setTimeout(() => this.onicecandidate?.({ candidate: null }), 0);
    return Promise.resolve({
      type: 'offer',
      sdp: 'v=0\no=- 0 0 IN IP4 127.0.0.1\ns=-',
    });
  }

  setLocalDescription(desc: any) {
    this.localDescription = desc;
    return Promise.resolve();
  }

  setRemoteDescription(desc: any) {
    this.remoteDescription = desc;
    this.connectionState = 'connected';
    this.onconnectionstatechange?.();
    return Promise.resolve();
  }

  addTrack(track: MediaStreamTrack, _stream: MediaStream) {
    this._senders.push({
      track,
      getStats: async () =>
        new Map([
          [
            'track',
            {
              type: 'track',
              audioLevel: 0.12,
              totalAudioEnergy: 1,
              totalSamplesDuration: 1,
            },
          ],
          ['media-source', { type: 'media-source', audioLevel: 0.2 }],
        ]),
    });
  }

  getSenders() {
    return this._senders;
  }

  close() {
    this.connectionState = 'closed';
    this.onconnectionstatechange?.();
  }
}

export default {
  RTCPeerConnection,
  mediaDevices,
  MediaStream,
  MediaStreamTrack,
};
