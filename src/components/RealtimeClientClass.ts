import { ChatStore } from '@react-native-openai-realtime/adapters';
import {
  ErrorHandler,
  SuccessHandler,
} from '@react-native-openai-realtime/handlers';
import { applyDefaults } from '@react-native-openai-realtime/helpers';
import {
  PeerConnectionManager,
  MediaManager,
  DataChannelManager,
  MessageSender,
  EventRouter,
  OpenAIApiClient,
} from '@react-native-openai-realtime/managers';
import type {
  RealtimeClientOptionsBeforePrune,
  ResponseCreateParams,
  ResponseCreateStrict,
  TokenProvider,
  RealtimeEventMap,
  RealtimeEventListener,
} from '@react-native-openai-realtime/types';

type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';
type ConnectionListener = (state: ConnectionState) => void;

export class RealtimeClientClass {
  private options: RealtimeClientOptionsBeforePrune;

  private connectionState: ConnectionState = 'idle';
  private connectionListeners = new Set<ConnectionListener>();

  private connecting = false;
  private disconnecting = false;

  private peerConnectionManager: PeerConnectionManager;
  private mediaManager: MediaManager;
  private dataChannelManager: DataChannelManager;
  private messageSender: MessageSender;
  private eventRouter: EventRouter;
  private apiClient: OpenAIApiClient;

  private errorHandler: ErrorHandler;
  private successHandler: SuccessHandler;

  private chatStore?: ChatStore;
  private chatWired = false;

  private connectSeq = 0;

  // Добавляем отслеживание состояния DataChannel
  private dataChannelReady = false;
  private peerConnectionConnected = false;

  constructor(
    userOptions: RealtimeClientOptionsBeforePrune,
    success?: SuccessHandler,
    error?: ErrorHandler
  ) {
    this.options = applyDefaults(userOptions);

    this.errorHandler =
      error ??
      new ErrorHandler(
        (event) => {
          if (event.severity === 'critical') {
            this.setConnectionState('error');
          }
          this.options.hooks?.onError?.(event);
        },
        { error: this.options.logger?.error }
      );

    const callbacks = {
      onPeerConnectionCreatingStarted: () => {
        this.peerConnectionConnected = false;
        this.dataChannelReady = false;
        this.setConnectionState('connecting');
      },
      onRTCPeerConnectionStateChange: (
        state:
          | 'new'
          | 'connecting'
          | 'connected'
          | 'disconnected'
          | 'failed'
          | 'closed'
      ) => {
        if (state === 'connected') {
          this.peerConnectionConnected = true;
          this.updateConnectionState();
        } else if (state === 'connecting' || state === 'new') {
          this.peerConnectionConnected = false;
          this.setConnectionState('connecting');
        } else if (state === 'failed') {
          this.peerConnectionConnected = false;
          this.dataChannelReady = false;
          this.setConnectionState('error');
        } else if (state === 'disconnected' || state === 'closed') {
          this.peerConnectionConnected = false;
          this.dataChannelReady = false;
          this.setConnectionState('disconnected');
        }
      },
      onDataChannelOpen: () => {
        this.dataChannelReady = true;
        this.updateConnectionState();
      },
      onDataChannelClose: () => {
        this.dataChannelReady = false;
        this.setConnectionState('disconnected');
      },
    };

    this.successHandler =
      success ?? new SuccessHandler(callbacks as any, undefined);

    this.peerConnectionManager = new PeerConnectionManager(
      this.options,
      this.errorHandler,
      this.successHandler
    );
    this.mediaManager = new MediaManager(
      this.options,
      this.errorHandler,
      this.successHandler
    );
    this.dataChannelManager = new DataChannelManager(
      this.options,
      this.errorHandler,
      this.successHandler
    );
    this.messageSender = new MessageSender(
      this.dataChannelManager,
      this.options,
      this.errorHandler
    );
    this.eventRouter = new EventRouter(
      this.options,
      this.sendRaw.bind(this),
      this
    );
    this.apiClient = new OpenAIApiClient(this.errorHandler);

    if (this.options.chat?.enabled !== false) {
      this.chatStore = new ChatStore({
        isMeaningfulText:
          this.options.chat?.isMeaningfulText ??
          this.options.policy?.isMeaningfulText,
        userAddOnDelta: this.options.chat?.userAddOnDelta,
        userPlaceholderOnStart: this.options.chat?.userPlaceholderOnStart,
        assistantAddOnDelta: this.options.chat?.assistantAddOnDelta,
        assistantPlaceholderOnStart:
          this.options.chat?.assistantPlaceholderOnStart,
      });
      this.wireChatStore();
    }
  }

