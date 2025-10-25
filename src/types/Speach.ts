export type SpeechActivityState = {
  isUserSpeaking: boolean;
  isAssistantSpeaking: boolean;
  inputBuffered: boolean;
  outputBuffered: boolean;
  lastUserEventAt: number | null;
  lastAssistantEventAt: number | null;
};

export type Listener = (s: SpeechActivityState) => void;
