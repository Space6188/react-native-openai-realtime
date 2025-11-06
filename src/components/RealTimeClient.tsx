import {
  AddableMessage,
  ChatMsg,
  CoreConfig,
  ExtendedChatMsg,
  RealtimeClientOptionsBeforePrune,
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
import type {
  EnhancedRealTimeClientProps,
  RealTimeClientHandle,
  SessionMode,
} from '@react-native-openai-realtime/types';
import { prune } from '@react-native-openai-realtime/helpers';
import {
  SuccessHandler,
  ErrorHandler,
} from '@react-native-openai-realtime/handlers';
import { useSessionOptions } from '@react-native-openai-realtime/hooks'; // ВАЖНО: см. вторую часть файла ниже
import { ErrorCallbackPayload } from '@react-native-openai-realtime/types';

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const RealTimeClient = forwardRef<
  RealTimeClientHandle,
  EnhancedRealTimeClientProps
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

    // Новые пропсы
    initializeMode,
    attemptsToReconnect = 1,
    onReconnectAttempt,
    onReconnectSuccess,
    onReconnectFailed,

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
  const [hookClient, setHookClient] = useState<RealtimeClientClass | null>(
    null
  );

  const connectionUnsubRef = useRef<(() => void) | null>(null);
  const detachChatRef = useRef<null | (() => void)>(null);
  const mountedRef = useRef(false);
  const connectCalledRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const isReconnectingRef = useRef(false);
  const sessionInitializedRef = useRef(false);
  const initInProgressRef = useRef(false);

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
        onError: (event: ErrorCallbackPayload) => {
          // Проксируем и одновременно отмечаем критические ошибки
          if (event.severity === 'critical') {
            setStatus('error');
          }
          onError?.(event);
        },
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

  const ensureClient = useCallback(() => {
    if (!clientRef.current) {
      const errorHandler = new ErrorHandler(
        (event) => {
          if (event.severity === 'critical') {
            setStatus('error');
          }
          onError?.(event);
        },
        { error: logger?.error }
      );

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
            if (state === 'connected') {
              setStatus('connected');
              reconnectAttemptRef.current = 0;
            } else if (state === 'connecting' || state === 'new') {
              setStatus('connecting');
            } else if (state === 'failed') {
              setStatus('error');
            } else if (state === 'disconnected' || state === 'closed') {
              setStatus('disconnected');
            }
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

      // Подписка на изменение connection state
      setStatus(clientRef.current.getConnectionState?.() ?? 'idle');
      const unsub = clientRef.current.onConnectionStateChange?.((s) =>
        setStatus(s as any)
      );
      connectionUnsubRef.current = unsub ?? null;

      if (tokenProvider) {
        try {
          clientRef.current.setTokenProvider(tokenProvider);
        } catch {}
      }
    }

    // Важное: пробрасываем реальный клиент в хук
    setHookClient(clientRef.current!);
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

  // Создаём клиент заранее при монтировании, чтобы хук получил валидный инстанс
  useEffect(() => {
    const c = ensureClient();
    setHookClient(c);
    return () => {
      try {
        connectionUnsubRef.current?.();
      } catch {}
    };
  }, [ensureClient]);

  // Хук — теперь получает реальный клиент или null и сам «дождётся» готовности
  const sessionOptions = useSessionOptions(hookClient);

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
        const currentStatus = clientRef.current?.getConnectionState?.();
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

  // Логика переподключения (без повторной инициализации режима — это делает эффект ниже)
  const handleReconnect = useCallback(async () => {
    if (
      isReconnectingRef.current ||
      reconnectAttemptRef.current >= attemptsToReconnect
    ) {
      return;
    }

    isReconnectingRef.current = true;
    reconnectAttemptRef.current += 1;

    onReconnectAttempt?.(reconnectAttemptRef.current, attemptsToReconnect);

    try {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      if (mountedRef.current && clientRef.current) {
        await clientRef.current.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 500));
        await clientRef.current.connect();

        onReconnectSuccess?.();
        reconnectAttemptRef.current = 0;
        // Важно: после reconnect не вызываем initSession здесь — пусть сделает эффект на "connected"
        sessionInitializedRef.current = false;
      }
    } catch (reconnectError) {
      if (reconnectAttemptRef.current >= attemptsToReconnect) {
        onReconnectFailed?.(reconnectError);
      } else {
        setTimeout(() => handleReconnect(), 1000);
      }
    } finally {
      isReconnectingRef.current = false;
    }
  }, [
    attemptsToReconnect,
    onReconnectAttempt,
    onReconnectSuccess,
    onReconnectFailed,
  ]);

  // Отслеживаем ошибки для переподключения
  useEffect(() => {
    if (status === 'error' && !isReconnectingRef.current) {
      handleReconnect();
    }
  }, [status, handleReconnect]);

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
      sessionInitializedRef.current = false;
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      connectCalledRef.current = false;
      try {
        connectionUnsubRef.current?.();
      } catch {}
    };
  }, []);

  // ЕДИНСТВЕННОЕ место инициализации начального режима: после успешного подключения и когда хук «готов»
  useEffect(() => {
    const initializeSession = async () => {
      if (
        status !== 'connected' ||
        !initializeMode ||
        sessionInitializedRef.current ||
        !sessionOptions.clientReady
      ) {
        return;
      }

      if (initInProgressRef.current) return;
      initInProgressRef.current = true;

      try {
        await sessionOptions.initSession(
          initializeMode.type,
          initializeMode.options
        );
        sessionInitializedRef.current = true;
      } catch (e) {
        // логируем, но не паникуем
        logger?.error?.('Failed to init initial session', e);
      } finally {
        initInProgressRef.current = false;
      }
    };

    initializeSession();
  }, [
    status,
    initializeMode,
    sessionOptions,
    sessionOptions.clientReady,
    logger,
  ]);

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect]);

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
    // Если нужно синхронно почистить локальный чат:
    // setChat([]);
    // setAddedMessages([]);
  }, []);

  // Методы переключения режимов через хук
  const switchToTextMode = useCallback(
    async (customParams?: Partial<any>) => {
      if (!sessionOptions.clientReady) {
        throw new Error('Client not ready');
      }
      await sessionOptions.initSession('text', customParams);
      sessionInitializedRef.current = true;
    },
    [sessionOptions]
  );

  const switchToVoiceMode = useCallback(
    async (customParams?: Partial<any>) => {
      if (!sessionOptions.clientReady) {
        throw new Error('Client not ready');
      }
      await sessionOptions.initSession('voice', customParams);
      sessionInitializedRef.current = true;
    },
    [sessionOptions]
  );

  const getCurrentMode = useCallback((): SessionMode => {
    return sessionOptions?.mode ?? 'text';
  }, [sessionOptions]);

  const getModeStatus = useCallback(() => {
    return sessionOptions?.isModeReady ?? 'idle';
  }, [sessionOptions]);

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
      enableMicrophone: async () =>
        await clientRef.current?.enableMicrophone?.(),
      disableMicrophone: async () =>
        await clientRef.current?.disableMicrophone?.(),
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

      switchToTextMode,
      switchToVoiceMode,
      getCurrentMode,
      getModeStatus,
    }),
    [
      status,
      connect,
      disconnect,
      addMessage,
      clearAdded,
      clearChatHistory,
      getNextTs,
      switchToTextMode,
      switchToVoiceMode,
      getCurrentMode,
      getModeStatus,
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
