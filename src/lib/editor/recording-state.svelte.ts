export interface RunRecordingOptions {
  onError?: (message: string) => void;
  /** Message shown when the caught error isn't an Error instance. */
  fallbackErrorMessage?: string;
}

/** Shared recording state machine: progress/finalizing flags + abort-aware error handling. */
export function createRecordingState() {
  let recording = $state(false);
  let recordProgress = $state(0);
  let recordFinalizing = $state(false);
  let recordAbort: AbortController | null = $state(null);

  async function run(
    task: (signal: AbortSignal) => Promise<void>,
    options?: RunRecordingOptions,
  ): Promise<void> {
    if (recording) return;
    recording = true;
    recordProgress = 0;
    recordFinalizing = false;
    const abort = new AbortController();
    recordAbort = abort;

    try {
      await task(abort.signal);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        // cancelled
      } else {
        console.error("Recording failed:", e);
        options?.onError?.(
          e instanceof Error
            ? e.message
            : (options?.fallbackErrorMessage ?? "Recording failed."),
        );
      }
    } finally {
      recording = false;
      recordFinalizing = false;
      recordAbort = null;
    }
  }

  function cancel() {
    recordAbort?.abort();
  }

  return {
    get recording() {
      return recording;
    },
    get recordProgress() {
      return recordProgress;
    },
    set recordProgress(v: number) {
      recordProgress = v;
    },
    get recordFinalizing() {
      return recordFinalizing;
    },
    set recordFinalizing(v: boolean) {
      recordFinalizing = v;
    },
    run,
    cancel,
  };
}
