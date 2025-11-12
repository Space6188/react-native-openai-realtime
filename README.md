# react-native-openai-realtime

**Библиотека - готовый каркас для голосового/текстового чата с OpenAI Realtime (WebRTC + DataChannel) в React Native.**

## Содержание

- Введение
- Быстрый старт
- Архитектура
- Lifecycle и инициализация
- ⚠️ КРИТИЧЕСКИ ВАЖНО: Правильная инициализация для переключения режимов
- Компонент RealTimeClient (провайдер)
- Императивный API через ref (RealTimeClientHandle)
- Контекст: RealtimeContextValue
- Хуки
  - useRealtime
  - useSpeechActivity
  - useMicrophoneActivity
  - useSessionOptions
- События: onEvent и удобные client.on(…)
  - Карта входящих событий → «удобные» события
  - Обработка ошибок парсинга JSON
- Middleware (incoming/outgoing)
- Встроенный чат: ChatStore/ChatAdapter/ExtendedChatMsg
  - clearAdded() vs clearChatHistory()
  - Нормализация сообщений
- Отправка сообщений
  - sendRaw
  - response.create / sendResponse / sendResponseStrict
  - response.cancel
  - session.update
  - function_call_output / sendToolOutput
- Сессия (SessionConfig)
  - Модель, голос, модальности
  - Встроенная VAD (turn_detection)
  - Транскрипция аудио (input_audio_transcription)
  - Tools (function calling)
  - Instructions
  - Greet
- Политика «осмысленности»: policy vs chat (isMeaningfulText)
- Статусы и логирование
- Низкоуровневый RealtimeClientClass (для продвинутых)
  - Методы, геттеры, события
  - SuccessHandler / SuccessCallbacks (все)
  - ErrorHandler / ErrorStage / Severity
  - Менеджеры (PeerConnection/Media/DataChannel/MessageSender/OpenAI API)
  - Concurrent Guards (защита от конкурентных вызовов)
- Константы, DEFAULTS и applyDefaults
- Best Practices
  - Эфемерные токены
  - PTT (push-to-talk) ручной буфер
  - Tools: авто-режим vs ручной
  - VAD: тюнинг и fallback
  - Встроенный чат vs ручной чат
  - Аудио-сессия и эхоподавление (InCallManager)
  - GlobalRealtimeProvider с ref и onToolCall
- TypeScript Tips
- Troubleshooting / FAQ

---

## Введение

Библиотека делает за вас всю «тяжелую» работу по Realtime с OpenAI: WebRTC-подключение, SDP-обмен, DataChannel, локальные/удаленные аудио-потоки, DataChannel события, router событий, VAD/речевая активность, инструменты (tools), встроенный адаптируемый чат и простой React-контекст.

---

## Быстрый старт

1. Поднимите простой сервер для эфемерных токенов (Node/Express). Он будет ходить к OpenAI и создавать Realtime-сессию:

```ts
// server/index.ts
app.get('/realtime/session', async (_req, res) => {
  const r = await fetch('https://api.openai.com/v1/realtime/sessions', { ... });
  const j = await r.json();
  res.json(j); // в ответе есть j.client_secret.value
});
```

2. В RN-приложении оберните UI провайдером и передайте tokenProvider:

```tsx
import {
  RealTimeClient,
  createSpeechActivityMiddleware,
  useSpeechActivity,
} from 'react-native-openai-realtime';

const tokenProvider = async () => {
  const r = await fetch('http://localhost:8787/realtime/session');
  const j = await r.json();
  return j.client_secret.value;
};

export default function App() {
  return (
    <RealTimeClient
      tokenProvider={tokenProvider}
      incomingMiddleware={[createSpeechActivityMiddleware()]}
      session={{
        model: 'gpt-4o-realtime-preview-2024-12-17',
        voice: 'alloy',
        modalities: ['audio', 'text'],
        input_audio_transcription: { model: 'whisper-1', language: 'ru' },
        turn_detection: {
          type: 'server_vad',
          silence_duration_ms: 700,
          threshold: 0.5,
          prefix_padding_ms: 300,
        },
        tools: [
          /* ваш tools spec */
        ],
        instructions: 'Краткие и полезные ответы.',
      }}
      greetEnabled
      greetInstructions="Привет! Я на связи."
      greetModalities={['audio', 'text']}
    >
      <YourScreen />
    </RealTimeClient>
  );
}
```

3. В любом компоненте используйте хук useRealtime и показывайте статус речи:

```tsx
import { useRealtime, useSpeechActivity } from 'react-native-openai-realtime';

function YourScreen() {
  const { status, connect, disconnect, chat, sendRaw, sendResponseStrict } =
    useRealtime();
  const { isUserSpeaking, isAssistantSpeaking } = useSpeechActivity();

  return (
    <View>
      {isUserSpeaking && <Text>🎤 Вы говорите...</Text>}
      {isAssistantSpeaking && <Text>🔊 Ассистент отвечает...</Text>}
      {/* ваш UI */}
    </View>
  );
}
```

---

## Архитектура

- **RealTimeClient** — React-провайдер. Создаёт RealtimeClientClass, подписывается на статусы, создаёт встроенный чат (опционально), прокидывает API в контекст.
- **RealtimeClientClass** — «ядро»: WebRTC с OpenAI, менеджеры Peer/Media/DataChannel/OpenAIApi, router событий, ChatStore.
- **EventRouter** — принимает JSON из DataChannel, обрабатывает middleware и маршрутизирует в «удобные» события (user:_, assistant:_, tool:\*).
- **ChatStore** — построение ленты сообщений из дельт/финишей «пользователь/ассистент».
- **Middleware** — входящие и исходящие перехватчики событий.
- **Хуки** — useRealtime/useSpeechActivity/useMicrophoneActivity.

---

## Lifecycle и инициализация

### Ленивая инициализация клиента

Компонент `RealTimeClient` использует паттерн ленивой инициализации через `ensureClient()`:

- Клиент создается только при первом вызове `connect()` или если `autoConnect={true}`
- Это позволяет обновлять `tokenProvider` до создания клиента
- После создания клиента, `tokenProvider` можно обновить через `client.setTokenProvider()`

### Порядок инициализации

1. **Монтирование компонента** → создание контекста, но клиент еще `null`
2. **Вызов connect()** или **autoConnect={true}** → `ensureClient()` создает клиент
3. **WebRTC подключение**:
   - Получение эфемерного токена через `tokenProvider`
   - Создание RTCPeerConnection
   - getUserMedia для локального потока
   - Создание DataChannel
   - SDP обмен с OpenAI
   - ICE gathering
4. **DataChannel открыт**:
   - Если `autoSessionUpdate={true}` → отправка `session.update`
   - Если `greetEnabled={true}` → отправка приветственного `response.create`
   - Вызов `onOpen(dc)`

> Статус `'connected'` выставляется только тогда, когда и `RTCPeerConnection`, и `DataChannel` становятся готовыми. Для строгой проверки используйте `client.isFullyConnected()` или подписку `onConnectionStateChange`.

### Защита от конкурентных вызовов (Concurrent Guards)

Класс `RealtimeClientClass` защищен от повторных вызовов:

- **connecting** флаг — предотвращает повторный `connect()` во время подключения
- **disconnecting** флаг — предотвращает повторный `disconnect()` во время отключения
- При попытке повторного вызова логируется warning

### Критически важный порядок операций

В методе `connect()` проверка микрофона происходит **ДО** создания `PeerConnection`:

```ts
// ✅ ПРАВИЛЬНЫЙ порядок:
1. Получение токена (tokenProvider)
2. Проверка микрофона (getUserMedia)  // ← ДО создания PC!
3. Создание PeerConnection
4. Добавление треков или recvonly transceiver
```

**Почему это важно:**

- Нельзя добавлять треки в закрытый PeerConnection
- Если микрофон недоступен, создаем recvonly transceiver сразу
- Избегаем ошибок "Cannot add tracks: PeerConnection is closed"

**Логика:**

```ts
// 1. Сначала пытаемся получить микрофон
let localStream = null;
let needsRecvOnlyTransceiver = false;

if (shouldTryMic) {
  try {
    localStream = await this.mediaManager.getUserMedia();
  } catch (e) {
    if (this.options.allowConnectWithoutMic === false) {
      throw e; // Критическая ошибка
    }
    needsRecvOnlyTransceiver = true; // Fallback
  }
}

// 2. ТЕПЕРЬ создаем PeerConnection
const pc = this.peerConnectionManager.create();

// 3. Добавляем треки или transceiver
if (localStream) {
  this.mediaManager.addLocalStreamToPeerConnection(pc, localStream);
} else if (needsRecvOnlyTransceiver) {
  pc.addTransceiver('audio', { direction: 'recvonly' });
}
```

### Примечание о reconnect и ChatStore

После `disconnect()` внутренние подписки `EventRouter` очищаются (`chatWired = false`). При новом `connect()` библиотека **восстанавливает подписки** `ChatStore` (если `chatWired=false`). История чата сохраняется, если `deleteChatHistoryOnDisconnect={false}`.

---

## ⚠️ КРИТИЧЕСКИ ВАЖНО: Правильная инициализация для переключения режимов

### Проблема

Если вы планируете динамически переключаться между текстовым и голосовым режимами, **нельзя** использовать следующую конфигурацию:

```tsx
// ❌ НЕПРАВИЛЬНО для динамического переключения
<RealTimeClient
  session={{
    model: 'gpt-4o-realtime-preview-2024-12-17',
    modalities: ['text'], // ← Только текст
    turn_detection: null, // ← Отключено
    input_audio_transcription: null, // ← Отключено
  }}
/>
```

**Почему это не работает:**

- Отключение `turn_detection` и `input_audio_transcription` на старте требует полной ре-негоциации WebRTC для их включения
- Библиотека не поддерживает создание нового SDP offer "на лету"
- Попытка переключить в voice режим приведет к ошибкам обработки аудио на сервере

---

### ✅ Правильное решение

**Шаг 1:** Всегда передавайте **полную** конфигурацию с VAD и транскрипцией:

```tsx
<RealTimeClient
  tokenProvider={tokenProvider}
  session={{
    model: 'gpt-4o-realtime-preview-2024-12-17',
    voice: 'shimmer',
    modalities: ['audio', 'text'], // ← Включаем оба режима
    turn_detection: {
      // ← Включаем VAD
      type: 'server_vad',
      threshold: 0.6,
      prefix_padding_ms: 200,
      silence_duration_ms: 1200,
    },
    input_audio_transcription: {
      // ← Включаем транскрипцию
      model: 'whisper-1',
    },
    instructions: 'Твои инструкции',
    tools: tools,
  }}
  autoSessionUpdate={true} // ← Важно: автоматическое применение сессии
>
  <YourScreen />
</RealTimeClient>
```

**Шаг 2:** Инициализируйте текстовый режим при монтировании:

```tsx
import { useSessionOptions, useRealtime } from 'react-native-openai-realtime';
import { useEffect } from 'react';

function YourScreen() {
  const { client, status } = useRealtime();
  const { initSession, mode, isModeReady } = useSessionOptions(client!);

  // ✅ КРИТИЧНО: Инициализация текстового режима
  useEffect(() => {
    if (status === 'connected') {
      initSession('text').catch(console.error);
    }
  }, [status, isModeReady]);

  // Теперь можно безопасно переключаться
  const switchToVoice = () => initSession('voice');
  const switchToText = () => initSession('text');

  return (
    <View>
      <Text>Current mode: {mode}</Text>
      <Text>Status: {isModeReady}</Text>
      <Button title="Voice Mode" onPress={switchToVoice} />
      <Button title="Text Mode" onPress={switchToText} />
    </View>
  );
}
```

> Нужно автоматизировать начальную инициализацию? Передайте проп `initializeMode={{ type: 'text' }}` (или `'voice'`) в `RealTimeClient` — провайдер сам вызовет `initSession()` после первого успешного подключения и после удачных переподключений.

