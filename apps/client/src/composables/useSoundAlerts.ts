import { ref, watch, type Ref } from 'vue';
import type { HookEvent } from '../types';

export interface SoundAlertSettings {
  enabled: boolean;
  volume: number; // 0-100
  sessionEnd: boolean;
  testFail: boolean;
  testPass: boolean;
  toolFailure: boolean;
  waitingForInput: boolean;
}

const DEFAULT_SETTINGS: SoundAlertSettings = {
  enabled: true,
  volume: 50,
  sessionEnd: true,
  testFail: true,
  testPass: true,
  toolFailure: true,
  waitingForInput: true,
};

const STORAGE_KEY = 'devpulse-sound-alerts';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playTone(frequency: number, duration: number, volume: number, type: OscillatorType = 'sine') {
  const ctx = getAudioContext();
  if (!ctx) return;

  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);
  osc.connect(gain);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

// Two rising tones — session completed
function playSessionEnd(volume: number) {
  const v = volume / 100 * 0.3;
  playTone(523, 0.15, v); // C5
  setTimeout(() => playTone(659, 0.2, v), 160); // E5
}

// Low descending tone — tests failing
function playTestFail(volume: number) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const v = volume / 100 * 0.25;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(v, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(330, ctx.currentTime); // E4
  osc.frequency.linearRampToValueAtTime(220, ctx.currentTime + 0.35); // slide down to A3
  osc.connect(gain);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.4);
}

// Bright chime — tests passing
function playTestPass(volume: number) {
  const v = volume / 100 * 0.2;
  playTone(784, 0.1, v); // G5
  setTimeout(() => playTone(988, 0.1, v), 100); // B5
  setTimeout(() => playTone(1175, 0.15, v), 200); // D6
}

// Short buzz — tool failure
function playToolFailure(volume: number) {
  const v = volume / 100 * 0.15;
  playTone(180, 0.15, v, 'sawtooth');
}

// Soft bell — waiting for input
function playWaitingForInput(volume: number) {
  const v = volume / 100 * 0.2;
  playTone(880, 0.3, v); // A5
}

function isTestCommand(command: string): boolean {
  const lower = command.toLowerCase();
  return /\b(test|jest|vitest|pytest|mocha|spec)\b/.test(lower) ||
    lower.includes('bun test') || lower.includes('npm test') || lower.includes('yarn test');
}

function hasTestResults(payload: Record<string, any>): { passing: boolean } | null {
  const output = payload?.output || payload?.stdout || '';
  if (typeof output !== 'string') return null;

  if (/(\d+)\s+(passed|passing)/.test(output) && !/(\d+)\s+(failed|failing)/.test(output)) {
    return { passing: true };
  }
  if (/(\d+)\s+(failed|failing)/.test(output) || /FAIL/.test(output)) {
    return { passing: false };
  }
  return null;
}

export function useSoundAlerts(events: Ref<HookEvent[]>) {
  const settings = ref<SoundAlertSettings>(loadSettings());

  // Track the highest event ID we've seen to only process new ones
  let lastSeenId: number = 0;
  let skipInitialBatch = true;

  function loadSettings(): SoundAlertSettings {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch {
      // ignore
    }
    return { ...DEFAULT_SETTINGS };
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings.value));
  }

  watch(settings, saveSettings, { deep: true });

  watch(events, (newEvents) => {
    // On first watch trigger, record the highest existing ID and skip
    if (skipInitialBatch) {
      skipInitialBatch = false;
      for (const ev of newEvents) {
        if (ev.id != null && ev.id > lastSeenId) lastSeenId = ev.id as number;
      }
      return;
    }

    if (!settings.value.enabled) return;

    // Process only events we haven't seen before (by ID)
    for (const event of newEvents) {
      const id = event.id as number;
      if (id == null || id <= lastSeenId) continue;
      lastSeenId = id;
      processEvent(event);
    }
  });

  function processEvent(event: HookEvent) {
    const vol = settings.value.volume;
    const type = event.hook_event_type;
    const payload = event.payload || {};

    // Session finished
    if ((type === 'Stop' || type === 'SessionEnd') && settings.value.sessionEnd) {
      playSessionEnd(vol);
      return;
    }

    // Waiting for input
    if (type === 'Notification' && settings.value.waitingForInput) {
      playWaitingForInput(vol);
      return;
    }

    // Tool failure
    if (type === 'PostToolUseFailure' && settings.value.toolFailure) {
      playToolFailure(vol);
      return;
    }

    // Test results (from PostToolUse Bash commands)
    if (type === 'PostToolUse' && payload.tool_name === 'Bash') {
      const command = payload.tool_input?.command || payload.command || '';
      if (isTestCommand(command)) {
        const result = hasTestResults(payload);
        if (result) {
          if (result.passing && settings.value.testPass) {
            playTestPass(vol);
          } else if (!result.passing && settings.value.testFail) {
            playTestFail(vol);
          }
          return;
        }
      }
    }
  }

  return {
    settings,
  };
}
