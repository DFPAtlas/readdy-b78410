/**
 * Live conversation-turn controller for the Atlas Voice Console.
 *
 * A "turn" is one operator interaction against the gateway: either a LIVE text
 * chat (`POST /api/chat`) or a LIVE microphone clip (`POST /api/voice`). Both
 * produce exactly one user message and one assistant response.
 *
 * The gateway broadcasts WebSocket events while the HTTP request is still in
 * flight, and the frontend only learns the server's `requestId` from those
 * events (or, at the end, from the HTTP response). This controller is the single
 * place that decides whether an inbound event belongs to the current turn — by
 * session first, then by request once it is known — so a stray event from a
 * different session can never be appended to the wrong conversation turn.
 *
 * It is deliberately framework-free (plain TypeScript) so the matching and
 * reconciliation rules are easy to test and reuse.
 */

export type LiveTurnKind = "text" | "voice";

export interface LiveTurn {
  /** Client-side turn id (stable even before the server requestId is known). */
  id: string;
  kind: LiveTurnKind;
  /** Session this turn belongs to; every matching event must share it. */
  sessionId: string;
  /** Server requestId, learned from an event or the final HTTP response. */
  requestId: string | null;
  /** The single user message id for this turn (created once). */
  userMessageId: string | null;
  /** The single assistant message id for this turn (streamed or created once). */
  assistantMessageId: string | null;
  /** Whether any response delta / response_started has been applied. */
  streamed: boolean;
  /** Set once the HTTP round-trip has finished reconciling the turn. */
  finished: boolean;
}

/** The routing keys an inbound event may be matched against. */
export interface TurnEventRef {
  sessionId?: string;
  requestId?: string;
}

export class LiveTurnController {
  private turn: LiveTurn | null = null;

  /**
   * Request ids belonging to already-finished turns. A late WebSocket event
   * (e.g. a stray `error` / `transcription_failed`) that arrives after a newer
   * turn has started carries an OLD request id; matching it against the current
   * turn would corrupt that turn's status, so such ids are rejected outright.
   */
  private staleRequestIds = new Set<string>();

  /** Begin a new turn, replacing any previous (finished or stale) one. */
  begin(id: string, kind: LiveTurnKind, sessionId: string, userMessageId: string | null): LiveTurn {
    if (this.turn?.requestId) this.staleRequestIds.add(this.turn.requestId);
    this.turn = {
      id,
      kind,
      sessionId,
      requestId: null,
      userMessageId,
      assistantMessageId: null,
      streamed: false,
      finished: false,
    };
    return this.turn;
  }

  get current(): LiveTurn | null {
    return this.turn;
  }

  isActive(): boolean {
    return this.turn !== null && !this.turn.finished;
  }

  /**
   * Decide whether an event belongs to the active turn.
   *
   * Matching order: session first (authoritative), then request. The server's
   * `requestId` is adopted the first time it is seen so subsequent events can be
   * checked against it. Events with neither key cannot be attributed and are
   * rejected.
   */
  match(ref: TurnEventRef): boolean {
    const turn = this.turn;
    if (!turn || turn.finished) return false;

    // A request id from an already-finished turn can never belong to this turn.
    if (ref.requestId && this.staleRequestIds.has(ref.requestId)) return false;

    if (ref.sessionId && turn.sessionId && ref.sessionId !== turn.sessionId) return false;

    if (ref.requestId) {
      if (turn.requestId && turn.requestId !== ref.requestId) return false;
      turn.requestId = ref.requestId;
    }

    if (!ref.sessionId && !ref.requestId) return false;
    return true;
  }

  setUserMessage(id: string): void {
    if (this.turn) this.turn.userMessageId = id;
  }

  /** Record the single assistant message and mark the turn as streaming. */
  setAssistantMessage(id: string): void {
    if (!this.turn) return;
    this.turn.assistantMessageId = id;
    this.turn.streamed = true;
  }

  adoptRequestId(id: string | null): void {
    if (this.turn && id) this.turn.requestId = id;
  }

  finish(): void {
    if (this.turn) {
      this.turn.finished = true;
      if (this.turn.requestId) this.staleRequestIds.add(this.turn.requestId);
    }
  }

  clear(): void {
    this.turn = null;
  }
}