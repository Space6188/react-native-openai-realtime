# react-native-openai-realtime — Полная документация

## Библиотека - готовый каркас для голосового/текстового чата с OpenAI Realtime (WebRTC + DataChannel) в React Native. Внутри: провайдер с контекстом, Realtime-клиент, хуки, middleware, маршрутизация событий, встроенный чат, утилиты для речи (VAD), и низкоуровневый доступ к WebRTC/потокам/каналу данных.

## Содержание

- Введение
- Быстрый старт
- Архитектура
- Lifecycle и инициализация
- Компонент RealTimeClient (провайдер)
- Контекст: RealtimeContextValue
- Хуки
  - useRealtime
  - useSpeechActivity
  - useMicrophoneActivity
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
  - EventRouter.setContext() (внутренний метод)
- Константы, DEFAULTS и applyDefaults
- Best Practices
  - Эфемерные токены
  - PTT (push-to-talk) ручной буфер
  - Tools: авто-режим vs ручной
  - VAD: тюнинг и fallback
  - Встроенный чат vs ручной чат
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

### Защита от конкурентных вызовов (Concurrent Guards)

Класс `RealtimeClientClass` защищен от повторных вызовов:

- **connecting** флаг — предотвращает повторный `connect()` во время подключения
- **disconnecting** флаг — предотвращает повторный `disconnect()` во время отключения
- При попытке повторного вызова логируется warning

### Очистка перед переподключением (preConnectCleanup)

Метод `preConnectCleanup()` вызывается автоматически перед новым подключением:

- Закрывает возможные "висящие" DataChannel
- Закрывает старое PeerConnection
- Останавливает медиа-потоки
- НЕ трогает EventRouter/ChatStore (чтобы сохранить подписки)

**Зачем нужно**: защитный механизм от утечек ресурсов при повторных подключениях. Если предыдущая сессия не закрылась корректно, `preConnectCleanup()` очистит "хвосты" перед созданием нового соединения.

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
| children                        | ReactNode или (ctx) => ReactNode                              | -                                    | Если функция — получаете RealtimeContextValue.                                                         |

**Примечания:**

- onSuccess/SuccessCallbacks являются частью низкоуровневого класса RealtimeClientClass (через SuccessHandler). Компонент RealTimeClient их не принимает.
- **SuccessHandler** принимает как детализированные коллбеки из `SuccessCallbacks`, так и универсальный `onSuccess(stage: string, data?: any)`.
- **chatInverted** управляет сортировкой в mergedChat: false = новые сверху, true = старые сверху

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
| **clearAdded**       | **() => void**                                                     | **Очистить только ваши добавленные UI-сообщения (не трогает ChatStore).**                          |
| **clearChatHistory** | **() => void**                                                     | **Очистить встроенный ChatStore (user/assistant сообщения).**                                      |

### Нормализация сообщений в addMessage

Внутри `RealTimeClient` используется метод `normalize()` для обработки входящих сообщений:

- Автоматически генерирует `id` если не указан
- Устанавливает `role: 'assistant'` по умолчанию
- Добавляет timestamp (`ts`)
- Определяет тип сообщения (`text` или `ui`) по наличию полей

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
- **time** — реальная метка времени создания (Date.now())
- **time** может отсутствовать в UI-сообщениях, добавленных через `addMessage()` (баг в `normalize()`)

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

Пробует оценить активность микрофона двумя путями: server-события (дельты) и getStats у локального sender (уровень сигнала).

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
| level       | number (0..1) | Оценка уровня аудио потока.                                                           |
| isCapturing | boolean       | true когда микрофон активен и передаёт данные (есть enabled трек со статусом 'live'). |