---

### Как это работает

1. **При подключении** (`status='connected'`):
   - Сервер получает полную конфигурацию с VAD и транскрипцией
   - WebRTC соединение устанавливается с поддержкой аудио

2. **При вызове `initSession('text')`**:
   - Отправляется `session.update` с `modalities: ['text']`
   - VAD остается активным, но игнорируется
   - Микрофон **не отключается** физически (треки остаются)

3. **При вызове `initSession('voice')`**:
   - Отправляется `session.update` с `modalities: ['audio', 'text']`
   - VAD активируется
   - Включается спикер (InCallManager)
   - Режим переключается без ре-негоциации

---

### Последовательность действий `initSession()`

**Для `initSession('text')`:**

```ts
1. Отмена текущего ответа ассистента (cancelAssistantNow)
2. Отключение удаленных аудио треков (setRemoteTracksEnabled)
3. Отключение микрофона (setMicrophoneEnabled)
4. Остановка InCallManager
5. session.update({ modalities: ['text'], turn_detection: null })
6. Смена внутреннего состояния mode='text'
```

**Для `initSession('voice')`:**

```ts
1. session.update({
     modalities: ['audio', 'text'],
     turn_detection: { type: 'server_vad', ... }
   })
2. Задержка 300ms (применение сессии)
3. Запуск InCallManager (AEC/спикер)
4. Включение удаленных аудио треков
5. Включение микрофона
6. Смена внутреннего состояния mode='voice'
```

---

### ⚠️ Что НЕ НУЖНО делать

**❌ Неправильно:**

```tsx
// НЕ отключайте VAD и транскрипцию в начальной сессии
session={{
  modalities: ['text'],
  turn_detection: null,           // ← Проблема
  input_audio_transcription: null // ← Проблема
}}
```

**❌ Неправильно:**

```tsx
// НЕ используйте autoSessionUpdate={false} без явной инициализации
<RealTimeClient autoSessionUpdate={false} ... />
// Сессия не применится → VAD не будет работать
```

**❌ Неправильно:**

```tsx
// НЕ вызывайте initSession до подключения
useEffect(() => {
  initSession('text'); // ← Ошибка: DataChannel не открыт
}, []);
```

---

### Полный рабочий пример

```tsx
import {
  RealTimeClient,
  useRealtime,
  useSessionOptions,
  useSpeechActivity,
} from 'react-native-openai-realtime';
import { useEffect } from 'react';

// Провайдер с полной конфигурацией
function App() {
  return (
    <RealTimeClient
      tokenProvider={async () => {
        const r = await fetch('http://localhost:8787/realtime/session');
        const j = await r.json();
        return j.client_secret.value;
      }}
      session={{
        model: 'gpt-4o-realtime-preview-2024-12-17',
        voice: 'shimmer',
        modalities: ['audio', 'text'], // ← Оба режима
        turn_detection: {
          // ← VAD включен
          type: 'server_vad',
          threshold: 0.6,
          silence_duration_ms: 1200,
        },
        input_audio_transcription: {
          // ← Транскрипция включена
          model: 'whisper-1',
        },
        instructions: 'Будь полезным ассистентом',
      }}
      autoSessionUpdate={true}
      greetEnabled={false} // Отключаем авто-приветствие
    >
      <ChatScreen />
    </RealTimeClient>
  );
}

// Экран с корректной инициализацией
function ChatScreen() {
  const { client, status, chat } = useRealtime();
  const { isUserSpeaking, isAssistantSpeaking } = useSpeechActivity();

  const {
    initSession,
    mode,
    isModeReady,
    handleSendMessage,
    cancelAssistantNow,
  } = useSessionOptions(client!);

  // ✅ Инициализация текстового режима
  useEffect(() => {
    if (status === 'connected' && isModeReady === 'idle') {
      console.log('Initializing text mode...');
      initSession('text').catch(console.error);
    }
  }, [status, isModeReady]);

  const switchMode = async (newMode: 'text' | 'voice') => {
    try {
      await initSession(newMode);
      console.log(`Switched to ${newMode} mode`);
    } catch (e) {
      console.error('Failed to switch mode:', e);
    }
  };

  return (
    <View>
      {/* Статус */}
      <Text>Connection: {status}</Text>
      <Text>Mode: {mode}</Text>
      <Text>Ready: {isModeReady}</Text>

      {/* Индикаторы */}
      {isUserSpeaking && <Text>🎤 Вы говорите...</Text>}
      {isAssistantSpeaking && <Text>🔊 Ассистент отвечает...</Text>}

      {/* Переключатель режимов */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          title="Text Mode"
          onPress={() => switchMode('text')}
          disabled={mode === 'text' || isModeReady !== 'connected'}
        />
        <Button
          title="Voice Mode"
          onPress={() => switchMode('voice')}
          disabled={mode === 'voice' || isModeReady !== 'connected'}
        />
      </View>

      {/* Отправка текста */}
      {mode === 'text' && (
        <TextInput
          onSubmitEditing={(e) => handleSendMessage(e.nativeEvent.text)}
          placeholder="Введите сообщение..."
        />
      )}

      {/* Отмена */}
      <Button title="Stop Assistant" onPress={cancelAssistantNow} />

      {/* Чат */}
      <FlatList
        data={chat}
        renderItem={({ item }) => (
          <Text>
            {item.role}: {item.text}
          </Text>
        )}
      />
    </View>
  );
}
```

---

### Troubleshooting

**Проблема:** `initSession('voice')` вызывает ошибку "DataChannel not open"

**Решение:** Дождитесь `status='connected'` перед вызовом

```tsx
const switchToVoice = async () => {
  if (status !== 'connected') {
    console.warn('Wait for connection');
    return;
  }
  await initSession('voice');
};
```

---

**Проблема:** После переключения в voice режим сервер не обрабатывает голос

**Решение:** Проверьте, что начальная сессия включает VAD и транскрипцию (см. выше)

---

**Проблема:** `isModeReady` застревает в 'connecting'

**Решение:** Проверьте, что DataChannel открыт и сессия применилась:

```tsx
useEffect(() => {
  const dc = client?.getDataChannel();
  console.log('DC state:', dc?.readyState);
  console.log('PC state:', client?.getPeerConnection()?.connectionState);
}, [client]);
```

---

## Компонент RealTimeClient (провайдер)

Экспорт: `RealTimeClient: FC<RealTimeClientProps>`

Назначение: создаёт и конфигурирует RealtimeClientClass, обеспечивает контекст(useRealtime), можно сразу автоматически подключаться и/или прикрепить встроенный чат.

Поддерживаемые пропсы (основные):

| Prop                            | Тип                                                           | Default                              | Назначение                                                                                             |
| ------------------------------- | ------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| tokenProvider                   | () => Promise<string>                                         | required                             | Возвращает эфемерный токен (client_secret.value).                                                      |
| webrtc                          | { iceServers, dataChannelLabel, offerOptions, configuration } | см. DEFAULTS                         | Настройки WebRTC/ICE/DataChannel.                                                                      |
| media                           | { getUserMedia?: Constraints }                                | audio: true                          | Параметры микрофона/видео для mediaDevices.getUserMedia.                                               |
| session                         | Partial<SessionConfig>                                        | см. DEFAULTS                         | Начальная session.update (модель/голос/модальности/VAD/инструкции/tools).                              |
| autoSessionUpdate               | boolean                                                       | true                                 | При открытии DataChannel автоматически отправлять session.update.                                      |
| greetEnabled                    | boolean                                                       | true                                 | Автоприветствие после подключения.                                                                     |
| greetInstructions               | string                                                        | "Привет! Я на связи и готов помочь." | Текст приветствия.                                                                                     |
| greetModalities                 | Array<'audio' \| 'text'>                                      | ['audio', 'text']                    | Модальности приветствия.                                                                               |
| onOpen                          | (dc) => void                                                  | -                                    | DataChannel открыт.                                                                                    |
| onEvent                         | (evt) => void                                                 | -                                    | Сырые события DataChannel (1:1 с сервером).                                                            |
| onError                         | (errorEvent) => void                                          | -                                    | Ошибки в библиотеке/события error от сервера.                                                          |
| onUserTranscriptionDelta        | ({itemId, delta}) => 'consume' \| void                        | -                                    | Нон-стоп дельты транскрипции пользователя. Верните 'consume', чтобы «съесть» событие.                  |
| onUserTranscriptionCompleted    | ({itemId, transcript}) => 'consume' \| void                   | -                                    | Финал пользовательской транскрипции.                                                                   |
| onAssistantTextDelta            | ({responseId, delta, channel}) => 'consume' \| void           | -                                    | Дельты ассистента: текст и аудио-транскрипт.                                                           |
| onAssistantCompleted            | ({responseId, status}) => 'consume' \| void                   | -                                    | Конец ответа.                                                                                          |
| onToolCall                      | ({ name, args, call_id }) => Promise<any> \| any              | -                                    | Если вернёте значение — по умолчанию отправится function_call_output и начнётся новый response.create. |
| incomingMiddleware              | IncomingMiddleware[]                                          | []                                   | Перехватчики входящих событий.                                                                         |
| outgoingMiddleware              | OutgoingMiddleware[]                                          | []                                   | Перехватчики исходящих событий.                                                                        |
| policyIsMeaningfulText          | (text) => boolean                                             | t => !!t.trim()                      | Глобальная политика «текст осмысленный?».                                                              |
| chatEnabled                     | boolean                                                       | true                                 | Включить встроенный ChatStore.                                                                         |
| chatIsMeaningfulText            | (text) => boolean                                             | -                                    | Политика «осмысленности» именно для чата (перекрывает policy).                                         |
| chatUserAddOnDelta              | boolean                                                       | true                                 | Создавать юзер-сообщение при первой дельте.                                                            |
| chatUserPlaceholderOnStart      | boolean                                                       | false                                | Плейсхолдер на user:item_started.                                                                      |
| chatAssistantAddOnDelta         | boolean                                                       | true                                 | Создавать ассистентское сообщение при первой дельте.                                                   |
| chatAssistantPlaceholderOnStart | boolean                                                       | false                                | Плейсхолдер на response_started.                                                                       |
| **chatInverted**                | **boolean**                                                   | **false**                            | **Инвертировать порядок сообщений в чате (от старых к новым).**                                        |
| deleteChatHistoryOnDisconnect   | boolean                                                       | **true**                             | Очищать историю при disconnect() (по умолчанию true в компоненте, не указан в DEFAULTS).               |
| logger                          | {debug,info,warn,error}                                       | console.\*                           | Логгер.                                                                                                |
| autoConnect                     | boolean                                                       | false                                | Подключиться сразу.                                                                                    |
| attachChat                      | boolean                                                       | true                                 | Прикрепить встроенный чат в контекст.                                                                  |
| allowConnectWithoutMic          | boolean                                                       | true                                 | Разрешить подключение без микрофона (recvonly transceiver).                                            |
| initializeMode                  | { type: 'text' \| 'voice'; options?: Partial<any> }           | -                                    | Автоматически вызвать initSession после первого успешного подключения (и после удачного reconnect).    |
| attemptsToReconnect             | number                                                        | 1                                    | Количество автоматических попыток переподключения при статусе 'error'.                                 |
| onReconnectAttempt              | (attempt: number, max: number) => void                        | -                                    | Коллбек перед каждой попыткой reconnect (счётчик и максимум).                                          |
| onReconnectSuccess              | () => void                                                    | -                                    | Коллбек после успешного восстановления соединения.                                                     |
| onReconnectFailed               | (error: any) => void                                          | -                                    | Коллбек после исчерпания попыток reconnect или необработанной ошибки.                                  |
| children                        | ReactNode или (ctx) => ReactNode                              | -                                    | Если функция — получаете RealtimeContextValue.                                                         |

**Примечания:**

Полный список всех доступных callbacks см. в разделе "SuccessHandler / SuccessCallbacks".

