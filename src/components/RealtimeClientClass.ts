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
import {
  RealtimeClientOptionsBeforePrune,
  ResponseCreateParams,
  ResponseCreateStrict,
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
          // пробрасываем наружу, если хук указан
          this.options.hooks?.onError?.(event);
        },
        {
          error: this.options.logger?.error,
        }
      );

    // SuccessHandler для синхронизации connectionState c WebRTC/DataChannel
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

    // Initialize managers
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

  private setConnectionState(state: ConnectionState) {
    if (this.connectionState !== state) {
      this.connectionState = state;
      this.connectionListeners.forEach((listener) => listener(state));
    }
  }

  public getConnectionState(): ConnectionState {
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

  // Event management
  on(type: string, handler: Listener) {
    return this.eventRouter.on(type, handler);
  }

  // Connection management
  async connect() {
    try {
      this.setConnectionState('connecting');

      const ephemeralKey = await this.options.tokenProvider();
      if (!ephemeralKey) {
        throw new Error('Empty ephemeral token');
      }

      const pc = this.peerConnectionManager.create();
      this.mediaManager.setupRemoteStream(pc);

      const stream = await this.mediaManager.getUserMedia();
      this.mediaManager.addLocalStreamToPeerConnection(pc, stream);

      this.dataChannelManager.create(pc, async (evt) => {
        await this.eventRouter.processIncomingMessage(evt);
      });

      const offer = await this.peerConnectionManager.createOffer();
      await this.peerConnectionManager.setLocalDescription(offer);

      await this.peerConnectionManager.waitForIceGathering();

      const answer = await this.apiClient.postSDP(offer.sdp, ephemeralKey);
      await this.peerConnectionManager.setRemoteDescription(answer);
    } catch (e: any) {
      this.setConnectionState('error');
      this.errorHandler.handle('init_peer_connection', e);
      throw e;
    }
  }

  async disconnect() {
    try {
      this.successHandler.hangUpStarted();

      this.dataChannelManager.close();
      this.mediaManager.cleanup();
      this.peerConnectionManager.close();
      this.eventRouter.cleanup();

      if (this.chatStore) {
        this.chatStore.destroy();
      }

      this.setConnectionState('disconnected');
      this.successHandler.hangUpDone();
    } catch (e: any) {
      this.errorHandler.handle('hangup', e, 'warning', true);
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
  getStatus() {
    return this.connectionState;
  }
}
