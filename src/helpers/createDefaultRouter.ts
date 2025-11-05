// src/helpers/createDefaultRouter.ts
import type { RealtimeClientOptionsBeforePrune } from '@react-native-openai-realtime/types';

type Emitter = (type: string, payload?: any) => void;

// Достаём input_text из созданного user item (typed-ввод)
function extractInputTextFromItem(item: any): string | null {
  try {
    const content = item?.content;
    if (!Array.isArray(content)) return null;
    for (const c of content) {
      if (!c || typeof c !== 'object') continue;
      if (c.type === 'input_text' && typeof c.text === 'string') {
        return c.text;
      }
      if (c.type === 'text' && typeof c.text === 'string') {
        return c.text;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function createDefaultRouter(
  emit: Emitter,
  options: RealtimeClientOptionsBeforePrune,
  functionArgsBuffer: Map<string, string>,
  sendRaw: (e: any) => void
) {
  const responseCompletionState = new Map<
    string,
    {
      textDone: boolean;
      audioDone: boolean;
      hasAudio: boolean; // Флаг: используется ли аудио в этом ответе
    }
  >();

  const checkAndEmitCompletion = (responseId: string) => {
    const state = responseCompletionState.get(responseId);
    if (!state) return;

    // Эмитим completed только когда:
    // 1. Текст готов И (аудио готово ИЛИ аудио не используется)
    const shouldComplete =
      state.textDone && (state.audioDone || !state.hasAudio);

    if (shouldComplete) {
      responseCompletionState.delete(responseId);

      const consumed = options.hooks?.onAssistantCompleted?.({
        responseId,
        status: 'done',
      });

      if (consumed !== 'consume') {
        emit('assistant:completed', { responseId, status: 'done' });
      }
    }
  };

  return async function route(msg: any) {
    const hooks = options.hooks;
    hooks?.onEvent?.(msg);

    // Обработка создания пользовательского item
    if (msg.type === 'conversation.item.created') {
      const item = msg.item;
      const itemId = item?.id;

      if (item?.role === 'user' && itemId) {
        emit('user:item_started', { itemId });

        const typed = extractInputTextFromItem(item);
        if (typed && String(typed).trim()) {
          emit('user:completed', { itemId, transcript: String(typed) });
        }
      }

      if (item?.role === 'assistant' && itemId) {
        emit('assistant:item_started', { itemId });
      }

      return;
    }

    if (msg.type === 'response.created') {
      const responseId = msg.response?.id || msg.response_id;
      if (responseId) {
        // Проверяем modalities из сессии или ответа
        const modalities = msg.response?.modalities ||
          options.session?.modalities || ['text'];
        const hasAudio =
          Array.isArray(modalities) && modalities.includes('audio');

        responseCompletionState.set(responseId, {
          textDone: false,
          audioDone: !hasAudio, // Если аудио нет, считаем его сразу "завершенным"
          hasAudio,
        });

        emit('assistant:response_started', { responseId });
      }
      return;
    }

    if (
      msg.type === 'response.audio.delta' ||
      msg.type === 'output_audio_buffer.started'
    ) {
      const responseId = msg.response_id;
      if (responseId && responseCompletionState.has(responseId)) {
        const state = responseCompletionState.get(responseId)!;
        state.hasAudio = true;
        state.audioDone = false; // Сбрасываем, так как аудио началось
      }
      return;
    }

    // Текстовые дельты от ассистента
    if (msg.type === 'response.text.delta') {
      const responseId = msg.response_id;
      const delta = msg.delta || '';
      const consumed = hooks?.onAssistantTextDelta?.({
        responseId,
        delta,
        channel: 'output_text',
      });
      if (consumed !== 'consume') {
        emit('assistant:delta', { responseId, delta, channel: 'output_text' });
      }
      return;
    }

    if (msg.type === 'response.output_item.text.delta') {
      const responseId = msg.response_id;
      const delta = msg.delta || '';
      const consumed = hooks?.onAssistantTextDelta?.({
        responseId,
        delta,
        channel: 'output_text',
      });
      if (consumed !== 'consume') {
        emit('assistant:delta', { responseId, delta, channel: 'output_text' });
      }
      return;
    }

    if (msg.type === 'response.audio_transcript.delta') {
      const responseId = msg.response_id;
      const delta = msg.delta || '';
      const consumed = hooks?.onAssistantTextDelta?.({
        responseId,
        delta,
        channel: 'audio_transcript',
      });
      if (consumed !== 'consume') {
        emit('assistant:delta', {
          responseId,
          delta,
          channel: 'audio_transcript',
        });
      }
      return;
    }

    if (msg.type === 'response.output_text.delta') {
      const responseId = msg.response_id;
      const delta = msg.delta || '';
      const consumed = hooks?.onAssistantTextDelta?.({
        responseId,
        delta,
        channel: 'output_text',
      });
      if (consumed !== 'consume') {
        emit('assistant:delta', { responseId, delta, channel: 'output_text' });
      }
      return;
    }

    // Транскрипция пользователя
    if (msg.type === 'conversation.item.input_audio_transcription.delta') {
      const itemId = msg.item_id;
      const delta = msg.delta || '';
      const consumed = hooks?.onUserTranscriptionDelta?.({ itemId, delta });
      if (consumed !== 'consume') {
        emit('user:delta', { itemId, delta });
      }
      return;
    }

    if (msg.type === 'conversation.item.input_audio_transcription.completed') {
      const itemId = msg.item_id;
      const transcript = msg.transcript || '';
      const consumed = hooks?.onUserTranscriptionCompleted?.({
        itemId,
        transcript,
      });
      if (consumed !== 'consume') {
        emit('user:completed', { itemId, transcript });
      }
      return;
    }

    if (msg.type === 'conversation.item.input_audio_transcription.failed') {
      const itemId = msg.item_id;
      emit('user:failed', { itemId, error: msg.error });
      return;
    }

    if (msg.type === 'conversation.item.truncated') {
      const itemId = msg.item_id || msg.item?.id;
      emit('user:truncated', { itemId });
      return;
    }

    if (
      msg.type === 'response.text.done' ||
      msg.type === 'response.output_item.text.done' ||
      msg.type === 'response.audio_transcript.done' ||
      msg.type === 'response.output_text.done'
    ) {
      const responseId = msg.response_id;

      if (responseCompletionState.has(responseId)) {
        const state = responseCompletionState.get(responseId)!;
        state.textDone = true;
        checkAndEmitCompletion(responseId);
      } else {
        // Если нет в state (старый response или что-то пошло не так) - эмитим как обычно
        const consumed = hooks?.onAssistantCompleted?.({
          responseId,
          status: 'done',
        });
        if (consumed !== 'consume') {
          emit('assistant:completed', { responseId, status: 'done' });
        }
      }
      return;
    }

    if (msg.type === 'output_audio_buffer.stopped') {
      const responseId = msg.response_id;

      if (responseId && responseCompletionState.has(responseId)) {
        const state = responseCompletionState.get(responseId)!;
        state.audioDone = true;
        checkAndEmitCompletion(responseId);
      }

      // Эмитим специальное событие для middleware
      emit('output_audio_buffer.stopped', {});
      return;
    }

    if (msg.type === 'output_audio_buffer.cleared') {
      const responseId = msg.response_id;

      if (responseId && responseCompletionState.has(responseId)) {
        const state = responseCompletionState.get(responseId)!;
        state.audioDone = true;
        checkAndEmitCompletion(responseId);
      }

      emit('output_audio_buffer.cleared', {});
      return;
    }

    // Общие события завершения/отмены
    if (msg.type === 'response.done' || msg.type === 'response.completed') {
      const responseId = msg.response_id || msg.response?.id;

      if (responseCompletionState.has(responseId)) {
        // Форсируем завершение, даже если аудио не закончилось
        // (response.done означает, что сервер закончил генерацию)
        responseCompletionState.delete(responseId);
      }

      const consumed = hooks?.onAssistantCompleted?.({
        responseId,
        status: 'done',
      });
      if (consumed !== 'consume') {
        emit('assistant:completed', { responseId, status: 'done' });
      }
      return;
    }

    if (msg.type === 'response.cancelled' || msg.type === 'response.canceled') {
      const responseId = msg.response_id || msg.response?.id;
      responseCompletionState.delete(responseId); // Очищаем state

      const consumed = hooks?.onAssistantCompleted?.({
        responseId,
        status: 'canceled',
      });
      if (consumed !== 'consume') {
        emit('assistant:completed', { responseId, status: 'canceled' });
      }
      return;
    }

    // Вызовы инструментов
    if (msg.type === 'response.function_call_arguments.delta') {
      const prev = functionArgsBuffer.get(msg.call_id) || '';
      functionArgsBuffer.set(msg.call_id, prev + (msg.delta || ''));
      emit('tool:call_delta', {
        call_id: msg.call_id,
        name: msg.name,
        delta: msg.delta || '',
      });
      return;
    }

    if (msg.type === 'response.function_call_arguments.done') {
      try {
        const argsStr = functionArgsBuffer.get(msg.call_id) || '{}';
        functionArgsBuffer.delete(msg.call_id);
        const args = JSON.parse(argsStr);

        emit('tool:call_done', { call_id: msg.call_id, name: msg.name, args });

        if (options.hooks?.onToolCall) {
          const output = await options.hooks.onToolCall({
            name: msg.name,
            args,
            call_id: msg.call_id,
          });
          if (output !== undefined) {
            sendRaw({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: msg.call_id,
                output: JSON.stringify(output),
              },
            });
            sendRaw({ type: 'response.create' });
          }
        }
      } catch (e) {
        emit('error', { scope: 'tool', error: e });
      }
      return;
    }

    // Серверные ошибки
    if (msg.type === 'error') {
      emit('error', { scope: 'server', error: msg.error });
      return;
    }

    // Логирование необработанных событий
    if (options.logger?.debug) {
      const knownTypes = [
        'session.created',
        'session.updated',
        'input_audio_buffer.committed',
        'input_audio_buffer.cleared',
        'input_audio_buffer.speech_started',
        'input_audio_buffer.speech_stopped',
        'output_audio_buffer.started',
        'rate_limits.updated',
        'response.audio.delta', // Добавлено
        'response.audio.done', // Добавлено
      ];
      if (!knownTypes.includes(msg.type)) {
        options.logger.debug(`[Router] Unhandled event: ${msg.type}`, msg);
      }
    }
  };
}