- Компонент `RealTimeClient` принимает все Success callbacks из `RealtimeSuccessCallbacks` (onPeerConnectionCreated, onDataChannelOpen и т.д.). См. раздел "SuccessHandler / SuccessCallbacks" для полного списка всех callbacks.
- **chatInverted** управляет сортировкой в mergedChat: false = новые сверху, true = старые сверху
- Компонент поддерживает `forwardRef` для императивного API (см. раздел "Императивный API через ref")
- `initializeMode` использует внутренний хук `useSessionOptions`: метод `initSession()` будет вызван один раз после первого успешного подключения и повторно после удачного автоматического переподключения.
- При `attemptsToReconnect > 1` компонент автоматически предпринимает повторные `disconnect()` → `connect()` при переходе статуса в `'error'`. Коллбеки `onReconnectAttempt/onReconnectSuccess/onReconnectFailed` помогают отслеживать процесс.

### attachChat (проп)

Управляет подпиской встроенного ChatStore на контекст:

- **attachChat={true}** (по умолчанию) — `ctx.chat` получает обновления от встроенного ChatStore
- **attachChat={false}** — `ctx.chat` остаётся пустым массивом `[]`, но ChatStore продолжает работать внутри клиента

**Когда использовать `attachChat={false}`:**

- Вы строите собственный UI чата через `client.onChatUpdate()` напрямую
- Хотите избежать лишних ре-рендеров контекста
- Используете несколько провайдеров с разными чатами

**Пример:**

```typescript
<RealTimeClient attachChat={false} chatEnabled={true}>
  <MyCustomChat /> {/* ctx.chat будет [], но client.getChat() работает */}
</RealTimeClient>
```

**Важно:** `attachChat` не влияет на работу ChatStore — он продолжает накапливать сообщения, доступные через `client.getChat()`.

### Автопереподключение

Если указать `attemptsToReconnect > 1`, компонент начнёт автоматически восстанавливать соединение при переходе статуса в `'error'`:

- Перед каждой попыткой вызывается `onReconnectAttempt(attempt, maxAttempts)`.
- Последовательность: небольшая пауза → `disconnect()` → пауза → `connect()`.
- При успехе счётчик попыток сбрасывается, вызывается `onReconnectSuccess()`, а флаг `initializeMode` (если задан) будет применён повторно.
- Если все попытки исчерпаны, вызывается `onReconnectFailed(error)` — можно отобразить UI для ручного переподключения.

Ручные вызовы `connect()/disconnect()` не конфликтуют с автоматикой: при успешном ручном подключении счётчик попыток также сбрасывается.

---

## Императивный API через ref (RealTimeClientHandle)

`RealTimeClient` поддерживает `forwardRef` и экспортирует императивный API — удобно вызывать методы вне React‑дерева (например, в `onToolCall`, Portal, глобальных обработчиках).

### TypeScript интерфейс

```ts
export type RealTimeClientHandle = {
  // Статусы/ссылки
  getClient: () => RealtimeClientClass | null;
  getStatus: () =>
    | 'idle'
    | 'connecting'
    | 'connected'
    | 'disconnected'
    | 'error';
  setTokenProvider: (tp: TokenProvider) => void;
  getCurrentMode: () => 'text' | 'voice';
  getModeStatus: () => 'idle' | 'connecting' | 'connected' | 'disconnected';

  // Соединение
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;

  // Микрофон и медиа
  enableMicrophone: () => Promise<void>;
  disableMicrophone: () => Promise<void>;

  // Отправка
  sendRaw: (e: any) => Promise<void> | void;
  sendResponse: (opts?: any) => void;
  sendResponseStrict: (opts: {
    instructions: string;
    modalities?: Array<'audio' | 'text'>;
    conversation?: 'auto' | 'none';
  }) => void;
  updateSession: (patch: Partial<any>) => void;

  // Переключение режимов сессии
  switchToTextMode: (customParams?: Partial<any>) => Promise<void>;
  switchToVoiceMode: (customParams?: Partial<any>) => Promise<void>;

  // Чат (локальные UI-бабблы)
  addMessage: (m: AddableMessage | AddableMessage[]) => string | string[];
  clearAdded: () => void;
  clearChatHistory: () => void;

  // Утилита: следующий корректный ts
  getNextTs: () => number;
};
```

### Мини‑пример

```tsx
import React, { useRef } from 'react';
import {
  RealTimeClient,
  type RealTimeClientHandle,
} from 'react-native-openai-realtime';

export default function App() {
  const rtcRef = useRef<RealTimeClientHandle>(null);

  const addUi = () => {
    rtcRef.current?.addMessage({
      type: 'ui',
      role: 'system',
      kind: 'hint',
      payload: { text: 'Подсказка ✨' },
    });
  };

  return (
    <RealTimeClient ref={rtcRef} tokenProvider={async () => 'EPHEMERAL_TOKEN'}>
      {/* ... */}
    </RealTimeClient>
  );
}
```

### Когда использовать ref vs контекст

- **Контекст/хуки**: реактивный UI (`ctx.chat`, `ctx.status`, `sendResponse` и т. п.) — используйте `useRealtime()` / `useSpeechActivity()` / `useMicrophoneActivity()`
- **ref**: императивные вызовы из `onToolCall` / эффектов / порталов (добавление UI‑сообщений, быстрый `updateSession`, массовые операции)

**Примечания:**

- `ref` — дополнение к контексту (хуки `useRealtime`/`useSpeechActivity`/`useMicrophoneActivity` продолжают работать как раньше)
- `addMessage` через `ref` не отправляет событие на сервер — это локальные UI‑пузырьки

### Управление микрофоном через ref

Методы `enableMicrophone()` и `disableMicrophone()` работают поверх того же `RealtimeClientClass`, что и хук `useSessionOptions`, и выполняют полноценную ре-негоциацию WebRTC.

- `enableMicrophone()` запрашивает `getUserMedia()`, подменяет/создаёт аудио-трек в текущем `RTCPeerConnection`, заново формирует offer и отправляет его в OpenAI. После ответа сервера локальный поток добавляется в соединение, а Success callbacks (`onMicrophonePermissionGranted`, `onLocalStreamSetted` и т.д.) вызываются автоматически.
- `disableMicrophone()` останавливает локальные аудио-треки, переключает аудио-трансивер в `recvonly`, повторно сигнализирует серверу и останавливает локальный поток. Success callbacks (`onHangUpStarted`/`onHangUpDone`) тоже задействуются.
- Обе операции возвращают `Promise<void>` и требуют активного соединения плюс валидный `tokenProvider`. Отлавливайте исключения, чтобы показывать пользователю ошибки/подсказки.
- Если микрофон недоступен и `allowConnectWithoutMic={false}`, `connect()` завершится ошибкой. При `allowConnectWithoutMic={true}` можно подключаться в текстовом режиме и включать микрофон позднее через `enableMicrophone()`.

### getNextTs() — утилита для ручной сортировки

Возвращает следующий корректный `ts` для ручного добавления сообщений:

```typescript
const rtcRef = useRef<RealTimeClientHandle>(null);

// Добавление сообщения с ручным контролем порядка
const addCustomMessage = () => {
  const nextTs = rtcRef.current?.getNextTs() ?? Date.now();

  rtcRef.current?.addMessage({
    type: 'ui',
    kind: 'custom',
    role: 'assistant',
    ts: nextTs, // явный порядок
    payload: { text: 'Custom message' },
  });
};
```

**Когда нужно:**

- Вставка сообщений с гарантированным порядком
- Синхронизация с внешними системами (например, websocket чат)
- Дебаггинг и тестирование сортировки

### Переключение режимов через ref

Методы `switchToTextMode()` и `switchToVoiceMode()` обращаются к тому же механизму, что предоставляет `useSessionOptions`, поэтому их удобно вызывать из любого места, где доступен ref (push-уведомления, глобальные обработчики, Portal).

- `getCurrentMode()` возвращает `'text'` или `'voice'`.
- `getModeStatus()` показывает `'idle' | 'connecting' | 'connected' | 'disconnected'` для текущей инициализации режима.
- Если DataChannel ещё не открыт, метод выбросит исключение. Отлавливайте ошибки и отображайте пользователю подсказку.

**Примечание:** Подробнее о `ts` и `time` см. раздел "Контекст → Нормализация сообщений".

---

## Контекст: RealtimeContextValue

То, что возвращает `useRealtime()`:

| Поле/Метод           | Тип                                                                | Описание                                                                                           |
| -------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| client               | RealtimeClientClass \| null                                        | Ссылка на ядро (низкоуровневые методы/геттеры).                                                    |
| status               | 'idle' \| 'connecting' \| 'connected' \| 'disconnected' \| 'error' | Текущий статус соединения.                                                                         |
| chat                 | ExtendedChatMsg[]                                                  | История чата (встроенный ChatStore + ваши UI-сообщения).                                           |
| connect              | () => Promise<void>                                                | Подключиться.                                                                                      |
| disconnect           | () => Promise<void>                                                | Отключиться.                                                                                       |
| sendResponse         | (opts?) => void                                                    | Обёртка над response.create.                                                                       |
| sendResponseStrict   | ({ instructions, modalities, conversation? }) => void              | Строгая версия response.create.                                                                    |
| updateSession        | (patch) => void                                                    | Отправить session.update (частичное обновление сессии).                                            |
| sendRaw              | (event: any) => void                                               | Отправить «сырое» событие в DataChannel (через middleware).                                        |
| **addMessage**       | **(AddableMessage \| AddableMessage[]) => string \| string[]**     | **Добавить ваши сообщения в локальную ленту. Возвращает ID созданного сообщения (или массив ID).** |
| **clearAdded**       | **() => void**                                                     | **Очистить локальные UI-сообщения (не трогает ChatStore).**                                        |
| **clearChatHistory** | **() => void**                                                     | **Очистить встроенный ChatStore (см. раздел "Встроенный чат").**                                   |
| getNextTs            | () => number                                                       | Следующий порядковый `ts` для ручного добавления сообщений.                                        |

### Нормализация сообщений (addMessage)

Внутри `RealTimeClient` используется метод `normalize()` для обработки входящих сообщений:

- **id** генерируется автоматически (если не указан)
- **ts** выставляется автоматически как монотонная последовательность: `nextTs = max(ts в текущей ленте) + 1`
- **time** всегда проставляется как `Date.now()` для всех типов сообщений (и для `text`, и для `ui`)
- Если `type='text'`, сообщение получает `status: 'done'` (для совместимости с `ChatMsg`)

Это гарантирует стабильный порядок при объединении сообщений `ChatStore` и ваших UI‑сообщений.

### Разница между ts и time

- **ts** (timestamp sequence) — **порядковый номер** для сортировки в ленте. Монотонный счётчик, не привязан к реальному времени.
- **time** — **реальная метка времени** (`Date.now()`) создания сообщения.

**Зачем нужны оба:**

- `ts` — корректная сортировка при объединении `ChatStore` и `addedMessages` (независимо от задержек сети)
- `time` — отображение времени создания в UI (например, "2 минуты назад")

**Пример:**

```typescript
// Сообщения могут приходить не по порядку, но ts гарантирует правильную сортировку
{ id: 'msg1', ts: 100, time: 1704067200000 } // 10:00:00
{ id: 'msg2', ts: 101, time: 1704067199000 } // 09:59:59 (пришло позже, но ts больше)

// После сортировки по ts:
[msg1, msg2] // корректный порядок диалога
```

**В addMessage():** оба поля проставляются автоматически, но можно переопределить `ts` для ручного управления порядком.

### Типы чата:

