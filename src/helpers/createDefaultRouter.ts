import type { RealtimeClientOptions } from '../types';

type Emitter = (type: string, payload?: any) => void;

export function createDefaultRouter(
  emit: Emitter,
  options: RealtimeClientOptions,
  functionArgsBuffer: Map<string, string>,
  sendRaw: (e: any) => void
) {
  return async function route(msg: any) {
    const hooks = options.hooks;

    // User created
    if (msg.type === 'conversation.item.created' && msg.item?.role === 'user') {
      const itemId = msg.item.id;
      if (itemId) {
        emit('user:item_started', { itemId });
      }
      return;
    }

    // Assistant created
    if (msg.type === 'response.created') {
      const responseId = msg.response?.id || msg.response_id;
      if (responseId) {
        emit('assistant:response_started', { responseId });
      }
      return;
    }

    // User transcription
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

    // Assistant deltas/completed/canceled
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

    if (msg.type === 'response.completed') {
      const responseId = msg.response_id || msg.response?.id;
      const consumed = hooks?.onAssistantCompleted?.({
        responseId,
        status: 'done',
      });
      if (consumed !== 'consume') {
        emit('assistant:completed', { responseId, status: 'done' });
      }
      return;
    }

    if (msg.type === 'response.canceled') {
      const responseId = msg.response_id || msg.response?.id;
      const consumed = hooks?.onAssistantCompleted?.({
        responseId,
        status: 'canceled',
      });
      if (consumed !== 'consume') {
        emit('assistant:completed', { responseId, status: 'canceled' });
      }
      return;
    }

    if (msg.type === 'response.output_text.done') {
      const responseId = msg.response_id || msg.response?.id;
      const consumed = hooks?.onAssistantCompleted?.({
        responseId,
        status: 'done',
      });
      if (consumed !== 'consume') {
        emit('assistant:completed', { responseId, status: 'done' });
      }
      return;
    }

    if (msg.type === 'response.audio_transcript.done') {
      const responseId = msg.response_id;
      const consumed = hooks?.onAssistantCompleted?.({
        responseId,
        status: 'done',
      });
      if (consumed !== 'consume') {
        emit('assistant:completed', { responseId, status: 'done' });
      }
      return;
    }

    // Tools
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

    if (msg.type === 'error') {
      emit('error', { scope: 'server', error: msg.error });
      options.hooks?.onError?.(msg.error);
      return;
    }

    options.hooks?.onEvent?.(msg);
  };
}
