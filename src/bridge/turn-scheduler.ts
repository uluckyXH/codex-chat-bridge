export interface ScheduledTurn {
  routeKey: string;
  sessionId?: string;
  enqueuedAt: string;
}

export interface TurnSchedulerRunOptions {
  signal?: AbortSignal;
}

export interface TurnScheduler {
  run<T>(turn: ScheduledTurn, task: () => Promise<T>, options?: TurnSchedulerRunOptions): Promise<T>;
  getStatus(): TurnSchedulerStatus;
}

export interface TurnSchedulerStatus {
  mode: "unlimited" | "limited";
  maxConcurrentTurns?: number;
  running: number;
  queued: number;
}

export class TurnSchedulerAbortError extends Error {
  constructor() {
    super("scheduled turn aborted");
    this.name = "TurnSchedulerAbortError";
  }
}

interface QueuedTurn<T> {
  turn: ScheduledTurn;
  task: () => Promise<T>;
  signal?: AbortSignal;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export class UnlimitedTurnScheduler implements TurnScheduler {
  private running = 0;

  async run<T>(_turn: ScheduledTurn, task: () => Promise<T>, options: TurnSchedulerRunOptions = {}): Promise<T> {
    throwIfAborted(options.signal);
    this.running += 1;
    try {
      return await task();
    } finally {
      this.running -= 1;
    }
  }

  getStatus(): TurnSchedulerStatus {
    return {
      mode: "unlimited",
      running: this.running,
      queued: 0,
    };
  }
}

export class LimitedTurnScheduler implements TurnScheduler {
  private running = 0;
  private readonly queue: Array<QueuedTurn<unknown>> = [];

  constructor(private readonly maxConcurrentTurns: number) {
    if (!Number.isInteger(maxConcurrentTurns) || maxConcurrentTurns <= 0) {
      throw new Error("maxConcurrentTurns must be a positive integer");
    }
  }

  run<T>(turn: ScheduledTurn, task: () => Promise<T>, options: TurnSchedulerRunOptions = {}): Promise<T> {
    throwIfAborted(options.signal);
    return new Promise<T>((resolve, reject) => {
      const queued: QueuedTurn<T> = {
        turn,
        task,
        signal: options.signal,
        resolve,
        reject,
      };
      this.queue.push(queued as QueuedTurn<unknown>);
      this.drain();
    });
  }

  getStatus(): TurnSchedulerStatus {
    return {
      mode: "limited",
      maxConcurrentTurns: this.maxConcurrentTurns,
      running: this.running,
      queued: this.queue.length,
    };
  }

  private drain(): void {
    while (this.running < this.maxConcurrentTurns && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) return;
      if (next.signal?.aborted) {
        next.reject(abortError());
        continue;
      }
      this.running += 1;
      void this.execute(next);
    }
  }

  private async execute<T>(queued: QueuedTurn<T>): Promise<void> {
    try {
      throwIfAborted(queued.signal);
      queued.resolve(await queued.task());
    } catch (error) {
      queued.reject(error);
    } finally {
      this.running -= 1;
      this.drain();
    }
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  return new TurnSchedulerAbortError();
}
