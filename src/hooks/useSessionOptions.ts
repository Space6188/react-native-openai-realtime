import { useCallback, useEffect, useRef, useState } from 'react';
import InCallManager from 'react-native-incall-manager';
import { RealtimeClientClass } from '@react-native-openai-realtime/components';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const useSessionOptions = (client: RealtimeClientClass | null) => {
  const clientRef = useRef<RealtimeClientClass | null>(client);
  const lastResponseIdRef = useRef<string | null>(null);
  const initInProgressRef = useRef(false);

  const [mode, setMode] = useState<'text' | 'voice'>('text');
  const [isModeReady, setIsModeReady] = useState<
    'idle' | 'connecting' | 'connected' | 'disconnected'
  >('idle');
  const [clientReady, setClientReady] = useState<boolean>(!!client);

  useEffect(() => {
    clientRef.current = client;
    setClientReady(!!client);
  }, [client]);

  const waitUntilDataChannelOpen = useCallback(async (timeoutMs = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const c = clientRef.current;
      if (c && typeof c.getDataChannel === 'function') {
        try {
          const dc = c.getDataChannel();
          if (dc && dc.readyState === 'open') {
            return true;
          }
        } catch {}
      }
      await delay(100);
    }
    return false;
  }, []);

  const setRemoteTracksEnabled = useCallback((enabled: boolean) => {
    try {
      const remote = clientRef.current?.getRemoteStream?.();
      if (remote && typeof remote.getAudioTracks === 'function') {
        remote.getAudioTracks().forEach((t: any) => {
          t.enabled = enabled;
        });
      }
    } catch (e) {
      throw new Error('Failed to set remote tracks enabled' + e);
    }
  }, []);

  const setMicrophoneEnabled = useCallback((enabled: boolean) => {
    try {
      const c = clientRef.current;
      if (!c || typeof c.getLocalStream !== 'function') return;

      const localStream = c.getLocalStream?.();
      if (localStream) {
        localStream.getAudioTracks().forEach((track: any) => {
          track.enabled = enabled;
        });
      }
    } catch (e) {
      // no-op
      throw new Error('Failed to set microphone enabled' + e);
    }
  }, []);

  const restartSpeakerRoute = useCallback(async () => {
    try {
      InCallManager.start({ media: 'audio', auto: false, ringback: '' });
      InCallManager.setSpeakerphoneOn(true);
      InCallManager.setForceSpeakerphoneOn(true);
    } catch (e) {
      // no-op
      throw new Error('Failed to restart speaker route' + e);
    }
  }, []);

  // Возвращаем функция подписки, без автоподписки по mount
  const subscribeToAssistantEvents = useCallback(
    (onAssistantStarted?: () => void) => {
      const c = clientRef.current;
      if (!c || typeof (c as any).on !== 'function') return () => {};

      const off1 = (c as any).on(
        'assistant:response_started',
        ({ responseId }: any) => {
          lastResponseIdRef.current = responseId;
          onAssistantStarted?.();
        }
      );

      const off2 = (c as any).on(
        'assistant:completed',
        ({ responseId }: any) => {
          if (lastResponseIdRef.current === responseId) {
            lastResponseIdRef.current = null;
          }
        }
      );

      return () => {
        try {
          off1?.();
          off2?.();
        } catch {}
      };
    },
    []
  );

  const cancelAssistantNow = useCallback(
    async (onComplete?: () => void, onFail?: (err: any) => void) => {
      try {
        const c = clientRef.current as any;
        const chan = c?.getDataChannel?.();
        if (!chan || chan.readyState !== 'open') return;

        const rid = lastResponseIdRef.current ?? undefined;

        InCallManager.stop();
        await c?.sendRaw({
          type: 'response.cancel',
          ...(rid ? { response_id: rid } : {}),
        });
        await c?.sendRaw({
          type: 'output_audio_buffer.clear',
        });

        setRemoteTracksEnabled(false);
        setMicrophoneEnabled(false);
        await delay(120);
        onComplete?.();
      } catch (e) {
        onFail?.(e);
      }
    },
    [setRemoteTracksEnabled, setMicrophoneEnabled]
  );

  const enforceTextSession = useCallback(
    async (customParams?: Partial<any>) => {
      const c = clientRef.current as any;
      if (!c) throw new Error('Client not ready');

      try {
        await cancelAssistantNow();

        setRemoteTracksEnabled(false);
        setMicrophoneEnabled(false);
        InCallManager.stop();

        const defaultTextParams = {
          modalities: ['text'],
          turn_detection: null,
          input_audio_transcription: null,
        };

        await c.sendRaw({
          type: 'session.update',
          session: {
            ...defaultTextParams,
            ...customParams,
          },
        });
      } catch (e) {
        throw new Error('Failed to enforce text session' + e);
      }
    },
    [cancelAssistantNow, setRemoteTracksEnabled, setMicrophoneEnabled]
  );

  const enforceVoiceSession = useCallback(
    async (customParams?: Partial<any>) => {
      const c = clientRef.current as any;
      if (!c) throw new Error('Client not ready');

      try {
        const defaultVoiceParams = {
          model: 'gpt-4o-realtime-preview-2024-12-17',
          voice: 'shimmer',
          modalities: ['text', 'audio'],
          turn_detection: {
            type: 'server_vad',
            threshold: 0.6,
            prefix_padding_ms: 200,
            silence_duration_ms: 1200,
          },
          input_audio_transcription: { model: 'whisper-1' },
        };

        await c.sendRaw({
          type: 'session.update',
          session: {
            ...defaultVoiceParams,
            ...customParams,
          },
        });

        await delay(300);
        await restartSpeakerRoute();

        setRemoteTracksEnabled(true);
        setMicrophoneEnabled(true);
      } catch (e) {
        throw new Error('Failed to enforce voice session' + e);
      }
    },
    [restartSpeakerRoute, setRemoteTracksEnabled, setMicrophoneEnabled]
  );

  const initSession = useCallback(
    async (newMode: 'text' | 'voice', customParams?: Partial<any>) => {
      if (!clientReady) {
        throw new Error('Client not ready');
      }
      if (initInProgressRef.current) {
        // Не запускаем повторную инициализацию в параллель
        return;
      }
      initInProgressRef.current = true;

      setIsModeReady('connecting');

      const dcOpened = await waitUntilDataChannelOpen(5000);
      if (!dcOpened) {
        setIsModeReady('disconnected');
        initInProgressRef.current = false;
        throw new Error('DataChannel not open');
      }

      try {
        if (newMode === 'text') {
          await enforceTextSession(customParams);
        } else {
          await enforceVoiceSession(customParams);
        }

        setMode(newMode);
        setIsModeReady('connected');
      } catch (e) {
        setIsModeReady('disconnected');
        throw new Error('Failed to init session' + e);
      } finally {
        initInProgressRef.current = false;
      }
    },
    [
      clientReady,
      waitUntilDataChannelOpen,
      enforceTextSession,
      enforceVoiceSession,
    ]
  );

  const handleSendMessage = useCallback(async (text: string) => {
    if (!text.trim()) {
      throw new Error('Empty message');
    }
    const c = clientRef.current as any;
    const dc = c?.getDataChannel?.();
    if (!dc || dc.readyState !== 'open') {
      throw new Error('DataChannel not open');
    }

    try {
      await c?.sendRaw({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
      });

      await c?.sendRaw({
        type: 'response.create',
        response: {
          modalities: ['text'],
        },
      });
    } catch (e) {
      throw new Error('Failed to send message' + e);
    }
  }, []);

  return {
    subscribeToAssistantEvents,
    handleSendMessage,
    initSession,
    isModeReady,
    mode,
    cancelAssistantNow,
    clientReady,
  };
};
