import { attachChatAdapter } from '../src/adapters/ChatAdapter';

test('attachChatAdapter subscribes if available', () => {
  const client: any = {
    getChat: () => [],
    onChatUpdate: (cb: any) => {
      cb([{ id: '1' }]);
      return () => {};
    },
  };
  const setChat = jest.fn();
  const unsub = attachChatAdapter(client as any, setChat, {} as any);
  expect(setChat).toHaveBeenCalledWith([{ id: '1' }]);
  unsub();
});
