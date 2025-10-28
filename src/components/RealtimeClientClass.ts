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
} from '@react-native-openai-realtime/types';

type Listener = (payload: any) => void;
type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';
type ConnectionListener = (state: ConnectionState) => void;

export class RealtimeClientClass {
  private options: RealtimeClientOptionsBeforePrune;

  // Connection state
  private connectionState: ConnectionState = 'idle';
  private connectionListeners = new Set<ConnectionListener>();

  // Concurrency guards
  private connecting = false;
  private disconnecting = false;

  // Managers
  private peerConnectionManager: PeerConnectionManager;
  private mediaManager: MediaManager;
  private dataChannelManager: DataChannelManager;
  private messageSender: MessageSender;
  private eventRouter: EventRouter;
  private apiClient: OpenAIApiClient;

  // Handlers
  private errorHandler: ErrorHandler;
  private successHandler: SuccessHandler;

  // Chat
  private chatStore?: ChatStore;

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
        if (state === 'connected') this.setConnectionState('connected');
        else if (state === 'connecting' || state === 'new')
          this.setConnectionState('connecting');
        else if (state === 'failed') this.setConnectionState('error');
        else if (state === 'disconnected' || state === 'closed')
          this.setConnectionState('disconnected');
      },
      onDataChannelOpen: () => {
        this.setConnectionState('connected');
      },
      onDataChannelClose: () => {
        this.setConnectionState('disconnected');
      },
    };

    this.successHandler =
      success ?? new SuccessHandler(callbacks as any, undefined);

    // Managers
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

    // Chat store
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

  // Allow updating tokenProvider without recreating client
  setTokenProvider(tp: TokenProvider) {
    if (typeof tp !== 'function')
      throw new Error('setTokenProvider: invalid tokenProvider');
    this.options.tokenProvider = tp;
  }

  private setConnectionState(state: ConnectionState) {
    if (this.connectionState !== state) {
      this.connectionState = state;
      this.connectionListeners.forEach((listener) => listener(state));
    }
  }

  public getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  public getStatus() {
    return this.connectionState;
  }

  public onConnectionStateChange(listener: ConnectionListener) {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  private wireChatStore() {
    if (!this.chatStore) return;

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
  }

  on(type: string, handler: Listener) {
    return this.eventRouter.on(type, handler);
  }

  // Pre-connect cleanup to avoid leftover transports if previous session wasn't closed properly
  private preConnectCleanup() {
    try {
      this.dataChannelManager.close();
    } catch {}
    try {
      this.peerConnectionManager.close();
    } catch {}
    try {
      // stop mic/camera if dangling
      this.mediaManager.cleanup();
    } catch {}
    // ВАЖНО: EventRouter/ChatStore не трогаем здесь, чтобы не потерять подписки.
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

    try {
      this.setConnectionState('connecting');

      // Очистим возможные «хвосты», если предыдущая сессия не закрылась
      this.preConnectCleanup();

      // 1) Token
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

      // 2) PeerConnection
      const pc = this.peerConnectionManager.create();

      // 3) Remote stream
      this.mediaManager.setupRemoteStream(pc);

      // 4) Local media
      const stream = await this.mediaManager.getUserMedia();
      this.mediaManager.addLocalStreamToPeerConnection(pc, stream);

      // 5) DataChannel
      this.dataChannelManager.create(pc, async (evt) => {
        await this.eventRouter.processIncomingMessage(evt);
      });

      // 6) Offer
      const offer = await this.peerConnectionManager.createOffer();
      await this.peerConnectionManager.setLocalDescription(offer);

      // 7) ICE
      await this.peerConnectionManager.waitForIceGathering();

      // 8) SDP exchange
      const answer = await this.apiClient.postSDP(offer.sdp, ephemeralKey);
      await this.peerConnectionManager.setRemoteDescription(answer);
    } catch (e: any) {
      if (this.getStatus() !== 'error') {
        this.setConnectionState('error');
        this.errorHandler.handle('init_peer_connection', e);
      }
      throw e;
    } finally {
      this.connecting = false;
    }
  }

  async disconnect() {
    if (this.disconnecting) return;
    this.disconnecting = true;

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
      if (this.chatStore) {
        try {
          this.chatStore.destroy();
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

  // Message sending
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

  // Getters
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

  onChatUpdate(handler: (chat: any[]) => void) {
    if (!this.chatStore) {
      return () => {};
    }
    return this.chatStore.subscribe(handler);
  }

  isConnected() {
    return this.connectionState === 'connected';
  }
}
