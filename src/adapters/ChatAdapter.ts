// src/adapters/ChatAdapter.ts
import {
  ChatAdapterOptions,
  ChatMsg,
} from '@react-native-openai-realtime/types';
import { RealtimeClientClass } from '@react-native-openai-realtime/components';
/**
 * Без дублирования: только подписка на встроенный ChatStore клиента.
 * Если chatStore отключён — возвращаем noop и ничего не делаем.
 */
export function attachChatAdapter(
  client: RealtimeClientClass, // RealtimeClientClass
  setChat: React.Dispatch<React.SetStateAction<ChatMsg[]>>,
  _opts?: ChatAdapterOptions
) {
  try {
    const initial =
      typeof client?.getChat === 'function' ? client.getChat() : [];
    if (Array.isArray(initial)) {
      setChat(initial);
    }
  } catch {
    // no-op
  }

  if (typeof client?.onChatUpdate === 'function') {
    const unsub = client.onChatUpdate((chat: ChatMsg[]) => setChat(chat));
    return () => {
      try {
        unsub?.();
      } catch {}
    };
  }

  // Fallback: если встроенного ChatStore нет — ничего не делаем
  return () => {};
}