```ts
// Встроенное сообщение чата (от ChatStore)
type ChatMsg = {
  id: string;
  type: 'text' | 'ui'; // в типе указано 'text' | 'ui'
  role: 'user' | 'assistant';
  text?: string;
  ts: number; // порядковый номер для сортировки
  time: number; // unix timestamp создания сообщения
  status: 'streaming' | 'done' | 'canceled';
  responseId?: string;
  itemId?: string;
};

// Ваше UI-сообщение (добавляемое через addMessage)
type UIChatMsg = {
  id: string;
  type: 'ui';
  role: 'assistant' | 'user' | 'system' | 'tool';
  ts: number; // порядковый номер
  time?: number; // может отсутствовать в UI-сообщениях
  kind: string; // тип вашего UI-сообщения
  payload: any; // любые данные для рендера
};

// Объединенный тип
type ExtendedChatMsg = ChatMsg | UIChatMsg;
```

**Примечание**: `ChatStore` создаёт только сообщения с `type: 'text'`. Значение `'ui'` используется для пользовательских UI-сообщений через `addMessage()`.

**ExtendedChatMsg** объединяет два типа сообщений:

- **ChatMsg** (`type: 'text'`) — сообщения из реального диалога (создаются ChatStore)
- **UIChatMsg** (`type: 'ui'`) — пользовательские UI-элементы (создаются через addMessage)

**Важное различие:**

- **ts** — порядковый номер для корректной сортировки сообщений
- **time** — реальная метка времени создания (`Date.now()`), всегда проставляется автоматически

Это значит, что для простого UI‑баббла достаточно указать `type='ui'` / `kind` / `payload`: порядок (`ts`) и время (`time`) будут корректными без ручной установки.

### Пример добавления UI-сообщения:

```tsx
// Простое UI-уведомление
addMessage({
  type: 'ui',
  kind: 'system_notification',
  role: 'system',
  payload: {
    text: 'Соединение установлено',
    icon: 'checkmark',
    severity: 'success',
  },
});

// Карточка с данными
addMessage({
  type: 'ui',
  kind: 'weather_card',
  role: 'assistant',
  payload: {
    city: 'Киев',
    temp: 22,
    condition: 'Солнечно',
    humidity: 60,
  },
});

// Массовое добавление
const ids = addMessage([
  { type: 'text', text: 'Начинаем...', role: 'system' },
  { type: 'ui', kind: 'loader', payload: { loading: true } },
]);
console.log('Created message IDs:', ids); // ['msg-123', 'msg-124']
```

---

## Хуки

### useRealtime()

Возвращает RealtimeContextValue (см. выше). Используйте в любом компоненте внутри RealTimeClient.

### useSpeechActivity()

Отслеживает активность речи (обновляется createSpeechActivityMiddleware):

Возвращает:

| Поле                 | Тип            | Описание                                              |
| -------------------- | -------------- | ----------------------------------------------------- |
| isUserSpeaking       | boolean        | Пользователь «говорит» (по событиям буфера/дельтам).  |
| isAssistantSpeaking  | boolean        | Ассистент «говорит» (выходной буфер аудио).           |
| inputBuffered        | boolean        | Входной аудио буфер в состоянии «коммита»/активности. |
| outputBuffered       | boolean        | Выходной аудио буфер активен.                         |
| lastUserEventAt      | number \| null | Время последнего пользовательского события.           |
| lastAssistantEventAt | number \| null | Время последнего ассистентского события.              |

Зачем: чтобы строить UI-анимации, индикаторы речи, VU-метры и т.д.

**Пример использования:**

```tsx
import { useSpeechActivity, createSpeechActivityMiddleware } from 'react-native-openai-realtime';

// В провайдере обязательно добавьте middleware
<RealTimeClient
  incomingMiddleware={[createSpeechActivityMiddleware()]}
  // ...
>

// В компоненте
function SpeechIndicator() {
  const { isUserSpeaking, isAssistantSpeaking } = useSpeechActivity();

  return (
    <View>
      {isUserSpeaking && <Text>🎤 Вы говорите...</Text>}
      {isAssistantSpeaking && <Text>🔊 Ассистент отвечает...</Text>}
    </View>
  );
}
```

### useMicrophoneActivity(options?)

Пробует оценить активность микрофона двумя путями: server-события (дельты) и getStats у локального sender (уровень сигнала). Также отслеживает уровень входящего аудио (голос ассистента).

Опции:

| Опция          | Тип                           | Default      | Описание                                                          |
| -------------- | ----------------------------- | ------------ | ----------------------------------------------------------------- |
| client         | RealtimeClientClass           | из контекста | Ядро (для нестандартных сценариев).                               |
| mode           | 'server' \| 'stats' \| 'auto' | 'auto'       | 'server' — по событиям; 'stats' — по audioLevel; 'auto' — гибрид. |
| silenceMs      | number                        | 600          | Таймаут молчания.                                                 |
| levelThreshold | number                        | 0.02         | Порог для stats.                                                  |
| pollInterval   | number                        | 250          | Период опроса getStats.                                           |

Возвращает:

| Поле        | Тип           | Описание                                                                              |
| ----------- | ------------- | ------------------------------------------------------------------------------------- |
| isMicActive | boolean       | Активность микрофона в текущий момент.                                                |
| level       | number (0..1) | Оценка уровня исходящего аудио потока (микрофон пользователя).                        |
| remoteLevel | number (0..1) | Оценка уровня входящего аудио потока (голос ассистента).                              |
| isCapturing | boolean       | true когда микрофон активен и передаёт данные (есть enabled трек со статусом 'live'). |

Зачем: чтобы рисовать индикатор уровней, подсвечивать PTT, детектировать молчание/речь, отслеживать голос ассистента.

**Пример использования:**

```tsx
import { useMicrophoneActivity } from 'react-native-openai-realtime';

function VolumeIndicator() {
  const { isMicActive, level, remoteLevel, isCapturing } =
    useMicrophoneActivity();

  return (
    <View>
      {/* Индикатор микрофона пользователя */}
      <Text>🎤 Mic: {isMicActive ? 'Active' : 'Inactive'}</Text>
      <ProgressBar progress={level} color="blue" />

      {/* Индикатор голоса ассистента */}
      <Text>🔊 Assistant: {remoteLevel > 0.02 ? 'Speaking' : 'Silent'}</Text>
      <ProgressBar progress={remoteLevel} color="green" />

      {/* Статус захвата */}
      <Text>Capturing: {isCapturing ? '✅' : '❌'}</Text>
    </View>
  );
}
```

### useSessionOptions(client)

**Назначение:** Управление режимами работы (voice/text) и манипуляции с сессией.

**Параметры:**

| Параметр | Тип                   | Описание                         |
| -------- | --------------------- | -------------------------------- |
| client   | `RealtimeClientClass` | Экземпляр клиента (обязательный) |

**Возвращаемые методы и состояния:**

| Метод/Поле                   | Тип                                                       | Описание                                               |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| `initSession(mode)`          | `(mode: 'voice' \| 'text') => Promise<void>`              | Инициализация режима после подключения                 |
| `isModeReady`                | `'idle' \| 'connecting' \| 'connected' \| 'disconnected'` | Статус готовности режима                               |
| `mode`                       | `'text' \| 'voice'`                                       | Текущий активный режим                                 |
| `clientReady`                | `boolean`                                                 | Есть валидный клиент (можно дергать initSession/проч.) |
| `cancelAssistantNow`         | `(onComplete?, onFail?) => Promise<void>`                 | Отмена текущего ответа ассистента                      |
| `handleSendMessage`          | `(text: string) => Promise<void>`                         | Отправка текстового сообщения                          |
| `subscribeToAssistantEvents` | `(onAssistantStarted?) => () => void`                     | Подписка на события ассистента                         |

**Пример использования:**

```tsx
import { useSessionOptions, useRealtime } from 'react-native-openai-realtime';
import { useState, useEffect } from 'react';

function ChatScreen() {
  const { client, status } = useRealtime();

  const {
    initSession,
    isModeReady,
    mode,
    cancelAssistantNow,
    handleSendMessage,
    clientReady,
  } = useSessionOptions(client!);

  // ✅ КРИТИЧНО: Инициализация текстового режима при монтировании
  useEffect(() => {
    if (status === 'connected' && clientReady && isModeReady === 'idle') {
      initSession('text').catch(console.error);
    }
  }, [status, clientReady, isModeReady]);

  // Переключение в голосовой режим
  const enableVoice = async () => {
    try {
      await initSession('voice');
    } catch (e) {
      console.error('Failed to enable voice:', e);
    }
  };

  // Переключение в текстовый режим
  const enableText = async () => {
    try {
      await initSession('text');
    } catch (e) {
      console.error('Failed to enable text:', e);
    }
  };

  // Отправка текста
  const sendText = async (text: string) => {
    try {
      await handleSendMessage(text);
    } catch (e) {
      console.error('Failed to send:', e);
    }
  };

  // Прерывание ассистента
  const stopAssistant = async () => {
    await cancelAssistantNow();
  };

  return (
    <View>
      <Text>Mode: {mode}</Text>
      <Text>Ready: {isModeReady}</Text>
      <Button
        title="Voice Mode"
        onPress={enableVoice}
        disabled={mode === 'voice'}
      />
      <Button
        title="Text Mode"
        onPress={enableText}
        disabled={mode === 'text'}
      />
      <Button title="Stop Assistant" onPress={stopAssistant} />
    </View>
  );
}
```

**Внутренняя механика:**

```ts
// initSession('text') последовательность:
1. Отмена текущего ответа ассистента (cancelAssistantNow)
2. Отключение удаленных аудио треков (setRemoteTracksEnabled)
3. Отключение микрофона (setMicrophoneEnabled)
4. Остановка InCallManager
5. session.update({ modalities: ['text'], turn_detection: null })
6. Смена внутреннего состояния mode='text'

// initSession('voice') последовательность:
1. session.update({
     modalities: ['audio', 'text'],
     turn_detection: { type: 'server_vad', ... }
   })
2. Задержка 300ms (применение сессии)
3. Запуск InCallManager (AEC/спикер)
4. Включение удаленных аудио треков
5. Включение микрофона
6. Смена внутреннего состояния mode='voice'
```

**Важно:**

- Дождитесь `clientReady === true` — это значит, что хук получил реальный экземпляр клиента и может управлять сессией.
- Методы асинхронные, обрабатывайте try/catch
- `initSession()` требует активного соединения (status='connected')
- `initSession('text')` не отключает микрофон физически (треки остаются enabled)
- **КРИТИЧНО:** Инициализируйте режим после подключения (см. раздел "Правильная инициализация для переключения режимов")

---

## События: onEvent и client.on(…)

- **onEvent(evt)**: проп RealTimeClient — raw JSON из DataChannel. Хорош для логов и троттлинга.
- **client.on('type', handler)**: «удобные» события, смонтированные на EventRouter.

Поддерживаемые «удобные» типы:

- `user:item_started` — { itemId }
- `user:delta` — { itemId, delta }
- `user:completed` — { itemId, transcript }
- `user:failed` — { itemId, error }
- `user:truncated` — { itemId }

- `assistant:response_started` — { responseId }
- `assistant:delta` — { responseId, delta, channel: 'audio_transcript' | 'output_text' }
- `assistant:completed` — { responseId, status: 'done' | 'canceled' }

- `tool:call_delta` — { call_id, name, delta } — дельты аргументов tool
- `tool:call_done` — { call_id, name, args } — собранные аргументы JSON

- `error` — { scope, error } — ошибки от сервера (realtime)

### Карта входящих onEvent → удобные события:

