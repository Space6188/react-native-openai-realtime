// hooks/useSessionOptions.ts
import { useCallback, useEffect, useRef } from 'react';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface UseSessionOptionsParams {
  client: any;
}

export const useSessionOptions = ({ client }: UseSessionOptionsParams) => {
  const clientRef = useRef(client);
  const lastResponseIdRef = useRef<string | null>(null);

  // Синхронизация refs
  useEffect(() => {
    clientRef.current = client;
  }, [client]);

  // Управление удалёнными треками
  const setRemoteTracksEnabled = useCallback((enabled: boolean) => {
    try {
      const remote = clientRef.current?.getRemoteStream?.();
      remote?.getAudioTracks?.().forEach((t: any) => {
        t.enabled = enabled;
      });
    } catch (e) {
      console.warn('⚠️ setRemoteTracksEnabled failed:', e);
    }
  }, []);

  // ✅ Подписка на события ассистента (возвращает cleanup функцию)
  const subscribeToAssistantEvents = useCallback(() => {
    if (!clientRef.current?.on) return () => {};

    const off1 = clientRef.current.on(
      'assistant:response_started',
      ({ responseId }: any) => {
        lastResponseIdRef.current = responseId;
        setRemoteTracksEnabled(true);
        console.log('🎤 Assistant started:', responseId);
      }
    );

    const off2 = clientRef.current.on(
      'assistant:completed',
      ({ responseId }: any) => {
        if (lastResponseIdRef.current === responseId) {
          lastResponseIdRef.current = null;
          console.log('✅ Assistant completed:', responseId);
        }
      }
    );

    return () => {
      try {
        off1?.();
        off2?.();
      } catch {}
    };
  }, [setRemoteTracksEnabled]);

  // Отмена ассистента
  const cancelAssistant = useCallback(async () => {
    try {
      const dc = clientRef.current?.getDataChannel?.();
      if (!dc || dc.readyState !== 'open') {
        console.warn('⚠️ DataChannel not ready for cancel');
        return;
      }

      const rid = lastResponseIdRef.current ?? undefined;

      // 1. Остановка ответа
      try {
        await clientRef.current?.sendRaw({
          type: 'response.cancel',
          ...(rid ? { response_id: rid } : {}),
        });
        console.log('✅ response.cancel sent');
      } catch (e) {
        console.warn('⚠️ response.cancel failed:', e);
      }

      // 2. Очистка буфера
      try {
        await clientRef.current?.sendRaw({
          type: 'input_audio_buffer.clear',
        });
        console.log('✅ input_audio_buffer.clear sent');
      } catch (e) {
        console.warn('⚠️ input_audio_buffer.clear failed:', e);
      }

      // 3. Глушим треки
      setRemoteTracksEnabled(false);
      lastResponseIdRef.current = null;

      await delay(120);
      console.log('✅ Assistant cancelled');
    } catch (e) {
      console.error('❌ cancelAssistant error:', e);
      throw e;
    }
  }, [setRemoteTracksEnabled]);

  // Переключение в текстовый режим
  const enforceTextSession = useCallback(async () => {
    try {
      const dc = clientRef.current?.getDataChannel?.();
      if (!dc || dc.readyState !== 'open') {
        console.warn('⚠️ DataChannel not ready');
        return;
      }

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

      setRemoteTracksEnabled(false);
      console.log('✅ Text session enforced');
    } catch (e) {
      console.error('❌ enforceTextSession failed:', e);
      throw e;
    }
  }, [setRemoteTracksEnabled]);

  // Переключение в голосовой режим
  const enforceVoiceSession = useCallback(async () => {
    try {
      const dc = clientRef.current?.getDataChannel?.();
      if (!dc || dc.readyState !== 'open') {
        console.warn('⚠️ DataChannel not ready');
        throw new Error('DataChannel not ready');
      }

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
      setRemoteTracksEnabled(true);

      console.log('✅ Voice session enforced');
    } catch (e) {
      console.error('❌ enforceVoiceSession failed:', e);
      throw e;
    }
  }, [setRemoteTracksEnabled]);

  // Закрытие голосового режима
  const closeVoiceMode = useCallback(async () => {
    try {
      // 1. Отменяем ассистента
      await cancelAssistant();

      // 2. Переводим в текстовый режим
      await enforceTextSession();

      console.log('✅ Voice mode closed');
    } catch (e) {
      console.error('❌ closeVoiceMode failed:', e);
      throw e;
    }
  }, [cancelAssistant, enforceTextSession]);

  // Отправка текстового сообщения
  const handleSendMessage = useCallback(
    async (
      text: string,
      onComplete?: () => void,
      onFail?: (err: any) => void
    ) => {
      if (!text.trim()) {
        console.warn('⚠️ Empty message');
        return;
      }

      const dc = clientRef.current?.getDataChannel?.();
      if (!dc || dc.readyState !== 'open') {
        const error = 'DataChannel not open';
        console.warn('⚠️', error);
        onFail?.(error);
        return;
      }

      try {
        // 1. Создаём message item
        await clientRef.current?.sendRaw({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text }],
          },
        });

        // 2. Запрашиваем ответ
        await clientRef.current?.sendRaw({
          type: 'response.create',
          response: {
            modalities: ['text'],
            instructions: 'Ответь кратко и по делу.',
          },
        });

        console.log('✅ Message sent');
        onComplete?.();
      } catch (e) {
        console.error('❌ handleSendMessage failed:', e);
        onFail?.(e);
      }
    },
    []
  );

  return {
    cancelAssistant,
    enforceTextSession,
    enforceVoiceSession,
    closeVoiceMode,
    handleSendMessage,
    setRemoteTracksEnabled,
    subscribeToAssistantEvents,
  };
};
