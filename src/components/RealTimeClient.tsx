import {
  AddableMessage,
  ChatMsg,
  CoreConfig,
  ExtendedChatMsg,
  RealtimeClientOptionsBeforePrune,
  RealTimeClientProps,
  RealtimeContextValue,
  TokenProvider,
} from '@react-native-openai-realtime/types';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { RealtimeClientClass } from '@react-native-openai-realtime/components';
import { attachChatAdapter } from '@react-native-openai-realtime/adapters';
import { RealtimeProvider } from '@react-native-openai-realtime/context';
import { prune } from '@react-native-openai-realtime/helpers';
import {
  SuccessHandler,
  ErrorHandler,
} from '@react-native-openai-realtime/handlers';

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export type RealTimeClientHandle = {
  enableMicrophone: () => Promise<void>;
  getClient: () => RealtimeClientClass | null;
  getStatus: () =>
    | 'idle'
    | 'connecting'
    | 'connected'
    | 'disconnected'
    | 'error';
  setTokenProvider: (tp: TokenProvider) => void;

  connect: () => Promise<void>;
  disconnect: () => Promise<void>;

  sendRaw: (e: any) => Promise<void> | void;
  sendResponse: (opts?: any) => void;
  sendResponseStrict: (opts: {
    instructions: string;
    modalities?: Array<'audio' | 'text'>;
    conversation?: 'auto' | 'none';
  }) => void;
  updateSession: (patch: Partial<any>) => void;

  addMessage: (m: AddableMessage | AddableMessage[]) => string | string[];
  clearAdded: () => void;
  clearChatHistory: () => void;
  getNextTs: () => number;
};

export const RealTimeClient = forwardRef<
  RealTimeClientHandle,
  RealTimeClientProps