| Raw event (onEvent.type)                              | Эмит                       | Payload                                            |
| ----------------------------------------------------- | -------------------------- | -------------------------------------------------- |
| conversation.item.created (role=user)                 | user:item_started          | { itemId }                                         |
| conversation.item.created (role=assistant)            | assistant:item_started     | { itemId }                                         |
| conversation.item.input_audio_transcription.delta     | user:delta                 | { itemId, delta }                                  |
| conversation.item.input_audio_transcription.completed | user:completed             | { itemId, transcript }                             |
| conversation.item.input_audio_transcription.failed    | user:failed                | { itemId, error }                                  |
| conversation.item.truncated                           | user:truncated             | { itemId }                                         |
| response.created                                      | assistant:response_started | { responseId }                                     |
| response.text.delta                                   | assistant:delta            | { responseId, delta, channel: 'output_text' }      |
| response.output_item.text.delta                       | assistant:delta            | { responseId, delta, channel: 'output_text' }      |
| response.output_text.delta                            | assistant:delta            | { responseId, delta, channel: 'output_text' }      |
| response.audio_transcript.delta                       | assistant:delta            | { responseId, delta, channel: 'audio_transcript' } |
| response.text.done                                    | assistant:completed        | { responseId, status: 'done' }                     |
| response.output_item.text.done                        | assistant:completed        | { responseId, status: 'done' }                     |
| response.output_text.done                             | assistant:completed        | { responseId, status: 'done' }                     |
| response.completed                                    | assistant:completed        | { responseId, status: 'done' }                     |
| response.canceled                                     | assistant:completed        | { responseId, status: 'canceled' }                 |
| response.audio_transcript.done                        | assistant:completed        | { responseId, status: 'done' }                     |
| response.function_call_arguments.delta                | tool:call_delta            | { call_id, name, delta }                           |
| response.function_call_arguments.done                 | tool:call_done             | { call_id, name, args }                            |
| error                                                 | error                      | { scope: 'server', error }                         |

### Обработка ошибок парсинга JSON

`DataChannelManager` обрабатывает ошибки парсинга входящих сообщений:

- При ошибке парсинга JSON вызывается `errorHandler.handle()` с severity='warning'
- В контекст ошибки включается обрезанный raw текст (до 2000 символов)
- Добавляется hint: 'Failed to JSON.parse DataChannel message'
- Ошибка recoverable (не критическая), соединение продолжает работать

**Примечание:** если `onToolCall` вернёт значение — по умолчанию отправляется `function_call_output` и тут же делается `response.create` (follow-up).

**⚠️ Важно:** Wildcard‑подписки вида `'user:*'` **не поддерживаются**. Подписывайтесь на точные строки:

- `user:item_started` | `user:delta` | `user:completed` | `user:failed` | `user:truncated`
- `assistant:item_started` | `assistant:response_started` | `assistant:delta` | `assistant:completed`
- `tool:call_delta` | `tool:call_done`
- `error`

### Обработка текстовых сообщений (ВАЖНО!)

Библиотека обрабатывает **ВСЕ** типы текстовых дельт от ассистента:

- `response.text.delta` — основной тип для текстовых ответов
- `response.output_item.text.delta` — альтернативный формат
- `response.output_text.delta` — legacy формат
- `response.audio_transcript.delta` — транскрипция голосового ответа

Все они маршрутизируются в одно событие `assistant:delta` с разными `channel`:

- `channel: 'output_text'` — текстовый ответ
- `channel: 'audio_transcript'` — транскрипция аудио

**Обработка typed-ввода пользователя:**

При отправке текстового сообщения через `sendTextMessage()`:

```ts
// Создается conversation item
{
  type: 'conversation.item.created',
  item: {
    role: 'user',
    content: [{ type: 'input_text', text: 'Привет' }]
  }
}

// Router автоматически:
1. Эмитит 'user:item_started' { itemId }
2. Извлекает текст из content[0]
3. Эмитит 'user:completed' { itemId, transcript: 'Привет' }
```

То есть текстовые сообщения пользователя обрабатываются **синхронно** (нет дельт).

---

## Middleware

Два вида:

- **incoming(ctx)** — на входящих событиях до маршрутизации.
- **outgoing(event)** — на исходящих событиях до отправки в DataChannel.

Подписи:

```ts
type MiddlewareCtx = {
  event: any;                // входящее сообщение (можно менять)
  send: (e: any) => Promise<void> | void; // можно послать в канал (например, cancel)
  client: RealtimeClientClass; // ядро для низкоуровневого доступа
};

type IncomingMiddleware =
  (ctx: MiddlewareCtx) => any | 'stop' | null | void | Promise<...>;

type OutgoingMiddleware =
  (event: any) => any | null | 'stop' | Promise<...>;
```

Поведение:

- Верните `'stop'`, чтобы прекратить обработку (не маршрутизировать/не отправлять).
- Верните модифицированный объект — он пойдёт дальше.
- Ничего не вернёте — событие проходит «как есть».

Типичные кейсы:

- **incoming**: дергать setState по audio_buffer событиям, «косметика» дельт, автокоррекция входящих.
- **outgoing**: тримминг пустых input_text, добавление метаданных, блокировка cancel.

### Порядок обработки входящих событий

1. **Incoming middleware** — перехватчики обрабатывают сырое событие
2. **Router (createDefaultRouter)** — маршрутизирует в "удобные" события
3. **hooks.onEvent** — вызывается **внутри router** (после middleware, но до emit)

**Схема:**

```
DataChannel → incoming middleware (может изменить/остановить) → router → onEvent hook → emit('user:*', 'assistant:*', ...) → ваши подписки on()
```

**Пример влияния middleware на onEvent:**

```typescript
incomingMiddleware={[
  ({ event }) => {
    if (event.type === 'response.audio_transcript.delta' && !event.delta.trim()) {
      return 'stop'; // onEvent НЕ вызовется для этого события
    }
  }
]}
```

**Важно:** Если middleware вернёт `'stop'`, событие не дойдёт до router, `onEvent` и ваши подписки `client.on()` не будут вызваны.

### Порядок выполнения и доступ к client

**Важное обновление:** С версии 0.4.2 middleware получают **полный доступ** к клиенту (`RealtimeClientClass`):

```ts
type MiddlewareCtx = {
  event: any; // входящее сообщение
  send: (e: any) => Promise<void>; // отправка в DataChannel
  client: RealtimeClientClass; // ← ПОЛНЫЙ экземпляр класса
};
```

**Схема выполнения:**

```
DataChannel message
  ↓
Incoming Middleware[0]  ← ctx.client доступен
  ↓
Incoming Middleware[1]  ← ctx.client доступен
  ↓
EventRouter (createDefaultRouter)
  ↓
hooks.onEvent()
  ↓
Emit удобные события
  ↓
Ваши client.on() подписки
```

**Важно:** До вызова middleware клиент уже инициализирован, поэтому можно безопасно:

```ts
const myMiddleware: IncomingMiddleware = async ({ event, send, client }) => {
  // ✅ Доступны все методы клиента
  const chat = client.getChat();
  const status = client.getStatus();
  const dc = client.getDataChannel();

  // ✅ Можно отправлять события
  if (event.type === 'user:delta' && chat.length > 100) {
    await send({ type: 'conversation.item.truncate' });
  }

  // ✅ Можно модифицировать событие
  if (event.type === 'response.audio_transcript.delta') {
    return {
      ...event,
      delta: event.delta.toUpperCase(), // Капслок для транскриптов
    };
  }
};
```

---

## Встроенный чат: ChatStore/ChatAdapter/ExtendedChatMsg

- **ChatStore** — отслеживает дельты user/assistant, создаёт/обновляет/финализирует сообщения, фильтрует «пустое» по isMeaningfulText.
- **ChatAdapter** (`attachChatAdapter`) — подписывает внешний `setChat` на обновления встроенного `ChatStore`. Он **не меняет** политику `isMeaningfulText`. Для изменения политики используйте `chatIsMeaningfulText` или `policyIsMeaningfulText` в пропсах `RealTimeClient`.
- **ExtendedChatMsg** — объединяет ChatMsg (type='text') и ваши UI-сообщения (type='ui').

### clearAdded() vs clearChatHistory()

**Важное различие:**

- **clearAdded()** — удаляет только ваши UI-сообщения, добавленные через `addMessage()`. Не трогает встроенный ChatStore.
- **clearChatHistory()** — очищает встроенный ChatStore (user/assistant сообщения из реального диалога). Не трогает ваши UI-сообщения.

```tsx
// Пример использования
const { chat, addMessage, clearAdded, clearChatHistory } = useRealtime();

// Добавляем UI-сообщение
addMessage({ type: 'ui', kind: 'hint', payload: { text: 'Подсказка' } });

// chat теперь содержит: [...chatStoreMessages, uiMessage]

clearAdded(); // Удалит только UI-сообщение
clearChatHistory(); // Удалит только chatStore сообщения
```

### Управление порядком сообщений в чате

Проп `chatInverted` управляет сортировкой сообщений в `mergedChat`:

- **`chatInverted: false`** (по умолчанию) — новые сообщения сверху (нисходящий порядок по `ts`)
- **`chatInverted: true`** — старые сообщения сверху (восходящий порядок по `ts`)

```tsx
<RealTimeClient
  chatInverted={true} // старые сообщения сверху
  // ...
>
  <YourScreen />
</RealTimeClient>
```

**Примечание**: сортировка применяется к объединенному массиву `[...chatStoreMessages, ...addedMessages]` и влияет на порядок отображения в UI.

Опции ChatStore:

| Опция                       | Тип                   | Default    | Описание                                          |
| --------------------------- | --------------------- | ---------- | ------------------------------------------------- |
| isMeaningfulText            | (t:string) => boolean | !!t.trim() | Политика «осмысленности».                         |
| userAddOnDelta              | boolean               | true       | Добавлять юзер-сообщение при 1-й дельте.          |
| userPlaceholderOnStart      | boolean               | false      | Создавать пустышку при user:item_started.         |
| assistantAddOnDelta         | boolean               | true       | Добавлять ассистентское сообщение при 1-й дельте. |
| assistantPlaceholderOnStart | boolean               | false      | Плейсхолдер при response_started.                 |

---

## Отправка сообщений

### sendRaw(event)

Низкоуровневый отправитель. Используется и внутри обёрток. Проходит через outgoingMiddleware.

Популярные события:

- Создать пользовательское текстовое сообщение + запросить ответ:

```ts
await sendRaw({
  type: 'conversation.item.create',
  item: {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text: 'Привет' }],
  },
});
await sendRaw({ type: 'response.create' });
```

- PTT (ручной буфер):

```ts
await sendRaw({ type: 'input_audio_buffer.commit' });
await sendRaw({ type: 'response.create' });
await sendRaw({ type: 'input_audio_buffer.clear' });
```

- Отменить текущий ответ:

```ts
await sendRaw({ type: 'response.cancel' });
```

### sendResponse(opts?)

Обёртка над response.create. **Если opts не переданы** — отправится пустой объект `{}` (сервер использует дефолтные настройки сессии).

```ts
sendResponse({ instructions: 'Скажи тост', modalities: ['audio', 'text'] });

// Без параметров (сервер использует текущую session)
sendResponse();
```

**Отличие от sendResponseStrict():** `instructions` НЕ обязателен, можно вызывать без аргументов.

### sendResponseStrict({ instructions, modalities, conversation? })

Строгая версия с обязательными инструкциями.

**Примеры разных кейсов:**

```ts
// Простой текстовый ответ
sendResponseStrict({
  instructions: 'Объясни квантовую физику простыми словами',
  modalities: ['text'],
});

// Аудио-ответ с контекстом истории
sendResponseStrict({
  instructions: 'Продолжи разговор и ответь на последний вопрос',
  modalities: ['audio', 'text'],
  conversation: 'default',
});

// One-shot вопрос без сохранения в истории
sendResponseStrict({
  instructions: 'Какая погода в Киеве? Ответь одним предложением',
  modalities: ['text'],
  conversation: 'none',
});

// Смена языка ответа
sendResponseStrict({
  instructions: 'Reply in English from now on',
  modalities: ['audio', 'text'],
});
```

**Параметры:**

- **instructions** (обязательный) — инструкции для модели
- **modalities** — массив модальностей ответа: ['audio'], ['text'] или ['audio', 'text']
- **conversation** — 'default' (с историей) или 'none' (без истории)

### sendTextMessage(text, options?)

Отправить текстовое сообщение (используется в `useSessionOptions`):

```ts
client.sendTextMessage('Привет', {
  responseModality: 'text', // 'text' или 'audio'
  instructions: 'Ответь кратко',
  conversation: 'auto', // 'auto' или 'none'
});
```

