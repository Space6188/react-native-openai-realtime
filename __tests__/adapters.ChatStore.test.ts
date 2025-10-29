import { ChatStore } from '../src/adapters/ChatStore';

test('ChatStore user and assistant flows with buffers', () => {
  const store = new ChatStore({
    isMeaningfulText: (t: string) => !!t.trim(),
    userAddOnDelta: true,
    assistantAddOnDelta: false,
  } as any);
  const updates: any[] = [];
  const unsub = store.subscribe((c: any) => updates.push(c));
  store.startUser('u1');
  store.putDelta('user', 'u1', 'hello');
  store.finalize('user', 'u1', 'done', 'hello');

  store.startAssistant('r1');
  store.putDelta('assistant', 'r1', 'hi'); // addOnDelta=false, буфер
  store.finalize('assistant', 'r1', 'done'); // финализируем пустым -> удалится как неосмысленное
  const last = updates[updates.length - 1];
  expect(last.some((m: any) => m.itemId === 'u1')).toBe(true);
  unsub();
});