>((props, ref) => {
  const {
    tokenProvider,
    webrtc,
    media,
    chatInverted,
    session,
    autoSessionUpdate,
    greetEnabled,
    greetInstructions,
    greetModalities,
    onOpen,
    onEvent,
    onError,
    onUserTranscriptionDelta,
    onUserTranscriptionCompleted,
    onAssistantTextDelta,
    onAssistantCompleted,
    deleteChatHistoryOnDisconnect = true,
    onToolCall,
    incomingMiddleware,
    outgoingMiddleware,
    policyIsMeaningfulText,
    chatEnabled,
    chatIsMeaningfulText,
    logger,
    autoConnect = false,
    attachChat = true,
    children,
    chatUserAddOnDelta,
    chatUserPlaceholderOnStart,
    chatAssistantAddOnDelta,
    chatAssistantPlaceholderOnStart,

    allowConnectWithoutMic = true,

    // Success callbacks
    onHangUpStarted,
    onHangUpDone,
    onPeerConnectionCreatingStarted,
    onPeerConnectionCreated,
    onRTCPeerConnectionStateChange,
    onGetUserMediaSetted,
    onLocalStreamSetted,
    onLocalStreamAddedTrack,
    onLocalStreamRemovedTrack,
    onRemoteStreamSetted,
    onDataChannelOpen,
    onDataChannelMessage,
    onDataChannelClose,
    onIceGatheringComplete,
    onIceGatheringTimeout,
    onIceGatheringStateChange,
    onMicrophonePermissionGranted,
    onMicrophonePermissionDenied,
    onIOSTransceiverSetted,
    onSuccess,
  } = props;

  const clientRef = useRef<RealtimeClientClass | null>(null);
  const connectionUnsubRef = useRef<(() => void) | null>(null);
  const detachChatRef = useRef<null | (() => void)>(null);
  const mountedRef = useRef(false);
  const connectCalledRef = useRef(false);

  const [status, setStatus] = useState<
    'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
  >('idle');
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [addedMessages, setAddedMessages] = useState<ExtendedChatMsg[]>([]);

  const optionsSnapshot: CoreConfig = useMemo(() => {
    return prune({
      tokenProvider,
      webrtc,
      media,
      chatInverted,
      session,
      autoSessionUpdate,
      greet:
        greetEnabled !== undefined || greetInstructions || greetModalities
          ? {
              enabled: greetEnabled ?? true,
              response: {
                instructions: greetInstructions,
                modalities: greetModalities,
              },
            }
          : undefined,
      hooks: prune({
        onOpen,
        onEvent,
        onError,
        onUserTranscriptionDelta,
        onUserTranscriptionCompleted,
        onAssistantTextDelta,
        onAssistantCompleted,
        onToolCall,
      }) as any,
      middleware: prune({
        incoming: incomingMiddleware,
        outgoing: outgoingMiddleware,
      }) as any,
      policy: prune({ isMeaningfulText: policyIsMeaningfulText }),
      deleteChatHistoryOnDisconnect,
      chat: prune({
        enabled: chatEnabled,
        isMeaningfulText: chatIsMeaningfulText,
        userAddOnDelta: chatUserAddOnDelta,
        userPlaceholderOnStart: chatUserPlaceholderOnStart,
        assistantAddOnDelta: chatAssistantAddOnDelta,
        assistantPlaceholderOnStart: chatAssistantPlaceholderOnStart,
      }),
      logger,
      allowConnectWithoutMic,
    }) as CoreConfig;
  }, [
    tokenProvider,
    deleteChatHistoryOnDisconnect,
    webrtc,
    media,
    chatInverted,
    session,
    autoSessionUpdate,
    greetEnabled,
    greetInstructions,
    greetModalities,
    onOpen,
    onEvent,
    onError,
    onUserTranscriptionDelta,
    onUserTranscriptionCompleted,
    onAssistantTextDelta,
    onAssistantCompleted,
    onToolCall,
    incomingMiddleware,
    outgoingMiddleware,
    policyIsMeaningfulText,
    chatEnabled,
    chatIsMeaningfulText,
    logger,
    chatUserAddOnDelta,
    chatUserPlaceholderOnStart,
    chatAssistantAddOnDelta,
    chatAssistantPlaceholderOnStart,
    allowConnectWithoutMic,
  ]);

  // В файле: RealTimeClient.tsx
  // Замените часть с созданием successHandler/errorHandler:

  const ensureClient = useCallback(() => {
    if (!clientRef.current) {
      // ✅ ИСПРАВЛЕНО: ErrorHandler НЕ меняет статус для warning
      const errorHandler = new ErrorHandler(
        (event) => {
          // Меняем статус только для критических ошибок
          if (event.severity === 'critical') {
            setStatus('error');
          }
          // Вызываем пользовательский onError
          onError?.(event);
        },
        { error: logger?.error }
      );

      // Комбинированный SuccessHandler
      const successHandler = new SuccessHandler(
        {
          onPeerConnectionCreatingStarted: () => {
            setStatus('connecting');
            onPeerConnectionCreatingStarted?.();
          },
          onPeerConnectionCreated: (pc) => {
            onPeerConnectionCreated?.(pc);
          },
          onRTCPeerConnectionStateChange: (state) => {
            // Синхронизируем статус только для валидных состояний
            if (state === 'connected') setStatus('connected');
            else if (state === 'connecting' || state === 'new')
              setStatus('connecting');
            else if (state === 'failed') setStatus('error');
            else if (state === 'disconnected' || state === 'closed')
              setStatus('disconnected');

            onRTCPeerConnectionStateChange?.(state);
          },
          onDataChannelOpen: (channel) => {
            setStatus('connected');
            onDataChannelOpen?.(channel);
          },
          onDataChannelClose: () => {
            setStatus('disconnected');
            onDataChannelClose?.();
          },

          // Остальные callbacks - просто прокидываем
          onGetUserMediaSetted,
          onLocalStreamSetted,
          onLocalStreamAddedTrack,
          onLocalStreamRemovedTrack,
          onRemoteStreamSetted,
          onIceGatheringComplete,
          onIceGatheringTimeout,
          onIceGatheringStateChange,
          onMicrophonePermissionGranted,
          onMicrophonePermissionDenied,
          onIOSTransceiverSetted,
          onHangUpStarted,
          onHangUpDone,
          onDataChannelMessage,
        },
        onSuccess
      );

      clientRef.current = new RealtimeClientClass(
        optionsSnapshot as RealtimeClientOptionsBeforePrune,
        successHandler,
        errorHandler
      );

      setStatus(clientRef.current.getConnectionState());
      const unsub = clientRef.current.onConnectionStateChange((s) =>
        setStatus(s)
      );
      connectionUnsubRef.current = unsub;

      if (tokenProvider) {
        try {
          clientRef.current.setTokenProvider(tokenProvider);
        } catch {}
      }
    }
    return clientRef.current!;
  }, [
    optionsSnapshot,
    tokenProvider,
    onHangUpStarted,
    onHangUpDone,
    onPeerConnectionCreatingStarted,
    onPeerConnectionCreated,
    onRTCPeerConnectionStateChange,
    onGetUserMediaSetted,
    onLocalStreamSetted,
    onLocalStreamAddedTrack,
    onLocalStreamRemovedTrack,
    onRemoteStreamSetted,
    onDataChannelOpen,
    onDataChannelMessage,
    onDataChannelClose,
    onIceGatheringComplete,
    onIceGatheringTimeout,
    onIceGatheringStateChange,
    onMicrophonePermissionGranted,
    onMicrophonePermissionDenied,
    onIOSTransceiverSetted,
    onSuccess,
    onError,
    logger,
  ]);

  useEffect(() => {
    if (clientRef.current && tokenProvider) {
      try {
        clientRef.current.setTokenProvider(tokenProvider);
      } catch {}
    }
  }, [tokenProvider]);

  useEffect(() => {
    const onAppState = (state: AppStateStatus) => {
      if (state === 'background') {
        const currentStatus = clientRef.current?.getStatus?.();
        if (currentStatus === 'connecting') {
          setTimeout(() => {
            if (AppState.currentState === 'background') {
              clientRef.current?.disconnect().catch(() => {});
            }
          }, 1200);
        } else {
          clientRef.current?.disconnect().catch(() => {});
        }
      }
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => sub.remove();
  }, []);

  const connect = useCallback(async () => {
    const client = ensureClient();
    try {
      if (attachChat && !detachChatRef.current) {
        const isMeaningful =
          chatIsMeaningfulText ??
          policyIsMeaningfulText ??
          ((t: string) => !!t.trim());
        detachChatRef.current = attachChatAdapter(client, setChat, {
          isMeaningfulText: isMeaningful,
        });
      }
      await client.connect();
    } catch (e) {
      throw e;
    }
  }, [ensureClient, attachChat, chatIsMeaningfulText, policyIsMeaningfulText]);

  const disconnect = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      await client.disconnect();
    } finally {
      if (detachChatRef.current) {
        detachChatRef.current();
        detachChatRef.current = null;
      }
      if (deleteChatHistoryOnDisconnect) {
        setChat([]);
        setAddedMessages([]);
      }
    }
  }, [deleteChatHistoryOnDisconnect]);

  // Защита от многократного autoConnect
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      connectCalledRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!autoConnect || !mountedRef.current || connectCalledRef.current) return;

    connectCalledRef.current = true;
    const t = setTimeout(() => {
      if (mountedRef.current) {
        connect().catch(() => {});
      }
    }, 50);

    return () => {
      clearTimeout(t);
      // ВАЖНО: здесь НЕ вызывать disconnect — иначе прервёте connect
    };
  }, [autoConnect, connect]); // не тяните connect/disconnect в зависимости

  const getNextTs = useCallback((): number => {
    try {
      const chatMax =
        (chat?.length ? Math.max(...chat.map((m: any) => m?.ts ?? 0)) : 0) || 0;
      const addedMax =
        (addedMessages?.length
          ? Math.max(...addedMessages.map((m: any) => m?.ts ?? 0))
          : 0) || 0;
      const maxTs = Math.max(chatMax, addedMax);
      return maxTs > 0 ? maxTs + 1 : Date.now();
    } catch {
      return Date.now();
    }
  }, [chat, addedMessages]);

  const normalize = useCallback(
    (m: AddableMessage): ExtendedChatMsg => {
      const base = {
        id: (m as any).id ?? makeId(),
        role: (m as any).role ?? 'assistant',
        ts: (m as any).ts ?? getNextTs(),
        time: Date.now(),
      };

      if (
        (m as any).type === 'ui' ||
        ('kind' in (m as any) && 'payload' in (m as any))
      ) {
        return {
          ...base,
          type: 'ui',
          kind: (m as any).kind,
          payload: (m as any).payload,
        } as unknown as ExtendedChatMsg;
      }

      return {
        ...base,
        type: 'text',
        text: (m as any).text ?? '',
        status: 'done',
      } as unknown as ExtendedChatMsg;
    },
    [getNextTs]
  );

  const addMessage = useCallback(
    (m: AddableMessage | AddableMessage[]) => {
      const arr = Array.isArray(m) ? m : [m];
      const normalized = arr.map(normalize);
      setAddedMessages((prev) => [...prev, ...normalized]);
      const ids = normalized.map((x) => (x as any).id as string);
      return Array.isArray(m) ? ids : ids[0];
    },
    [normalize]
  );

  const clearAdded = useCallback(() => setAddedMessages([]), []);

  const mergedChat = useMemo<ExtendedChatMsg[]>(() => {
    const merged = [...(chat ?? []), ...addedMessages];
    return chatInverted
      ? merged.sort((a: any, b: any) => (a.ts ?? 0) - (b.ts ?? 0))
      : merged.sort((a: any, b: any) => (b.ts ?? 0) - (a.ts ?? 0));
  }, [chat, addedMessages, chatInverted]);

  const clearChatHistory = useCallback(() => {
    clientRef.current?.clearChatHistory();
  }, []);

  const value: RealtimeContextValue = useMemo(
    () => ({
      client: clientRef.current,
      status,
      clearChatHistory,
      chat: mergedChat,
      connect,
      disconnect,
      sendResponse: (opts?: any) => clientRef.current?.sendResponse(opts),
      sendResponseStrict: (opts: {
        instructions: string;
        modalities?: Array<'audio' | 'text'>;
        conversation?: 'auto' | 'none';
      }) => clientRef.current?.sendResponseStrict(opts),
      updateSession: (patch: Partial<any>) =>
        clientRef.current?.updateSession(patch),
      sendRaw: (e: any) => clientRef.current?.sendRaw(e),
      addMessage,
      clearAdded,
      getNextTs,
    }),
    [
      status,
      mergedChat,
      connect,
      disconnect,
      addMessage,
      clearAdded,
      clearChatHistory,
      getNextTs,
    ]
  );

  useImperativeHandle(
    ref,
    () => ({
      getClient: () => clientRef.current,
      enableMicrophone: async () => {
        // @ts-ignore внутренний метод класса
        await clientRef.current?.enableMicrophone?.();
      },

      getStatus: () => status,
      setTokenProvider: (tp: TokenProvider) => {
        try {
          clientRef.current?.setTokenProvider(tp);
        } catch {}
      },
      connect: async () => {
        await connect();
      },
      disconnect: async () => {
        await disconnect();
      },
      sendRaw: (e: any) => clientRef.current?.sendRaw(e),
      sendResponse: (opts?: any) => clientRef.current?.sendResponse(opts),
      sendResponseStrict: (opts) => clientRef.current?.sendResponseStrict(opts),
      updateSession: (patch) => clientRef.current?.updateSession(patch),

      addMessage,
      clearAdded,
      clearChatHistory,
      getNextTs,
    }),
    [
      status,
      connect,
      disconnect,
      addMessage,
      clearAdded,
      clearChatHistory,
      getNextTs,
    ]
  );

  const renderedChildren =
    typeof children === 'function' ? (children as any)(value) : children;

  return (
    <RealtimeProvider value={value}>
      {renderedChildren ?? null}
    </RealtimeProvider>
  );
});