**Что происходит внутри:**

1. Создается `conversation.item.create` с типом `message`
2. Отправляется `response.create` с указанными параметрами

**Параметры:**

- `text` — текст сообщения
- `options.responseModality` — модальность ответа ('text' или 'audio')
- `options.instructions` — инструкции для модели
- `options.conversation` — 'auto' (с историей) или 'none' (без истории)

**Важно:** По умолчанию `conversation: 'auto'` сохраняет контекст разговора.

### response.cancel

Отменяет текущую генерацию ответа:

```ts
sendRaw({ type: 'response.cancel' });
```

### updateSession(patch)

Частичное обновление session:

```ts
updateSession({
  voice: 'ash',
  turn_detection: {
    type: 'server_vad',
    silence_duration_ms: 800,
    threshold: 0.6,
    prefix_padding_ms: 300,
  },
  modalities: ['text', 'audio'],
  tools: [], // отключить инструменты
});
```

### sendToolOutput(call_id, output)

Ручной вывод результата инструмента:

```ts
client.sendToolOutput(call_id, { temperature: 22, city: 'Kyiv' });
// ВАЖНО: response.create НЕ вызывается автоматически!
client.sendResponse(); // нужно вызвать вручную
```

**Что происходит внутри:**

Метод отправляет событие `conversation.item.create` с типом `function_call_output`:

```ts
sendToolOutput(call_id: string, output: any) {
  this.sendRaw({
    type: 'conversation.item.create',
    item: {
      type: 'function_call_output',
      call_id,
      output: JSON.stringify(output), // output сериализуется в JSON строку
    },
  });
}
```

**Отличие от onToolCall:**

- **onToolCall** (если вернёте значение) → автоматически отправляет `function_call_output` + делает `response.create`
- **sendToolOutput** → только отправляет `function_call_output`, `response.create` нужно вызывать вручную

**Когда использовать:**

- **Ручной контроль** — не возвращайте значение в `onToolCall`, слушайте `tool:call_done` и используйте `sendToolOutput` + `sendResponse()`
- **Автоматический режим** — возвращайте значение в `onToolCall` (библиотека сделает всё сама)

**Пример ручного режима:**

```ts
<RealTimeClient
  onToolCall={async ({ name, args, call_id }) => {
    // Не возвращаем значение — ручной режим
    const result = await callAPI(name, args);
    // Библиотека НЕ отправит function_call_output автоматически
  }}
/>

// Слушаем tool:call_done и отправляем вручную
client.on('tool:call_done', async ({ call_id, name, args }) => {
  const output = await processTool(name, args);
  client.sendToolOutput(call_id, output);
  client.sendResponse(); // вручную инициируем ответ
});
```

**Пример полного компонента:**

```tsx
function MyComponent() {
  const { client } = useRealtime();

  useEffect(() => {
    if (!client) return;

    // Подписываемся на завершение tool call
    const unsubscribe = client.on(
      'tool:call_done',
      async ({ call_id, name, args }) => {
        try {
          // Обрабатываем tool вручную
          const output = await handleTool(name, args);

          // Отправляем результат
          client.sendToolOutput(call_id, output);

          // ВАЖНО: вручную инициируем response.create
          client.sendResponse();
        } catch (error) {
          // Обработка ошибок
          client.sendToolOutput(call_id, { error: error.message });
          client.sendResponse();
        }
      }
    );

    return unsubscribe;
  }, [client]);

  return <View>{/* ваш UI */}</View>;
}
```

---

## Сессия (SessionConfig)

```ts
type SessionConfig = {
  model?: string; // 'gpt-4o-realtime-preview-2024-12-17'
  voice?: VoiceId; // 'alloy' | 'ash' | 'verse' | ...
  modalities?: Array<'audio' | 'text'>; // ['audio','text'] или ['text']
  turn_detection?: {
    type: 'server_vad';
    silence_duration_ms?: number;
    threshold?: number;
    prefix_padding_ms?: number;
  };
  input_audio_transcription?: { model: string; language?: string }; // 'whisper-1' или 'gpt-4o-transcribe'
  tools?: any[]; // Realtime tools spec (проксируется в OpenAI)
  instructions?: string; // системные инструкции
};
```

**Подсказка:** библиотека экспортирует `VOICE_IDS` и тип `VoiceId` — можно строить picker голосов без «ручных» массивов:

```ts
import { VOICE_IDS, type VoiceId } from 'react-native-openai-realtime';

VOICE_IDS.map(v => /* отрисуйте pill и вызовите updateSession({ voice: v as VoiceId }) */);
```

**Формат tools:**

```ts
tools: [
  {
    type: 'function',
    name: 'get_weather',
    description: 'Return weather by city',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
      additionalProperties: false,
    },
  },
];
```

### autoSessionUpdate (проп)

**Назначение:** Автоматически отправляет `session.update` при открытии DataChannel.

- **autoSessionUpdate={true}** (по умолчанию) — библиотека отправляет `session.update` сразу после подключения
- **autoSessionUpdate={false}** — вы управляете сессией вручную через `updateSession()`

**Когда отключать:**

- Динамическая конфигурация сессии (например, выбор модели после подключения)
- Условное применение настроек (разные tools для разных пользователей)
- A/B тестирование параметров VAD

**Пример ручного управления:**

```typescript
<RealTimeClient
  autoSessionUpdate={false}
  session={undefined} // не передаём начальную сессию
  onOpen={async (dc) => {
    const userPrefs = await fetchUserPreferences();
    client.updateSession({
      voice: userPrefs.voice,
      tools: userPrefs.enabledTools,
      turn_detection: userPrefs.vadConfig
    });
  }}
/>
```

**Важно:** Если `autoSessionUpdate={false}`, но `session` передана — она **НЕ** отправится автоматически. Нужно вызвать `updateSession()` вручную.

### Greet (приветствие)

- **greetEnabled** (по умолчанию `true`) — автоприветствие после подключения
- **greetInstructions** — текст приветствия
- **greetModalities** — ['audio','text'] и т.д.

По умолчанию `greetEnabled=true`. При открытии DataChannel отправляется `response.create` с указанным приветствием.

**Важно:** Если `greetEnabled=true`, но `greetInstructions` не заданы, `applyDefaults` подставит дефолтные `instructions` и `modalities` из `DEFAULTS`.

---

## Политика «осмысленности»: policy vs chat

Предикат isMeaningfulText определяет: считать ли текст «содержательным».

- **policyIsMeaningfulText** — глобальный дефолт (используют разные модули).
- **chatIsMeaningfulText** — перекрывает policy только для встроенного чата.

Приоритет: `chat.isMeaningfulText ?? policy.isMeaningfulText ?? (t => !!t.trim())`

Частые сценарии:

- Жёсткий глобальный фильтр, мягкий в чате.
- Отключить встроенный чат и применять политику в своих middleware/хуках.

---

## Статусы и логирование

- **status**: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
- **logger**: { debug, info, warn, error } — можно прокинуть в RealTimeClient.

**Статус 'error' устанавливается при:**

- Критических ошибках (severity='critical') через ErrorHandler
- Провале WebRTC соединения (pc.connectionState='failed')
- Ошибке получения токена (fetch_token)
- Неожиданных исключениях в процессе подключения

**⚠️ ВАЖНО**: тип RealtimeStatus включает зарезервированные статусы ('user_speaking','assistant_speaking'), но они **НЕ АКТИВНЫ** в текущей версии. Для отслеживания речи используйте `useSpeechActivity()` хук.

---

## Низкоуровневый RealtimeClientClass

Конструктор:

```ts
new RealtimeClientClass(
  options: RealtimeClientOptionsBeforePrune,
  successHandler?: SuccessHandler,
  errorHandler?: ErrorHandler
)
```

Методы:

| Метод                                                           | Описание                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| connect()                                                       | Установить WebRTC, сделать SDP-обмен, открыть DataChannel.               |
| disconnect()                                                    | Закрыть DataChannel/Media/Peer, почистить подписки и (по настройке) чат. |
| enableMicrophone()                                              | Включить микрофон и выполнить повторную SDP-негоциацию.                  |
| disableMicrophone()                                             | Отключить микрофон, остановить треки и обновить сессию без аудио.        |
| sendRaw(event)                                                  | Отправить событие (через outgoingMiddleware).                            |
| sendResponse(opts?)                                             | Обёртка над response.create.                                             |
| sendResponseStrict({ instructions, modalities, conversation? }) | Строгая версия response.create.                                          |
| updateSession(patch)                                            | Отправить session.update.                                                |
| sendToolOutput(call_id, output)                                 | Ручной вывод инструмента.                                                |
| setTokenProvider(fn)                                            | Обновить токен-провайдер на лету.                                        |
| on(type, handler)                                               | Подписаться на удобные события (user:_, assistant:_, tool:\*, error).    |
| onConnectionStateChange(fn)                                     | Подписка на смену статуса ('connecting','connected',...).                |
| onChatUpdate(fn)                                                | Подписка на обновления встроенного чата.                                 |
| clearChatHistory()                                              | Очистить историю чата.                                                   |
| isConnected()                                                   | Соединение установлено?                                                  |
| isFullyConnected()                                              | И PeerConnection, и DataChannel в состоянии 'open'.                      |
| getConnectionState()                                            | Текущий connectionState.                                                 |
| getStatus()                                                     | Текущий connectionState (алиас).                                         |
| getPeerConnection()                                             | RTCPeerConnection.                                                       |
| getDataChannel()                                                | RTCDataChannel.                                                          |
| getLocalStream()                                                | MediaStream (локальный).                                                 |
| getRemoteStream()                                               | MediaStream (удалённый).                                                 |
| getChat()                                                       | Текущая история встроенного чат-стора.                                   |

> `isFullyConnected()` отличается от `isConnected()`: метод возвращает `true` только если `PeerConnection` перешёл в `connected`, DataChannel открыт (`readyState === 'open'`) и клиент не находится в процессе соединения.

### Concurrent Guards (защита от конкурентных вызовов)

Класс защищен от повторных вызовов методов подключения/отключения:

- При попытке повторного вызова `connect()` во время подключения — операция будет проигнорирована с предупреждением
- При попытке повторного вызова `disconnect()` во время отключения — операция будет проигнорирована
- Рекомендуется проверять статус соединения через `getStatus()` или `isConnected()` перед вызовом методов

### SuccessHandler / SuccessCallbacks (все)

Используются только с RealtimeClientClass (низкоуровневый сценарий). Позволяют слушать успехи стадий/событий.

**SuccessHandler** принимает два типа коллбеков:

1. **Детализированные коллбеки** из `SuccessCallbacks` — для конкретных событий
2. **Универсальный коллбек** `onSuccess(stage: string, data?: any)` — для любых успешных операций

```ts
type SuccessCallbacks = {
  onHangUpStarted?(): void;
  onHangUpDone?(): void;
  onPeerConnectionCreatingStarted?(): void;
  onPeerConnectionCreated?(pc: RTCPeerConnection): void;
  onRTCPeerConnectionStateChange?(
    state:
      | 'new'
      | 'connecting'
      | 'connected'
      | 'disconnected'
      | 'failed'
      | 'closed'
  ): void;
  onGetUserMediaSetted?(stream: MediaStream): void;
  onLocalStreamSetted?(stream: MediaStream): void;
  onLocalStreamAddedTrack?(track: MediaStreamTrack): void;
  onLocalStreamRemovedTrack?(track: MediaStreamTrack): void;
  onRemoteStreamSetted?(stream: MediaStream): void;
  onDataChannelOpen?(channel: RTCDataChannel): void;
  onDataChannelMessage?(message: any): void;
  onDataChannelClose?(): void;
  onIceGatheringComplete?(): void;
  onIceGatheringTimeout?(): void;
  onIceGatheringStateChange?(state: string): void;
  onMicrophonePermissionGranted?(): void;
  onMicrophonePermissionDenied?(): void;
  onIOSTransceiverSetted?(): void;
};

// Универсальный коллбек
type BaseProps = SuccessCallbacks & {
  onSuccess?: (stage: string, data?: any) => void;
};
```