Зачем: чтобы рисовать индикатор уровней, подсвечивать PTT, детектировать молчание/речь.

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
| conversation.item.input_audio_transcription.delta     | user:delta                 | { itemId, delta }                                  |
| conversation.item.input_audio_transcription.completed | user:completed             | { itemId, transcript }                             |
| conversation.item.input_audio_transcription.failed    | user:failed                | { itemId, error }                                  |
| conversation.item.truncated                           | user:truncated             | { itemId }                                         |
| response.created                                      | assistant:response_started | { responseId }                                     |
| response.output_text.delta                            | assistant:delta            | { responseId, delta, channel: 'output_text' }      |
| response.audio_transcript.delta                       | assistant:delta            | { responseId, delta, channel: 'audio_transcript' } |
| response.completed                                    | assistant:completed        | { responseId, status: 'done' }                     |
| response.canceled                                     | assistant:completed        | { responseId, status: 'canceled' }                 |
| response.output_text.done                             | assistant:completed        | { responseId, status: 'done' }                     |
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

Примечание: если onToolCall вернёт значение — по умолчанию отправляется function_call_output и тут же делается response.create (follow-up).

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

---

## Встроенный чат: ChatStore/ChatAdapter/ExtendedChatMsg

- **ChatStore** — отслеживает дельты user/assistant, создаёт/обновляет/финализирует сообщения, фильтрует «пустое» по isMeaningfulText.
- **ChatAdapter** — подписывает внешний setChat на обновления чат-стора.
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

Обёртка над response.create. Если opts не переданы — отправится пустой объект.

```ts
sendResponse({ instructions: 'Скажи тост', modalities: ['audio', 'text'] });
```

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

Ручной вывод результата инструмента (если вы не хотите авто-пайплайн через onToolCall):

```ts
client.sendToolOutput(call_id, { ok: true, data: {...} });
client.sendResponse(); // инициировать последующий ответ
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
  input_audio_transcription?: { model: string; language?: string }; // Whisper-1
  tools?: any[]; // Realtime tools spec (проксируется в OpenAI)
  instructions?: string; // системные инструкции
};
```

### Greet (приветствие)

- **greetEnabled** (true|false)
- **greetInstructions** — текст
- **greetModalities** — ['audio','text'] и т.д.

При открытии DataChannel отправляется response.create с указанным приветствием.

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
| getConnectionState()                                            | Текущий connectionState.                                                 |
| getStatus()                                                     | Текущий connectionState (алиас).                                         |
| getPeerConnection()                                             | RTCPeerConnection.                                                       |
| getDataChannel()                                                | RTCDataChannel.                                                          |
| getLocalStream()                                                | MediaStream (локальный).                                                 |
| getRemoteStream()                                               | MediaStream (удалённый).                                                 |
| getChat()                                                       | Текущая история встроенного чат-стора.                                   |

### EventRouter.setContext()

**Внутренний метод** `setContext(client, sendRaw)` используется для обновления ссылок после создания клиента:

```ts
setContext(
  client: RealtimeClientClass | null,
  sendRaw: (e: any) => Promise<void>
): void
```

- Позволяет middleware использовать актуальные ссылки на client и sendRaw
- Вызывается автоматически после инициализации
- НЕ предназначен для публичного использования

### Concurrent Guards (защита от конкурентных вызовов)

Класс защищен от повторных вызовов:

- **connecting** флаг — блокирует повторный connect() во время подключения
- **disconnecting** флаг — блокирует повторный disconnect() во время отключения
- При попытке повторного вызова connect() во время подключения — логируется warning через ErrorHandler с severity='warning'

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

### Автоотключение в фоне

- Компонент `RealTimeClient` автоматически разрывает соединение при переходе приложения в фоновый режим или неактивное состояние.
- При возврате в приложение нужно вызвать `connect()` заново.

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

---

## Troubleshooting / FAQ

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

- policyIsMeaningfulText/chatIsMeaningfulText
- Фильтруйте дельты в onAssistantTextDelta/onUserTranscriptionDelta
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

```ts
type RealTimeClientProps = {
  // Основные
  tokenProvider?: () => Promise<string>;
  deleteChatHistoryOnDisconnect?: boolean; // default: true
  autoConnect?: boolean; // default: false
  attachChat?: boolean; // default: true

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

### RealtimeClientClass методы (полный список)

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
