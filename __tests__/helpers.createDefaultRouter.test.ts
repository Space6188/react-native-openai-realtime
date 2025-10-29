import { createDefaultRouter } from '../src/helpers/index';

function make(hooks = {}) {
  const emitted: Array<[string, any]> = [];
  const emit = (t: string, p?: any) => emitted.push([t, p]);
  const options: any = { hooks: { onEvent: jest.fn(), ...hooks } };
  const buf = new Map<string, string>();
  const sendRaw = jest.fn();
  return {
    route: createDefaultRouter(emit, options, buf, sendRaw),
    emitted,
    options,
    sendRaw,
  };
}

test('routes user transcription delta', async () => {
  const { route, emitted, options } = make();
  await route({
    type: 'conversation.item.input_audio_transcription.delta',
    item_id: 'u1',
    delta: 'hi',
  } as any);
  expect(options.hooks.onEvent).toHaveBeenCalled();
  expect(emitted).toEqual([['user:delta', { itemId: 'u1', delta: 'hi' }]]);
});

test('routes assistant output text delta and completed', async () => {
  const { route, emitted } = make();
  await route({
    type: 'response.output_text.delta',
    response_id: 'r1',
    delta: 'ok',
  } as any);
  await route({ type: 'response.completed', response_id: 'r1' } as any);
  expect(emitted[0][0]).toBe('assistant:delta');
  expect(emitted[1]).toEqual([
    'assistant:completed',
    { responseId: 'r1', status: 'done' },
  ]);
});

test('handles tool call done and sends outputs', async () => {
  // ✅ Передаем onToolCall, который возвращает результат
  const { route, emitted, sendRaw } = make({
    onToolCall: jest.fn(async () => ({ result: 'ok' })),
  });

  await route({
    type: 'response.function_call_arguments.delta',
    call_id: 'c1',
    delta: '{"a":1}',
    name: 'x',
  });
  await route({
    type: 'response.function_call_arguments.done',
    call_id: 'c1',
    name: 'x',
  });

  expect(emitted.find((e) => e[0] === 'tool:call_done')).toBeTruthy();
  // ✅ Теперь sendRaw будет вызван дважды
  expect(sendRaw).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'conversation.item.create' })
  );
  expect(sendRaw).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'response.create' })
  );
  expect(sendRaw).toHaveBeenCalledTimes(2);
});
