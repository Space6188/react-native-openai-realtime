import { UseSessionOptionsParams } from '@react-native-openai-realtime/types';
import { useCallback, useEffect, useRef } from 'react';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const waitUntilDataChannelOpen = async (client: any, timeoutMs = 5000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const dc = client?.getDataChannel?.();
      if (dc && dc.readyState === 'open') {
        return true;
      }
    } catch {}
    await delay(100);
  }
  return false;
};

export const useSessionOptions = ({
  client,
  switchMode,
  onSuccess,
  onError,
}: UseSessionOptionsParams) => {
  const clientRef = useRef(client);
  const switchModeRef = useRef(switchMode);
  const lastResponseIdRef = useRef<string | null>(null);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    clientRef.current = client;
  }, [client]);

  useEffect(() => {
    switchModeRef.current = switchMode;
  }, [switchMode]);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const setRemoteTracksEnabled = useCallback((enabled: boolean) => {
    try {
      const remote = clientRef.current?.getRemoteStream?.();
      if (remote && typeof remote.getAudioTracks === 'function') {
        remote.getAudioTracks().forEach((t: any) => {
          t.enabled = enabled;
        });
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!clientRef.current?.on) return;

    const off1 = clientRef.current.on(
      'assistant:response_started',
      ({ responseId }: any) => {
        lastResponseIdRef.current = responseId;
        setRemoteTracksEnabled(true);
      }
    );

    const off2 = clientRef.current.on(
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
      } catch {}
      try {
        off2?.();
      } catch {}
    };
  }, [setRemoteTracksEnabled]);

  const enforceVoiceSession = useCallback(async () => {
    try {
      await clientRef.current?.sendRaw({
        type: 'session.update',
        session: {
          modalities: ['audio', 'text'],
          turn_detection: {
            type: 'server_vad',
            threshold: 0.7,
            prefix_padding_ms: 300,
            silence_duration_ms: 700,
          },
          input_audio_transcription: { model: 'whisper-1' },
        },
      });
      await delay(300);
      await clientRef.current?.enableMicrophone?.();
      await switchModeRef.current('voice');
      setRemoteTracksEnabled(true);
      await delay(400);
      onSuccessRef.current?.('voice_initialized');
    } catch (e) {
      console.warn('⚠️ enforceVoiceSession failed:', e);
      throw e;
    }
  }, [setRemoteTracksEnabled]);

  const enforceTextSession = useCallback(async () => {
    try {
      await clientRef.current?.sendRaw({
        type: 'session.update',
        session: {
          model: 'gpt-4o-realtime-preview-2024-12-17',
          voice: 'shimmer',
          modalities: ['text'],
          turn_detection: null,
          input_audio_transcription: null,
        },
      });
      await delay(300);
      await switchModeRef.current('text');
      onSuccessRef.current?.('text_initialized');
    } catch (e) {
      console.warn('⚠️ enforceTextSession failed:', e);
      throw e;
    }
  }, []);

  const cancelAssistant = useCallback(async () => {
    try {
      const chan = clientRef.current?.getDataChannel?.();
      if (!chan || chan.readyState !== 'open') {
        console.warn('⚠️ DataChannel not open');
        return;
      }

      const rid = lastResponseIdRef.current ?? undefined;

      try {
        await clientRef.current?.sendRaw({
          type: 'response.cancel',
          ...(rid ? { response_id: rid } : {}),
        });
      } catch (e) {
        console.warn('⚠️ response.cancel failed:', e);
      }

      try {
        await clientRef.current?.sendRaw({ type: 'output_audio_buffer.clear' });
      } catch (e) {
        console.warn('⚠️ output_audio_buffer.clear failed:', e);
      }

      setRemoteTracksEnabled(false);

      await delay(120);
      console.log('✅ Assistant cancelled');

      onSuccessRef.current?.('assistant_cancelled');
    } catch (e) {
      console.warn('⚠️ cancelAssistant error:', e);
      onErrorRef.current?.('assistant_cancel', e);
      throw e;
    }
  }, [setRemoteTracksEnabled]);

  const initializeMode = useCallback(
    async (mode: 'voice' | 'text') => {
      try {
        const dcOpened = await waitUntilDataChannelOpen(
          clientRef.current,
          5000
        );
        if (!dcOpened) {
          throw new Error('DataChannel not ready');
        }
        if (mode === 'voice') {
          await enforceVoiceSession();
        } else {
          await enforceTextSession();
        }
        await delay(300);
        await switchModeRef.current(mode);
        onSuccessRef.current?.(`${mode}_initialized`);
      } catch (e) {
        onErrorRef.current?.(`${mode}_close`, e);
        throw e;
      }
    },
    [enforceTextSession, enforceVoiceSession]
  );

  const closeVoiceMode = useCallback(async () => {
    try {
      console.log('🔇 Closing voice mode...');

      await cancelAssistant();

      const dc = clientRef.current?.getDataChannel?.();
      if (dc?.readyState !== 'open') {
        console.warn('⚠️ DataChannel not open');
        return;
      }

      await enforceTextSession();
      await switchModeRef.current('text');

      await delay(150);
      console.log('✅ Voice mode closed');

      onSuccessRef.current?.('voice_closed');
    } catch (e) {
      console.warn('⚠️ closeVoiceMode error:', e);
      onErrorRef.current?.('voice_close', e);
      throw e;
    }
  }, [cancelAssistant, enforceTextSession]);

  const handleSendMessage = async (
    text: string,
    onSuccessCallback: () => void,
    onErrorCallback: (error: any) => void
  ) => {
    if (!text) return;
    const dc = clientRef.current?.getDataChannel?.();
    const status = clientRef.current?.getStatus?.();
    const dcReady = !!dc && dc.readyState === 'open';
    const isConnected = status === 'connected' || dcReady;
    if (!isConnected) {
      onErrorCallback('Not connected');
      return;
    }

    if (dc?.readyState !== 'open') {
      onErrorCallback('DataChannel not open');
      return;
    }

    try {
      await clientRef.current?.sendRaw({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
      });

      await clientRef.current?.sendResponseStrict({
        instructions: 'Ответь кратко и по делу.',
        modalities: ['text'],
        conversation: 'auto',
      });
      onSuccessCallback();
    } catch (e) {
      onErrorCallback(e);
    }
  };
  return {
    initializeMode,
    closeVoiceMode,
    cancelAssistant,
    handleSendMessage,
    // Advanced methods
    enforceTextSession,
    enforceVoiceSession,
    setRemoteTracksEnabled,
  };
};
