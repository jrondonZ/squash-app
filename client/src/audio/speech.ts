import type { Speaker } from '../commentary/lines';

/**
 * Voices for the commentary team and the referee.
 *
 * Uses the browser's built-in speech synthesis, which is the only way to get
 * three distinct spoken voices without shipping audio assets. The three roles
 * are separated by voice where the platform offers a choice, and by pitch and
 * rate where it does not — the referee is clipped and flat, the play-by-play
 * voice is quicker and higher, the analyst slower and lower.
 */

export interface VoiceProfile {
  pitch: number;
  rate: number;
  volume: number;
  /** Preferred voice names, in order, matched as substrings. */
  prefer: string[];
}

export const VOICE_PROFILES: Record<Speaker, VoiceProfile> = {
  pbp: {
    pitch: 1.06,
    rate: 1.12,
    volume: 1,
    prefer: ['Daniel', 'Google UK English Male', 'Arthur', 'en-GB'],
  },
  colour: {
    pitch: 0.86,
    rate: 0.97,
    volume: 0.95,
    prefer: ['Oliver', 'Google UK English Female', 'Serena', 'Karen', 'en-AU'],
  },
  referee: {
    pitch: 0.94,
    rate: 1.05,
    volume: 1,
    prefer: ['Alex', 'Google US English', 'Fred', 'en-US'],
  },
};

export class SpeechEngine {
  private enabled = true;
  private voices: SpeechSynthesisVoice[] = [];
  private assigned = new Map<Speaker, SpeechSynthesisVoice | null>();

  constructor() {
    if (!this.supported) return;
    this.loadVoices();
    // Voices populate asynchronously on most browsers.
    window.speechSynthesis.addEventListener?.('voiceschanged', () => this.loadVoices());
  }

  get supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  private loadVoices(): void {
    if (!this.supported) return;
    this.voices = window.speechSynthesis.getVoices();
    this.assigned.clear();

    const taken = new Set<string>();
    // Assign in priority order so the referee does not steal the lead voice.
    for (const speaker of ['pbp', 'colour', 'referee'] as Speaker[]) {
      const profile = VOICE_PROFILES[speaker];
      let chosen: SpeechSynthesisVoice | null = null;

      for (const wanted of profile.prefer) {
        const match = this.voices.find(
          (v) =>
            !taken.has(v.name) &&
            (v.name.includes(wanted) || v.lang.toLowerCase().startsWith(wanted.toLowerCase())),
        );
        if (match) {
          chosen = match;
          break;
        }
      }
      // Fall back to any unused English voice, then to anything at all.
      chosen ??=
        this.voices.find((v) => !taken.has(v.name) && v.lang.startsWith('en')) ??
        this.voices.find((v) => !taken.has(v.name)) ??
        null;

      if (chosen) taken.add(chosen.name);
      this.assigned.set(speaker, chosen);
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancel();
  }

  /** Speak a line. Interrupts whatever is being said. */
  say(speaker: Speaker, text: string): void {
    if (!this.enabled || !this.supported || !text) return;

    const profile = VOICE_PROFILES[speaker];
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.pitch = profile.pitch;
    utterance.rate = profile.rate;
    utterance.volume = profile.volume;

    const voice = this.assigned.get(speaker);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }

    // The commentary engine has already decided this line wins the microphone.
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  cancel(): void {
    if (this.supported) window.speechSynthesis.cancel();
  }

  /** Names of the voices actually in use, for the settings screen. */
  describe(): Record<Speaker, string> {
    return {
      pbp: this.assigned.get('pbp')?.name ?? 'default',
      colour: this.assigned.get('colour')?.name ?? 'default',
      referee: this.assigned.get('referee')?.name ?? 'default',
    };
  }
}

export const speechEngine = new SpeechEngine();
