import { EventRouter } from '../src/managers/index';

test('EventRouter incoming middleware stop', async () => {
  const options: any = { middleware: { incoming: [() => 'stop'] }, hooks: {} };
  const r = new EventRouter(options as any, jest.fn() as any, {} as any);
  await r.processIncomingMessage({ type: 'response.completed' } as any);
  // нет исключений — ок
});

test('EventRouter incoming modify event', async () => {
  const logs: any[] = [];
  const options: any = {
    middleware: {
      incoming: [({ event }: any) => ({ ...event, modified: true })],
    },
    hooks: { onEvent: (evt: any) => logs.push(evt) },
  };
  const r = new EventRouter(options as any, jest.fn() as any, {} as any);
  await r.processIncomingMessage({
    type: 'conversation.item.created',
    item: { role: 'user', id: 'u1' },
  } as any);
  expect(logs.length).toBe(1);
});