**Приоритет:** Если для стадии указан детализированный коллбек (например, `onDataChannelOpen`), вызываются **оба**: сначала детализированный, затем универсальный `onSuccess`.

### Пример использования универсального onSuccess

```typescript
const successHandler = new SuccessHandler(
  {
    onDataChannelOpen: (dc) => console.log('DC opened:', dc),
    onPeerConnectionCreated: (pc) => console.log('PC created:', pc),
  },
  (stage, data) => {
    // Универсальный коллбек для всех успешных операций
    console.log(`[SUCCESS] ${stage}`, data);

    // Можно централизованно обрабатывать все успехи
    if (stage === 'ice_gathering_complete') {
      analytics.track('ICE_GATHERING_SUCCESS');
    }

    if (stage === 'data_channel_open') {
      // Вызывается после onDataChannelOpen
      metrics.record('dc_open_time', Date.now() - connectionStartTime);
    }
  }
);

const client = new RealtimeClientClass(options, successHandler);
```

**Примечание:** Универсальный `onSuccess` вызывается для **всех** успешных операций, даже если для стадии есть детализированный коллбек.

### ErrorHandler / ErrorEvent

ErrorHandler вызывает ваш onError при любой ошибке и логирует её.

```ts
type ErrorStage =
  | 'hangup'
  | 'ice_gathering'
  | 'peer_connection'
  | 'microphone_permission'
  | 'remote_stream'
  | 'local_stream'
  | 'data_channel'
  | 'get_user_media'
  | 'ios_transceiver'
  | 'init_peer_connection'
  | 'create_offer'
  | 'set_local_description'
  | 'set_remote_description'
  | 'fetch_token'
  | 'openai_api';

type ErrorSeverity = 'critical' | 'warning' | 'info';

type ErrorEvent = {
  stage: ErrorStage;
  error: Error;
  severity: ErrorSeverity;
  recoverable: boolean;
  timestamp: number;
  context?: Record<string, any>;
};
```

---

## Константы, DEFAULTS и applyDefaults

**DEFAULTS** — значения по умолчанию:

```ts
{
  tokenProvider: async () => throw new Error('tokenProvider is required'),
  webrtc: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ],
    dataChannelLabel: 'oai-events',
    offerOptions: {
      offerToReceiveAudio: true,
      voiceActivityDetection: true,
    },
    configuration: { iceCandidatePoolSize: 10 }
  },
  media: {
    getUserMedia: {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false
    }
  },
  session: {
    model: 'gpt-4o-realtime-preview-2024-12-17',
    voice: 'alloy',
    modalities: ['audio', 'text'],
    input_audio_transcription: { model: 'whisper-1' },
    turn_detection: {
      type: 'server_vad',
      silence_duration_ms: 700,
      prefix_padding_ms: 300,
      threshold: 0.5
    }
  },
  autoSessionUpdate: true,
  greet: {
    enabled: true,
    response: {
      instructions: 'Привет! Я на связи и готов помочь.',
      modalities: ['audio', 'text']
    }
  },
  policy: { isMeaningfulText: (t) => !!t.trim() },
  chat: { enabled: true, isMeaningfulText: (t) => !!t.trim() },
  logger: { debug, info, warn, error: console.* }
}
```

**Важно**:

- `deleteChatHistoryOnDisconnect` НЕ указан в DEFAULTS
- В компоненте `RealTimeClient` значение по умолчанию — `true`
- В классе `RealtimeClientClass` используется `options.deleteChatHistoryOnDisconnect !== false` (т.е. если не указано, считается `true`)

### Особенность deleteChatHistoryOnDisconnect

**Значение по умолчанию зависит от точки входа:**

- **RealTimeClient компонент:** `deleteChatHistoryOnDisconnect = true` (по умолчанию)
- **RealtimeClientClass:** проверка `!== false` (т.е. если не передано, считается `true`)
- **DEFAULTS:** поле отсутствует (не применяется через applyDefaults)

**Логика:**

```typescript
// Компонент (явное значение по умолчанию)
const { deleteChatHistoryOnDisconnect = true } = props;

// Класс (проверка на !== false)
if (this.options.deleteChatHistoryOnDisconnect !== false) {
  chatStore.destroy();
}
```

**Итог:** Если хотите сохранять историю — явно передайте `deleteChatHistoryOnDisconnect={false}` в компонент или `{ deleteChatHistoryOnDisconnect: false }` в класс.

**applyDefaults** — глубокое слияние пользовательских опций (deepMerge) с DEFAULTS.

**Особая логика для greet**: если `greet.enabled=true`, но `greet.response.instructions` не задан — подставляется **полный объект** `greet.response` из DEFAULTS (включая `instructions` и `modalities`):

```ts
// Если greet.enabled=true, но instructions не задан
if (
  merged.greet?.enabled &&
  (!merged.greet.response || !merged.greet.response.instructions)
) {
  merged.greet = {
    enabled: true,
    response: {
      instructions: DEFAULTS.greet!.response!.instructions!,
      modalities: DEFAULTS.greet!.response!.modalities,
    },
  };
}
```

### Утилиты: prune() и deepMerge()

**prune()** — рекурсивно очищает объект от `undefined` значений:

```ts
prune({ a: 1, b: undefined, c: { d: 2, e: undefined } });
// => { a: 1, c: { d: 2 } }
```

- **Массивы не затрагиваются** (проходят "как есть")
- Рекурсивно обрабатывает вложенные объекты
- Удаляет только `undefined`, `null` остается

**deepMerge()** — глубокое слияние объектов:

```ts
deepMerge({ arr: [1, 2], obj: { a: 1 } }, { arr: [3], obj: { b: 2 } });
// => { arr: [3], obj: { a: 1, b: 2 } }
```

- **Массивы заменяются целиком**, а не мержатся
- Объекты мержатся рекурсивно
- Примитивы перезаписываются

---

## Best Practices

### Эфемерные токены

- Никогда не храните OpenAI API Key в клиенте!
- Реализуйте серверный endpoint /realtime/session, который создаёт ephemeral session и возвращает client_secret.value.
- tokenProvider на клиенте обращается к вашему серверу.

### PTT (push-to-talk)

- Для ручного PTT отключите серверный VAD (updateSession({ turn_detection: undefined })).
- В момент отпускания кнопки PTT отправьте:
  - input_audio_buffer.commit
  - response.create
  - input_audio_buffer.clear (опционально)
- Включайте/выключайте локальные треки микрофона через `getLocalStream().getAudioTracks().forEach(t => t.enabled = …)`.

### Tools: авто vs ручной

- **Авто**: onToolCall возвращает output → библиотека отправит function_call_output и сделает response.create.
- **Ручной**: не возвращайте output в onToolCall, а слушайте tool:call_done и используйте client.sendToolOutput(call_id, output) вручную, затем client.sendResponse().

### VAD: тюнинг

- Для серверного VAD: threshold ~0.4–0.6, silence_duration_ms ~600–1000.
- Для детекции без серверных событий используйте useMicrophoneActivity(mode='stats').

### Встроенный чат vs ручной чат

- Встроенный ChatStore покрывает 90% кейсов (стриминг, финализация, пустышки).
- Для полного контроля — chatEnabled={false} и соберите чат через client.on('user:_','assistant:_').

### WebRTC конфигурация

- Если `webrtc.configuration` не передан, библиотека создаёт минимальную конфигурацию с `iceServers` из `webrtc.iceServers` и `iceCandidatePoolSize: 10`.
- Для полного контроля передавайте `webrtc.configuration` явно.

### Работа без микрофона (allowConnectWithoutMic)

Библиотека поддерживает подключение без микрофона:

- **allowConnectWithoutMic={true}** (по умолчанию) — при отсутствии микрофона создается recvonly transceiver
- **allowConnectWithoutMic={false}** — отсутствие микрофона считается критической ошибкой

**Когда использовать:**

- Режим "только прослушивание" (assistant говорит, пользователь не отвечает голосом)
- Тестирование без физического микрофона
- Ограниченные права доступа (корпоративные устройства)

**Пример:**

```tsx
<RealTimeClient
  allowConnectWithoutMic={true}
  session={{
    modalities: ['audio', 'text'], // Получаем аудио, отправляем текст
    turn_detection: null, // VAD не нужен без микрофона
  }}
/>
```

### Автоотключение в фоне

- Компонент `RealTimeClient` автоматически разрывает соединение при переходе приложения в фоновый режим или неактивное состояние.
- При возврате в приложение нужно вызвать `connect()` заново.

### Аудио-сессия и эхоподавление (InCallManager)

Для голосового общения используйте `react-native-incall-manager`, чтобы система включила AEC (Acoustic Echo Cancellation):

- **iOS**: AVAudioSessionCategoryPlayAndRecord + mode=VoiceChat
- **Android**: MODE_IN_COMMUNICATION

**⚠️ Важно:** Не переключайте аудио‑сессию через `expo-av` в состоянии `connected` — это может «сбить» AEC и привести к эху («ассистент слышит сам себя»).

**Пример:**

```ts
import InCallManager from 'react-native-incall-manager';

useEffect(() => {
  if (status === 'connected') {
    InCallManager.start({ media: 'audio' });
    InCallManager.setForceSpeakerphoneOn(true); // маршрут: на динамик (true) или в ухо (false)
  } else {
    InCallManager.stop();
  }
}, [status]);
```

**(Опционально)** Глушение микрофона на время речи ассистента:

```ts
client.on('assistant:response_started', () => {
  const local = client.getLocalStream?.();
  local?.getAudioTracks?.()?.forEach((t) => (t.enabled = false));
});
client.on('assistant:completed', () => {
  const local = client.getLocalStream?.();
  local?.getAudioTracks?.()?.forEach((t) => (t.enabled = true));
});
```

### GlobalRealtimeProvider с ref и onToolCall

Расширенный пример глобального провайдера, который использует `ref` для добавления UI‑сообщений из `onToolCall`. См. раздел "Быстрый старт" для базового примера подключения.

```tsx
import React, { useMemo, useRef } from 'react';
import {
  RealTimeClient,
  type RealTimeClientHandle,
  createSpeechActivityMiddleware,
} from 'react-native-openai-realtime';
import {
  TOOL_ACK_MESSAGES,
  WORKSPACE_INSTRUCTIONS,
  WORKSPACE_TOOLS,
  type WorkspaceToolName,
} from './workspaceScenario';

const SERVER_BASE = 'http://localhost:8787';

const tokenProvider = async () => {
  const response = await fetch(`${SERVER_BASE}/realtime/session`);
  if (!response.ok) {
    throw new Error(`Failed to fetch token: ${response.status}`);
  }
  const json = await response.json();
  return json.client_secret.value;
};

export const GlobalRealtimeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const incomingMiddleware = useMemo(() => [createSpeechActivityMiddleware()], []);
  const rtcRef = useRef<RealTimeClientHandle | null>(null);

  return (
    <RealTimeClient
      ref={rtcRef}
      tokenProvider={tokenProvider}
      initializeMode={{ type: 'text' }}
      session={{
        model: 'gpt-4o-realtime-preview-2024-12-17',
        voice: 'shimmer',
        modalities: ['audio', 'text'],
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.55,
          prefix_padding_ms: 250,
          silence_duration_ms: 900,
        },
        tools: WORKSPACE_TOOLS,
        instructions: WORKSPACE_INSTRUCTIONS,
      }}
      allowConnectWithoutMic
      incomingMiddleware={incomingMiddleware}
      onToolCall={async ({ name, args }) => {
        if (name === 'list_workspaces') {
          return {
            items: [
              { id: 'studio-soho', name: 'Soho Workshop Loft', city: 'New York' },
            ],
          };
        }
        if (name === 'calculate_workspace_quote') {
          return {
            quote_id: `quote-${Date.now()}`,
            subtotal: 420,
            currency: 'USD',
            city: args.city,
          };
        }
        return undefined;
      }}
      onEvent={(event) => {
        if (
          event?.type === 'response.function_call_arguments.done' &&
          event?.name
        ) {
          const example = TOOL_ACK_MESSAGES[event.name as WorkspaceToolName];
          if (example) {
            rtcRef.current?.addMessage({
              type: 'ui',
              role: 'assistant',
              kind: 'acknowledgement_template',
              payload: { tool: event.name, example },
            });
          }
        }
      }}
    >
      {children}
    </RealTimeClient>
  );
};
```

