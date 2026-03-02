export interface RetryOptions {
  /** Maximum number of attempts (including initial). Default: 3 */
  maxAttempts?: number;
  /** Base delay in ms. Default: 500 */
  baseDelay?: number;
  /** Maximum delay in ms (cap for exponential growth). Default: 4000 */
  maxDelay?: number;
  /** Whether to add jitter (randomize delay +-25%). Default: true */
  jitter?: boolean;
  /** Called on each retry with (error, attemptNumber). Return false to abort. */
  onRetry?: (error: unknown, attempt: number) => boolean | void;
  /** Called when all attempts exhausted. */
  onExhausted?: (error: unknown) => void;
}

export async function retryAsync<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelay = 500,
    maxDelay = 4000,
    jitter = true,
    onRetry,
    onExhausted,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt >= maxAttempts) {
        onExhausted?.(err);
        break;
      }

      let delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      if (jitter) {
        delay = delay * (0.75 + Math.random() * 0.5);
      }

      const shouldContinue = onRetry?.(err, attempt);
      if (shouldContinue === false) break;

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
