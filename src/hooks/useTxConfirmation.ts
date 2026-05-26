// protocol/src/hooks/useTxConfirmation.ts
//
// patch_bundle04_5_p4_useTxConfirmation
//
// Primitive for "wait until a specific tx_hash resolves." Subscribes to the
// `verisphere:tx-confirmed` window event dispatched by the frontend's
// NotificationsProvider, which fires once per tx_hash transition out of
// pending — regardless of which source-table row (tx_log, chain_tx,
// mm_trade) carries the resolution in the unified notifications feed.
//
// Two consumers:
//   - waitForTxConfirmation(tx_hash, opts): plain async helper. Used
//     internally by useMetaTx after submit. Not a React hook.
//   - useTxConfirmation(): React hook returning a stable callback that
//     calls the same helper. For future component-level use.
//
// Contract:
//   On confirmed → resolve with TxConfirmationDetail (status=confirmed).
//   On reverted/dropped → resolve with TxConfirmationDetail (status reflects).
//   On timeout (default 90s) → reject with Error.
//
// Note: this primitive trusts that the caller submitted the tx BEFORE
// calling it. If the tx already confirmed in a poll prior to subscription,
// the event has already fired and we'll time out. Callers that need to
// resume waiting on a previously-submitted tx must implement their own
// catch-up logic (a one-shot fetch of /api/notifications and a check
// against `recent`). The standard submit-then-wait flow doesn't need this.
import { useCallback } from "react";

export type TxConfirmationStatus = "confirmed" | "reverted" | "dropped";

export interface TxConfirmationDetail {
  tx_hash: string;
  status: TxConfirmationStatus;
  // Optional enrichment carried from the unified feed when available.
  block_number?: number | null;
  gas_used?: number | null;
  post_id?: number | null;
  error_message?: string | null;
  // For backwards compatibility with code that read tx_log_id off the
  // older event; present when the resolved row originated from tx_log.
  tx_log_id?: number;
}

export interface WaitForTxConfirmationOptions {
  /** Override timeout in milliseconds. Default 90_000. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 90_000;

// patch_bundle04_5_p41_wtc_normalize
// Backend sign_and_send returns tx_hash WITHOUT a 0x prefix (web3.py
// .hex() convention). chain_indexer writes chain_tx rows WITH a 0x
// prefix. Both end up in the unified feed and reach NotificationsProvider's
// dispatch site. Normalize on both sides of the listener compare to make
// the wait robust to prefix-presence asymmetry.
function normalizeHash(s: string | null | undefined): string {
  if (!s) return "";
  let t = s.trim().toLowerCase();
  if (t.startsWith("0x")) t = t.slice(2);
  return t;
}

/**
 * Plain async helper: subscribe to the resolution of one tx_hash.
 *
 * Side effects:
 *   - Adds a `verisphere:tx-confirmed` listener for the duration of the wait.
 *   - Dispatches `verisphere:notifications-refresh` once on subscription so
 *     latency isn't bounded by the slow poll interval.
 *
 * The returned promise settles exactly once. The listener is always removed
 * on settle.
 */
export function waitForTxConfirmation(
  tx_hash: string,
  opts: WaitForTxConfirmationOptions = {},
): Promise<TxConfirmationDetail> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // patch_bundle04_5_p41_wtc_normalize: normalize for prefix/case-insensitive compare
  const target = normalizeHash(tx_hash);
  const t0 = Date.now();
  return new Promise<TxConfirmationDetail>((resolve, reject) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      window.removeEventListener("verisphere:tx-confirmed", handler);
    };

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as TxConfirmationDetail | undefined;
      if (!detail || !detail.tx_hash) return;
      // patch_bundle04_5_p41_wtc_normalize: normalize detail.tx_hash too
      if (normalizeHash(detail.tx_hash) !== target) return;
      if (done) return;
      done = true;
      cleanup();
      resolve(detail);
    };

    window.addEventListener("verisphere:tx-confirmed", handler);
    // Ask the notifications poller to refresh immediately so latency
    // isn't bounded by the poll interval. NotificationsProvider listens
    // for this event.
    window.dispatchEvent(new CustomEvent("verisphere:notifications-refresh"));

    // patch_bundle04_5_p41_wtc_replay_request: ask NotificationsProvider to replay
    // a previously-dispatched verisphere:tx-confirmed for this hash if it
    // has one in its buffer. This covers the race where the row flipped
    // out of pending BEFORE this listener attached.
    window.dispatchEvent(new CustomEvent("verisphere:tx-confirmed-replay-request", {
      detail: { tx_hash: target },
    }));

    timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error("Transaction timed out — check Transactions view for status"));
    }, timeoutMs);
  });
}

/**
 * React hook returning a stable callback that wraps waitForTxConfirmation.
 * Lets components await tx confirmation without creating a fresh closure
 * each render.
 */
export function useTxConfirmation() {
  const wait = useCallback(
    (tx_hash: string, opts?: WaitForTxConfirmationOptions) =>
      waitForTxConfirmation(tx_hash, opts),
    [],
  );
  return { waitForTxConfirmation: wait };
}
