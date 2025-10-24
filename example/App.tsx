// example/FullDemo.tsx
import {useMemo} from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import {RealTimeClient} from '@react-native-openai-realtime/components/RealtimeClientClass'; // или откуда экспортируешь
import type {
  RealtimeClientOptions,
  ChatMsg,
} from '@react-native-openai-realtime/types';
import {useRealtime} from '@react-native-openai-realtime/context/RealtimeContext';

const SERVER_BASE = 'http://localhost:8787';

// Более "умный" предикат осмысленности.
// Отсекает пустое, чистую пунктуацию/эмодзи, короткие междометия.
function isMeaningfulText(t: string): boolean {
  if (!t) {
    return false;
  }
  const s = t.replace(/\p{Z}+/gu, ' ').trim(); // нормализуем пробелы (unicode)
  if (!s) {
    return false;
  }

  // убрать всё, кроме букв/цифр — осталось ли хоть что-то "содержательное"?
  const lettersDigits = s.replace(/[^\p{L}\p{N}]+/gu, '');
  if (lettersDigits.length < 2) {
    return false;
  }

  // короткие "междометия" и шум
  if (
    /^(эм+|мм+|ээ+|угу+|ага+|uh+|um+|er+|h+mm+|hm+|\.+|…+|—+|-+|!+|\?+)$/iu.test(
      s,
    )
  ) {
    return false;
  }
  return true;
}

// Входящий middleware — пример:
// 1) съедаем неосмысленные крошечные дельты ассистента, чтобы не моргал "…"
// 2) можем модифицировать ивент (вернув новый объект)
const incomingFilters = [
  async ({event}: any) => {
    if (
      event?.type === 'response.output_text.delta' ||
      event?.type === 'response.audio_transcript.delta'
    ) {
      const delta = event.delta || '';
      // если дельта не осмыслена и очень короткая — съедаем
      if (!isMeaningfulText(delta) && delta.length < 2) {
        return 'stop';
      }
    }
    return;
  },
  // пример трансформа: добавим свой "канал" в метаданные для отладки
  ({event}: any) => {
    if (event && typeof event === 'object') {
      return {...event, _source: 'incoming-mw'};
    }
    return;
  },
];

// Исходящий middleware — пример:
// 1) для response.create подставим модальности по умолчанию, если не указаны
// 2) логгер исходящих событий (или A/B-теги)
const outgoingFilters = [
  (event: any) => {
    if (event?.type === 'response.create') {
      const resp = event.response ?? {};
      if (!resp.modalities || resp.modalities.length === 0) {
        event = {...event, response: {...resp, modalities: ['audio', 'text']}};
      }
    }
    return event;
  },
  (event: any) => {
    // консоль для примера (в проде можно свой logger)
    // console.log('[OUT]', event?.type);
    return event;
  },
];

function ChatUI() {
  const {
    chat,
    isConnected,
    isConnecting,
    connect,
    disconnect,
    sendResponseStrict,
  } = useRealtime();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Realtime — Full Example</Text>
      </View>

      <ScrollView contentContainerStyle={styles.chat}>
        {[...chat]
          .sort((a: ChatMsg, b: ChatMsg) => a.ts - b.ts)
          .map((m: ChatMsg) => (
            <View
              key={m.id}
              style={[
                styles.bubble,
                m.role === 'assistant' ? styles.left : styles.right,
                m.status === 'canceled' && styles.bubbleCanceled,
              ]}>
              <Text style={styles.role}>
                {m.role === 'assistant' ? 'Ассистент' : 'Вы'}
              </Text>
              <Text style={styles.text}>{m.text}</Text>
              {m.status === 'streaming' && (
                <Text style={styles.hint}>печатает…</Text>
              )}
              {m.status === 'canceled' && (
                <Text style={styles.hint}>прервано</Text>
              )}
            </View>
          ))}
      </ScrollView>

      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.btn, isConnected && styles.btnRed]}
          onPress={isConnected ? disconnect : connect}
          disabled={isConnecting}>
          <Text style={styles.btnText}>
            {isConnecting
              ? 'Подключение...'
              : isConnected
                ? 'Отключить'
                : 'Подключить'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnAlt]}
          onPress={() =>
            sendResponseStrict?.({
              instructions:
                'Скажи одно короткое предложение о том, что ты умеешь.',
              modalities: ['text'],
            })
          }
          disabled={!isConnected}>
          <Text style={styles.btnText}>Спросить текстом</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