  /**
   * Обновляет состояние подключения на основе состояния PeerConnection и DataChannel
   * Соединение считается полностью установленным только когда оба готовы
   */
  private updateConnectionState() {
    // Проверяем также readyState DataChannel для надежности
    const dc = this.dataChannelManager.getDataChannel();
    const dcActuallyOpen = dc && dc.readyState === 'open';

    if (
      this.peerConnectionConnected &&
      this.dataChannelReady &&
      dcActuallyOpen
    ) {
      this.setConnectionState('connected');
      this.options.logger?.info?.(
        '[RealtimeClient] ✅ Fully connected (PC + DC ready)'
      );
    } else if (this.peerConnectionConnected || this.dataChannelReady) {
      // Хотя бы одно из соединений установлено, но не оба
      this.options.logger?.debug?.(
        `[RealtimeClient] Partial connection (PC: ${this.peerConnectionConnected}, DC: ${this.dataChannelReady}, DC state: ${dc?.readyState})`
      );
      // Остаемся в connecting, пока не будут готовы оба
      if (this.connectionState !== 'connected') {
        this.setConnectionState('connecting');
      }
    }
  }

  setTokenProvider(tp: TokenProvider) {
    if (typeof tp !== 'function')
      throw new Error('setTokenProvider: invalid tokenProvider');
    this.options.tokenProvider = tp;
  }

  private setConnectionState(state: ConnectionState) {
    if (this.connectionState !== state) {
      this.connectionState = state;
      this.options.logger?.debug?.(`[RealtimeClient] Status changed: ${state}`);
      this.connectionListeners.forEach((listener) => listener(state));
    }
  }

  public getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  public getStatus() {
    return this.connectionState;
  }

  /**
   * Возвращает true только если и PeerConnection и DataChannel полностью готовы
   */
  public isFullyConnected(): boolean {
    const dc = this.dataChannelManager.getDataChannel();
    return (
      this.connectionState === 'connected' &&
      this.peerConnectionConnected &&
      this.dataChannelReady &&
      !!dc &&
      dc.readyState === 'open'
    );
  }

