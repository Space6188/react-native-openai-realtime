import type { ChatMsg } from '../types';

type Side = 'user' | 'assistant';

export type ChatAdapterOptions = {
  isMeaningfulText?: (text: string) => boolean;
};

export function attachChatAdapter(
  client: any,
  setChat: React.Dispatch<React.SetStateAction<ChatMsg[]>>,
  opts?: ChatAdapterOptions
) {
  const isMeaningful = opts?.isMeaningfulText ?? ((t: string) => !!t.trim());

  const seqRef = { current: 0 };
  const userOrderRef = new Map<string, number>();
  const respOrderRef = new Map<string, number>();
  const userState = new Map<string, { inChat: boolean; hasText: boolean }>();
  const assistantState = new Map<
    string,
    { inChat: boolean; hasText: boolean }
  >();

  const orderBySide: Record<Side, Map<string, number>> = {
    user: userOrderRef,
    assistant: respOrderRef,
  };
  const stateBySide: Record<
    Side,
    Map<string, { inChat: boolean; hasText: boolean }>
  > = { user: userState, assistant: assistantState };

  function putDelta(side: Side, id: string, delta: string) {
    if (!id || !delta) {
      return;
    }
    const store = stateBySide[side];
    const st = store.get(id) || { inChat: false, hasText: false };
    const ts0 = orderBySide[side].get(id) ?? Date.now();

    if (!st.inChat) {
      setChat((prev) => [
        ...prev,
        {
          id,
          itemId: side === 'user' ? id : undefined,
          responseId: side === 'assistant' ? id : undefined,
          role: side,
          text: delta,
          ts: ts0,
          status: 'streaming',
        },
      ]);
      st.inChat = true;
    } else {
      setChat((prev) =>
        prev.map((m) => {
          const match = side === 'user' ? m.itemId === id : m.responseId === id;
          return match ? { ...m, text: (m.text || '') + delta } : m;
        })
      );
    }
    store.set(id, { ...st, hasText: true });
  }

  function finalize(
    side: Side,
    id: string,
    status: 'done' | 'canceled',
    finalText?: string
  ) {
    const store = stateBySide[side];
    store.delete(id);

    setChat((prev) => {
      const idx = prev.findIndex((m) =>
        side === 'user' ? m.itemId === id : m.responseId === id
      );
      if (idx === -1) {
        if (side === 'user' && finalText && isMeaningful(finalText)) {
          const ts0 = orderBySide[side].get(id) ?? Date.now();
          return [
            ...prev,
            {
              id,
              itemId: id,
              role: 'user',
              text: finalText,
              ts: ts0,
              status: 'done',
            },
          ];
        }
        return prev;
      }
      const msg = prev[idx];
      const text = finalText ?? msg?.text ?? '';
      if (!isMeaningful(text)) {
        const copy = [...prev];
        copy.splice(idx, 1);
        return copy;
      }
      const copy = [...prev];
      copy[idx] = { ...msg!, text, status };
      return copy;
    });
  }

  const off: Array<() => void> = [];
  off.push(
    client.on('user:item_started', ({ itemId }: any) => {
      userState.set(itemId, { inChat: false, hasText: false });
      userOrderRef.set(itemId, ++seqRef.current);
    })
  );
  off.push(
    client.on('assistant:response_started', ({ responseId }: any) => {
      assistantState.set(responseId, { inChat: false, hasText: false });
      respOrderRef.set(responseId, ++seqRef.current);
    })
  );
  off.push(
    client.on('user:delta', ({ itemId, delta }: any) =>
      putDelta('user', itemId, delta)
    )
  );
  off.push(
    client.on('user:completed', ({ itemId, transcript }: any) =>
      finalize('user', itemId, 'done', transcript)
    )
  );
  off.push(
    client.on('user:failed', ({ itemId }: any) =>
      finalize('user', itemId, 'done')
    )
  );
  off.push(
    client.on('user:truncated', ({ itemId }: any) =>
      finalize('user', itemId, 'done')
    )
  );
  off.push(
    client.on('assistant:delta', ({ responseId, delta }: any) =>
      putDelta('assistant', responseId, delta)
    )
  );
  off.push(
    client.on('assistant:completed', ({ responseId, status }: any) =>
      finalize('assistant', responseId, status)
    )
  );

  return () => {
    off.forEach((fn) => fn());
    userState.clear();
    assistantState.clear();
    userOrderRef.clear();
    respOrderRef.clear();
  };
}