export default function FullDemo() {
  const options: RealtimeClientOptions = useMemo(
    () => ({
      tokenProvider: async () => {
        const r = await fetch(`${SERVER_BASE}/realtime/session`);
        if (!r.ok) {
          throw new Error(`Token fetch failed: ${r.status}`);
        }
        const j = await r.json();
        return j.client_secret.value;
      },

      // Сессия: VAD+STT+модальности
      session: {
        input_audio_transcription: {
          model: 'gpt-4o-mini-transcribe',
          language: 'ru',
        },
        modalities: ['audio', 'text'],
        // voice здесь можно не повторять — он авто-переносится из options.voice
      },

      // Глобальная политика осмысленности (используем в middleware/хуках)
      policy: {
        isMeaningfulText,
      },

      // Встроенный чат: включен, правило осмысленности — такое же как глобально
      chat: {
        enabled: true,
        isMeaningfulText,
      },

      // Автоконфиг в onopen: session.update + приветствие
      autoSessionUpdate: true,
      greet: {
        enabled: true,
        response: {
          instructions:
            'Привет! Я голосовой ассистент. Спросите о подборе специалиста.',
          modalities: ['audio', 'text'],
        },
      },

      // Хуки
      hooks: {
        // onAssistantTextDelta: ({responseId, delta, channel}) => {
        //   console.log('AI+', channel, delta, responseId);
        // },
        // onAssistantCompleted: ({responseId, status}) => {
        //   console.log('AI done:', responseId, status);
        // },
        // onUserTranscriptionDelta: ({itemId, delta}) => {
        //   console.log('USER+', delta, itemId);
        // },
        onToolCall: async ({name, args}) => {
          if (name !== 'search_professionals') {
            return;
          }
          // Пример: дергаем ваш бэкенд
          const resp = await fetch(`${SERVER_BASE}/api/search`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(args),
          });
          const data = await resp.json();
          // вернем объект — клиент сам отправит function_call_output и запросит следующий ответ
          return {
            count: (data.items || []).length,
            examples: (data.items || [])
              .slice(0, 3)
              .map((x: any) => ({id: x.id, name: x.name, years: x.years})),
          };
        },
        onError: e => {
          console.warn('Realtime error:', e);
        },
      },

      // Middleware
      middleware: {
        incoming: incomingFilters,
        outgoing: outgoingFilters,
      },

      // Логгер (по желанию)
      logger: {
        info: (...a) => console.log('[INFO]', ...a),
        debug: (...a) => console.log('[DEBUG]', ...a),
        warn: (...a) => console.log('[WARN]', ...a),
        error: (...a) => console.log('[ERROR]', ...a),
      },
    }),
    [],
  );

  return (
    <RealTimeClient
      options={options}
      autoConnect={false} // автоконнект выключим — кнопкой будем управлять
      attachChat={true} // подключаем ChatAdapter, чат придёт в useRealtime().chat
    >
      <ChatUI />
    </RealTimeClient>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#f5f5f5'},
  header: {
    backgroundColor: '#fff',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: {fontSize: 22, fontWeight: '700'},

  chat: {padding: 12},
  bubble: {maxWidth: '85%', padding: 10, borderRadius: 10, marginBottom: 8},
  left: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eee',
  },
  right: {alignSelf: 'flex-end', backgroundColor: '#DCF8C6'},
  role: {fontSize: 10, color: '#888', marginBottom: 4},
  text: {fontSize: 14, color: '#111'},
  hint: {fontSize: 10, color: '#999', marginTop: 4},
  bubbleCanceled: {opacity: 0.6},

  controls: {
    padding: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
    gap: 10,
  },
  btn: {
    backgroundColor: '#2196F3',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnRed: {backgroundColor: '#f44336'},
  btnAlt: {backgroundColor: '#5C6BC0'},
  btnText: {color: '#fff', fontWeight: '700'},

  voiceRow: {flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8},
  voiceLabel: {fontWeight: '600'},
  voiceChips: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#bbb',
  },
  chipActive: {backgroundColor: '#2196F3', borderColor: '#2196F3'},
  chipText: {color: '#333'},
  chipTextActive: {color: '#fff'},
});
