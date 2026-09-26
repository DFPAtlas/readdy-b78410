/**
 * Browser playback for synthesized agent speech.
 *
 * A single audio element is reused for every reply so only one agent can ever be
 * audible at a time. The clip is played from a fetched Blob via an object URL,
 * and BOTH the object URL and the audio element are released on every terminal
 * path (ended, error, stop and unmount) — no audio resource is ever retained.
 *
 * The player owns no UI state and no network work: the caller fetches the clip
 * through the gateway client and wires the handlers to the console callbacks.
 */

export interface SpeechPlaybackHandlers {
  /** Fired once audio is actually audible (drives the "speaking" state). */
  onStart: () => void;
  /** Fired when the clip finishes playing normally. */
  onEnd: () => void;
  /** Fired when playback fails; receives a safe, human-readable reason. */
  onError: (detail: string) => void;
}

export class SpeechPlayer {
  private audio: HTMLAudioElement | null = null;

  private objectUrl: string | null = null;

  /**
   * Playback epoch. Every `start` / `release` advances it, so any handler or
   * pending fetch belonging to an older clip is ignored — a stale clip can
   * never start after a newer one, and a released clip can never "un-end".
   */
  private token = 0;

  get isActive(): boolean {
    return this.audio !== null;
  }

  /**
   * Play one clip. Any previously playing clip is released first, so starting a
   * new reply never leaves the old one audible.
   */
  start(blob: Blob, handlers: SpeechPlaybackHandlers): Promise<void> {
    this.release();
    const token = this.token;

    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.preload = "auto";
    audio.src = url;
    this.audio = audio;
    this.objectUrl = url;

    const isCurrent = () => token === this.token;

    audio.onplaying = () => {
      if (isCurrent()) handlers.onStart();
    };
    audio.onended = () => {
      if (!isCurrent()) return;
      this.release();
      handlers.onEnd();
    };
    audio.onerror = () => {
      if (!isCurrent()) return;
      this.release();
      handlers.onError("The browser could not play the synthesized audio.");
    };

    return audio.play().catch(() => {
      if (!isCurrent()) return;
      this.release();
      handlers.onError("Audio playback was blocked by the browser.");
    });
  }

  /** Release the audio element and its object URL immediately. Idempotent. */
  release(): void {
    this.token += 1;

    const audio = this.audio;
    this.audio = null;
    if (audio) {
      audio.onplaying = null;
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
      } catch {
        /* already stopped */
      }
      audio.removeAttribute("src");
    }

    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}