  public onConnectionStateChange(listener: ConnectionListener) {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  private wireChatStore(force = false) {
    if (!this.chatStore) return;
    if (this.chatWired && !force) return;

    this.on('user:item_started', ({ itemId }) =>
      this.chatStore!.startUser(itemId)
    );
    this.on('assistant:response_started', ({ responseId }) =>
      this.chatStore!.startAssistant(responseId)
    );
    this.on('user:delta', ({ itemId, delta }) =>
      this.chatStore!.putDelta('user', itemId, delta)
    );
    this.on('user:completed', ({ itemId, transcript }) =>
      this.chatStore!.finalize('user', itemId, 'done', transcript)
    );
    this.on('user:failed', ({ itemId }) =>
      this.chatStore!.finalize('user', itemId, 'done')
    );
    this.on('user:truncated', ({ itemId }) =>
      this.chatStore!.finalize('user', itemId, 'done')
    );
    this.on('assistant:delta', ({ responseId, delta }) =>
      this.chatStore!.putDelta('assistant', responseId, delta)
    );
    this.on('assistant:completed', ({ responseId, status }) =>
      this.chatStore!.finalize('assistant', responseId, status)
    );

    this.chatWired = true;
  }

  on<K extends keyof RealtimeEventMap>(
    type: K,
    handler: RealtimeEventListener<K>
  ): () => void;
  on(type: string, handler: (payload: any) => void): () => void;
  on(type: string, handler: (payload: any) => void): () => void {
    return this.eventRouter.on(type, handler);
  }

  private preConnectCleanup() {
    this.peerConnectionConnected = false;
    this.dataChannelReady = false;

    try {
      this.dataChannelManager.close();
    } catch {}
    try {
      this.peerConnectionManager.close();
    } catch {}
    try {
      this.mediaManager.cleanup();
    } catch {}
  }

  private makeAbortError() {
    const err: any = new Error('connect aborted');
    err.name = 'AbortError';
    err.__ABORT__ = true;
    return err;
  }

  private assertNotAborted(mySeq: number) {
    if (mySeq !== this.connectSeq || this.disconnecting) {
      throw this.makeAbortError();
    }
  }

  async enableMicrophone() {
    try {
      const pc = this.peerConnectionManager.getPeerConnection();
      if (!pc) throw new Error('PeerConnection not created');

      const stream = await this.mediaManager.getUserMedia();
      this.mediaManager.addLocalStreamToPeerConnection(pc, stream);
      try {
        const txs = (pc as any).getTransceivers?.() || [];
        const audioTx = txs.find(
          (t: any) =>
            t?.receiver?.track?.kind === 'audio' ||
            t?.sender?.track?.kind === 'audio'
        );
        const track = stream.getAudioTracks?.()[0];
        if (audioTx?.sender && track) {
          await audioTx.sender.replaceTrack(track);
          if (typeof audioTx.setDirection === 'function') {
            audioTx.setDirection('sendrecv');
          } else {
            // @ts-ignore
            audioTx.direction = 'sendrecv';
          }
        }
      } catch {}

      const offer = await this.peerConnectionManager.createOffer();
      await this.peerConnectionManager.setLocalDescription(offer);
      await this.peerConnectionManager.waitForIceGathering();

      const ephemeralKey = await this.options.tokenProvider();
      const answer = await this.apiClient.postSDP(offer.sdp, ephemeralKey);
      await this.peerConnectionManager.setRemoteDescription(answer);

      this.successHandler.microphonePermissionGranted?.();
      this.options.logger?.info?.(
        '[RealtimeClient] 🎤 Microphone enabled & renegotiated'
      );
    } catch (e: any) {
      this.errorHandler.handle('get_user_media', e, 'critical', false);
      throw e;
    }
  }

  public async disableMicrophone() {
    try {
      const pc = this.peerConnectionManager.getPeerConnection();
      if (!pc) throw new Error('PeerConnection not created');

      const local = this.mediaManager.getLocalStream();
      if (local?.getAudioTracks) {
        local.getAudioTracks().forEach((t: any) => {
          try {
            t.stop();
          } catch {}
        });
      }

      try {
        const txs = (pc as any).getTransceivers?.() || [];
        const audioTx = txs.find(
          (t: any) =>
            t?.sender?.track?.kind === 'audio' ||
            t?.receiver?.track?.kind === 'audio'
        );
        if (audioTx?.sender) {
          await audioTx.sender.replaceTrack(null);
        }
        if (audioTx) {
          if (typeof audioTx.setDirection === 'function') {
            audioTx.setDirection('recvonly');
          } else {
            // @ts-ignore
            audioTx.direction = 'recvonly';
          }
        }
      } catch {}

      const offer = await this.peerConnectionManager.createOffer();
      await this.peerConnectionManager.setLocalDescription(offer);
      await this.peerConnectionManager.waitForIceGathering();
      const ephemeralKey = await this.options.tokenProvider();
      const answer = await this.apiClient.postSDP(offer.sdp, ephemeralKey);
      await this.peerConnectionManager.setRemoteDescription(answer);

      this.mediaManager.stopLocalStream();

      this.options.logger?.info?.(
        '[RealtimeClient] 🔇 Microphone disabled & renegotiated'
      );
    } catch (e: any) {
      this.errorHandler.handle('local_stream', e, 'warning', true);
      throw e;
    }
  }

  async connect() {
    if (this.connecting) {
      this.errorHandler.handle(
        'init_peer_connection',
        new Error('connect() called while connecting'),
        'warning',
        true
      );
      return;
    }
    this.connecting = true;
    const mySeq = ++this.connectSeq;

    try {
      this.setConnectionState('connecting');
      this.preConnectCleanup();

      if (this.chatStore && !this.chatWired) {
        this.wireChatStore(true);
      }

      this.assertNotAborted(mySeq);

      let ephemeralKey: string;
      try {
        const fn = this.options.tokenProvider;
        if (typeof fn !== 'function')
          throw new Error('tokenProvider is not set');
        ephemeralKey = await fn();
        if (!ephemeralKey) throw new Error('Empty ephemeral token');
      } catch (e: any) {
        this.setConnectionState('error');
        this.errorHandler.handle('fetch_token', e, 'critical', false);
        throw e;
      }

      this.assertNotAborted(mySeq);

      const wantsAudioModality =
        Array.isArray(this.options.session?.modalities) &&
        this.options.session!.modalities!.includes('audio');
      const wantsTurnDetection = !!this.options.session?.turn_detection;
      const mustCaptureMic = wantsAudioModality || wantsTurnDetection;

      const shouldTryMic =
        mustCaptureMic || this.options.allowConnectWithoutMic === false;

      let localStream: any = null;
      let needsRecvOnlyTransceiver = false;

      if (shouldTryMic) {
        try {
          localStream = await this.mediaManager.getUserMedia();
          this.assertNotAborted(mySeq);
          this.options.logger?.info?.(
            '[RealtimeClient] ✅ Microphone permission granted'
          );
        } catch (e: any) {
          this.options.logger?.warn?.(
            '[RealtimeClient] ⚠️ Microphone permission denied:',
            e.message || e
          );

          if (this.options.allowConnectWithoutMic === false) {
            this.errorHandler.handle('get_user_media', e, 'critical', false);
            throw e;
          }

          this.errorHandler.handle('get_user_media', e, 'warning', true, {
            reason: 'Will use recvonly transceiver as fallback',
            allowConnectWithoutMic: true,
          });

          needsRecvOnlyTransceiver = true;
        }
      } else {
        this.options.logger?.info?.(
          '[RealtimeClient] 📝 Text mode - no microphone needed'
        );
        needsRecvOnlyTransceiver = true;
      }

      this.assertNotAborted(mySeq);

      const pc = this.peerConnectionManager.create();
      this.assertNotAborted(mySeq);

      this.mediaManager.setupRemoteStream(pc);

      if (localStream) {
        this.mediaManager.addLocalStreamToPeerConnection(pc, localStream);
        this.options.logger?.info?.(
          '[RealtimeClient] 🎤 Local microphone stream added to PeerConnection'
        );
      } else if (needsRecvOnlyTransceiver) {
        try {
          // @ts-ignore
          if (typeof pc.addTransceiver === 'function') {
            // @ts-ignore
            pc.addTransceiver('audio', { direction: 'recvonly' });
            this.successHandler.iosTransceiverSetted?.();
            this.options.logger?.info?.(
              '[RealtimeClient] 🔇 Added recvonly audio transceiver (no mic)'
            );
          } else {
            this.options.logger?.warn?.(
              '[RealtimeClient] ⚠️ addTransceiver not available, continuing anyway'
            );
          }
        } catch (e2: any) {
          this.errorHandler.handle('ios_transceiver', e2, 'info', true);
          this.options.logger?.warn?.(
            '[RealtimeClient] ⚠️ Could not add transceiver:',
            e2.message || e2
          );
        }
      }

      this.assertNotAborted(mySeq);

      this.dataChannelManager.create(pc, async (evt) => {
        await this.eventRouter.processIncomingMessage(evt);
      });

      const offer = await this.peerConnectionManager.createOffer();
      await this.peerConnectionManager.setLocalDescription(offer);
      await this.peerConnectionManager.waitForIceGathering();

      this.assertNotAborted(mySeq);

      const answer = await this.apiClient.postSDP(offer.sdp, ephemeralKey);
      await this.peerConnectionManager.setRemoteDescription(answer);

      this.options.logger?.info?.(
        '[RealtimeClient] 🎉 Connection process completed'
      );
    } catch (e: any) {
      if (e?.__ABORT__ || e?.name === 'AbortError') {
        this.options.logger?.info?.('[RealtimeClient] 🛑 Connection aborted');
        if (this.getStatus() !== 'disconnected') {
          this.setConnectionState('disconnected');
        }
      } else {
        this.options.logger?.error?.(
          '[RealtimeClient] ❌ Connection failed:',
          e.message || e
        );
        if (this.getStatus() !== 'error') {
          this.setConnectionState('error');
          this.errorHandler.handle('init_peer_connection', e);
        }
        throw e;
      }
    } finally {
      this.connecting = false;
    }
  }

  async disconnect() {
    if (this.disconnecting) return;
    this.disconnecting = true;

    this.connectSeq++;

    try {
      this.successHandler.hangUpStarted();

      try {
        this.dataChannelManager.close();
      } catch {}
      try {
        this.mediaManager.cleanup();
      } catch {}
      try {
        this.peerConnectionManager.close();
      } catch {}
      try {
        this.eventRouter.cleanup();
      } catch {}

      this.peerConnectionConnected = false;
      this.dataChannelReady = false;
      this.chatWired = false;

      if (
        this.options.deleteChatHistoryOnDisconnect !== false &&
        this.chatStore
      ) {
        try {
          this.options.logger?.debug?.(
            '[RealtimeClient] Destroying chat history'
          );
          this.chatStore.destroy();
        } catch {}
      } else {
        try {
          this.options.logger?.debug?.(
            '[RealtimeClient] Preserving chat history on disconnect'
          );
        } catch {}
      }

      this.setConnectionState('disconnected');
      this.successHandler.hangUpDone();
    } catch (e: any) {
      this.errorHandler.handle('hangup', e, 'warning', true);
    } finally {
      this.disconnecting = false;
    }
  }

  async sendRaw(event: any): Promise<void> {
    return this.messageSender.sendRaw(event);
  }

  sendResponse(): void;
  sendResponse(params: ResponseCreateParams): void;
  sendResponse(params?: any): void {
    this.messageSender.sendResponse(params);
  }

  sendResponseStrict(options: ResponseCreateStrict) {
    this.messageSender.sendResponseStrict(options);
  }

  updateSession(patch: Partial<any>) {
    this.messageSender.updateSession(patch);
  }

  sendToolOutput(call_id: string, output: any) {
    this.messageSender.sendToolOutput(call_id, output);
  }

  getPeerConnection() {
    return this.peerConnectionManager.getPeerConnection();
  }

  getDataChannel() {
    return this.dataChannelManager.getDataChannel();
  }

  getLocalStream() {
    return this.mediaManager.getLocalStream();
  }

  getRemoteStream() {
    return this.mediaManager.getRemoteStream();
  }

  getChat() {
    return this.chatStore?.get() ?? [];
  }

  public clearChatHistory() {
    if (this.chatStore) {
      this.options.logger?.info?.(
        '[RealtimeClient] Manually clearing chat history'
      );
      this.chatStore.destroy();
    }
  }

  onChatUpdate(handler: (chat: any[]) => void) {
    if (!this.chatStore) {
      return () => {};
    }
    return this.chatStore.subscribe(handler);
  }

  isConnected() {
    return this.isFullyConnected();
  }
}