---

## TypeScript Tips

### Типизация middleware

```ts
import type {
  IncomingMiddleware,
  OutgoingMiddleware,
  MiddlewareCtx,
} from 'react-native-openai-realtime';

const myIncomingMiddleware: IncomingMiddleware = async (ctx: MiddlewareCtx) => {
  const { event, send, client } = ctx;

  if (event.type === 'custom') {
    // Модифицируем событие
    return { ...event, processed: true };
  }

  if (event.type === 'skip') {
    return 'stop'; // Блокируем событие
  }

  // Пропускаем как есть
  return;
};

const myOutgoingMiddleware: OutgoingMiddleware = (event: any) => {
  if (!event.type) return 'stop'; // Блокируем невалидные
  return event; // Пропускаем
};
```

### Типизация хуков

```ts
import type {
  RealtimeClientHooks,
  RealtimeContextValue,
} from 'react-native-openai-realtime';

const hooks: Partial<RealtimeClientHooks> = {
  onToolCall: async ({ name, args, call_id }) => {
    // TypeScript знает типы параметров
    if (name === 'get_weather') {
      return { temp: 22, city: args.city };
    }
  },
};

const MyComponent: React.FC = () => {
  const ctx: RealtimeContextValue = useRealtime();
  // TypeScript знает все поля контекста
};
```

### Типизация сообщений чата

```ts
import type { ExtendedChatMsg, ChatMsg, UIChatMsg } from 'react-native-openai-realtime';

function renderMessage(msg: ExtendedChatMsg) {
  if (msg.type === 'text') {
    // TypeScript знает, что это ChatMsg
    const textMsg = msg as ChatMsg;
    return <Text>{textMsg.text}</Text>;
  } else {
    // TypeScript знает, что это UIChatMsg
    const uiMsg = msg as UIChatMsg;
    return <CustomUI kind={uiMsg.kind} payload={uiMsg.payload} />;
  }
}
```

### Типизация ref и использование в onToolCall

```ts
import { useRef } from 'react';
import type { RealTimeClientHandle } from 'react-native-openai-realtime';

const rtcRef = useRef<RealTimeClientHandle | null>(null);

<RealTimeClient
  ref={rtcRef}
  onToolCall={async ({ name, args }) => {
    const data = await callYourApi(name, args);
    rtcRef.current?.addMessage({
      type: 'ui',
      kind: 'tool_result',
      role: 'assistant',
      payload: data
    });
    return data;
  }}
/>
```

---

## Troubleshooting / FAQ

### ⚠️ КРИТИЧНО: В чате нет сообщений

**Самая частая проблема — неверная конфигурация сессии!**

**ОБЯЗАТЕЛЬНАЯ конфигурация для работы транскрипции:**

```tsx
session={{
  model: 'gpt-4o-realtime-preview-2024-12-17',
  voice: 'shimmer',
  modalities: ['audio', 'text'],
  input_audio_transcription: {
    model: 'whisper-1' // Быстрая транскрипция (рекомендуется)
    // или 'gpt-4o-transcribe' // Более точная, но медленнее
    // БЕЗ ЭТОГО НЕ БУДЕТ ТРАНСКРИПЦИИ!
  },
  turn_detection: {
    type: 'server_vad',
    threshold: 0.7,
    prefix_padding_ms: 250,
    silence_duration_ms: 800
  }
}}
```

**Чек‑лист:**

1. ✅ `input_audio_transcription.model` указан (`whisper-1` или `gpt-4o-transcribe`)
2. ✅ `chatEnabled !== false` (по умолчанию `true`)
3. ✅ `attachChat !== false` (по умолчанию `true`)
4. ✅ Микрофон работает (разрешение granted)
5. ✅ Соединение `status='connected'`
6. ✅ Хотя бы один `response.create` отправлен (greet или manual)
7. ✅ События приходят (проверьте `onEvent` лог)
8. ✅ Для текстовых сообщений: используйте `handleSendMessage()` (из useSessionOptions) или manual sequence

**Правильный минимум:**

```tsx
<RealTimeClient
  session={{
    model: 'gpt-4o-realtime-preview-2024-12-17',
    voice: 'shimmer',
    input_audio_transcription: {
      model: 'whisper-1', // Быстрая транскрипция (рекомендуется)
      // или 'gpt-4o-transcribe' // Более точная, но медленнее
    },
    modalities: ['audio', 'text'],
    turn_detection: {
      type: 'server_vad',
      threshold: 0.7,
      prefix_padding_ms: 250,
      silence_duration_ms: 800,
    },
  }}
  autoSessionUpdate={true}
  greetEnabled={true}
  // ...
/>
```

**Если отключаете server_vad (ручной PTT):**

```ts
await sendRaw({ type: 'input_audio_buffer.commit' });
await sendRaw({ type: 'response.create' });
await sendRaw({ type: 'input_audio_buffer.clear' });
```

**Для текстового режима:**

```ts
// ✅ Правильно - через sendTextMessage() (в useSessionOptions)
handleSendMessage(text, onSuccess, onError);

// ✅ Правильно - ручная отправка
await sendRaw({
  type: 'conversation.item.create',
  item: {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text: 'Привет' }]
  }
});
await sendResponseStrict({
  instructions: 'Ответь на вопрос',
  modalities: ['text'],
  conversation: 'auto' // ← Важно для контекста!
});

// ❌ Неправильно - только item без response
await sendRaw({ type: 'conversation.item.create', ... }); // Ничего не произойдет
```

**При ручном чате** (`chatEnabled={false}`) собирайте ленту сами по `client.on('user:*', 'assistant:*')`.

### DataChannel is not open

- Проверьте SDP обмен (fetch_token/SDP ошибки)
- Проверьте ICE-серверы и сеть
- Убедитесь, что токен валидный

### Микрофон не работает

- iOS: проверьте Info.plist (NSMicrophoneUsageDescription)
- Android: проверьте AndroidManifest (RECORD_AUDIO permission)
- Проверьте Media constraints

### Пустые всплески текста в чате

Используйте фильтрацию:

- `policyIsMeaningfulText` / `chatIsMeaningfulText` (см. раздел "Политика «осмысленности»" для деталей)
- Фильтруйте дельты в `onAssistantTextDelta` / `onUserTranscriptionDelta`
- Используйте middleware для очистки

### Ошибка fetch_token

- Проверьте сервер/ключ/заголовки
- Используйте ErrorHandler.onError для детальных логов
- Убедитесь, что сервер возвращает client_secret.value

### Ничего не слышно

- Убедитесь, что remote stream получает track (ontrack)
- Проверьте громкость/аудио-вывод
- Убедитесь, что modalities включают 'audio'

### Ошибки парсинга JSON из DataChannel

- Проверьте логи ErrorHandler — там будет первые 2000 символов сырого сообщения и хинт "Failed to JSON.parse DataChannel message"
- Ошибка не критическая (recoverable), соединение продолжает работать
- Возможно, сервер отправляет не-JSON данные

**Детали обработки**: `DataChannelManager` перехватывает ошибки парсинга и передает их в `ErrorHandler` с severity='warning', включая обрезанный raw текст для отладки.

### connect() вызывается повторно

- Библиотека защищена от конкурентных вызовов
- Повторный вызов во время подключения будет проигнорирован с warning
- Дождитесь завершения первого connect() или используйте status для проверки

---

## Полный API-справочник

### RealTimeClientProps (все пропсы)

**Примечание:** Компонент поддерживает `forwardRef`:

```tsx
const rtcRef = useRef<RealTimeClientHandle>(null);
<RealTimeClient ref={rtcRef} {...props} />;
```

Методы ref см. в разделе "Императивный API через ref (RealTimeClientHandle)".

```ts
type RealTimeClientProps = {
  // Основные
  tokenProvider?: () => Promise<string>;
  deleteChatHistoryOnDisconnect?: boolean; // default: true
  autoConnect?: boolean; // default: false
  attachChat?: boolean; // default: true
  allowConnectWithoutMic?: boolean; // default: true

  // WebRTC
  webrtc?: {
    iceServers?: RTCIceServer[];
    dataChannelLabel?: string;
    offerOptions?: RTCOfferOptions & { voiceActivityDetection?: boolean };
    configuration?: RTCConfiguration;
  };

  // Media
  media?: { getUserMedia?: Constraints };

  // Session
  session?: Partial<SessionConfig>;
  autoSessionUpdate?: boolean; // default: true

  // Greet
  greetEnabled?: boolean; // default: true
  greetInstructions?: string;
  greetModalities?: Array<'audio' | 'text'>;

  // Hooks
  onOpen?: (dc: any) => void;
  onEvent?: (evt: any) => void;
  onError?: (error: any) => void;
  onUserTranscriptionDelta?: (p: {
    itemId: string;
    delta: string;
  }) => 'consume' | void;
  onUserTranscriptionCompleted?: (p: {
    itemId: string;
    transcript: string;
  }) => 'consume' | void;
  onAssistantTextDelta?: (p: {
    responseId: string;
    delta: string;
    channel: string;
  }) => 'consume' | void;
  onAssistantCompleted?: (p: {
    responseId: string;
    status: string;
  }) => 'consume' | void;
  onToolCall?: (p: {
    name: string;
    args: any;
    call_id: string;
  }) => Promise<any> | any;

  // Middleware
  incomingMiddleware?: IncomingMiddleware[];
  outgoingMiddleware?: OutgoingMiddleware[];

  // Policy
  policyIsMeaningfulText?: (t: string) => boolean;

  // Chat
  chatEnabled?: boolean; // default: true
  chatIsMeaningfulText?: (t: string) => boolean;
  chatUserAddOnDelta?: boolean; // default: true
  chatUserPlaceholderOnStart?: boolean; // default: false
  chatAssistantAddOnDelta?: boolean; // default: true
  chatAssistantPlaceholderOnStart?: boolean; // default: false
  chatInverted?: boolean; // default: false

  // Logger
  logger?: {
    debug?: (...a: any[]) => void;
    info?: (...a: any[]) => void;
    warn?: (...a: any[]) => void;
    error?: (...a: any[]) => void;
  };

  // Children
  children?: React.ReactNode | ((ctx: RealtimeContextValue) => React.ReactNode);
};
```

### RealtimeClientClass методы

```ts
class RealtimeClientClass {
  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Messaging
  sendRaw(event: any): Promise<void>;
  sendResponse(opts?: ResponseCreateParams): void;
  sendResponseStrict(options: ResponseCreateStrict): void;
  updateSession(patch: Partial<any>): void;
  sendToolOutput(call_id: string, output: any): void;

  // Events
  on(type: string, handler: (p: any) => void): () => void;
  onConnectionStateChange(fn: (state: ConnectionState) => void): () => void;
  onChatUpdate(fn: (chat: ChatMsg[]) => void): () => void;

  // State
  clearChatHistory(): void;
  setTokenProvider(tp: TokenProvider): void;
  isConnected(): boolean;
  getConnectionState(): ConnectionState;
  getStatus(): ConnectionState; // alias

  // Getters
  getPeerConnection(): RTCPeerConnection | null;
  getDataChannel(): RTCDataChannel | null;
  getLocalStream(): MediaStream | null;
  getRemoteStream(): MediaStream | null;
  getChat(): ChatMsg[];
}
```
