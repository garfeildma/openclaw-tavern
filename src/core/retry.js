export async function retryWithBackoff(fn, { retries, delaysMs, timeoutMs }) {
  let lastError;

  for (let i = 0; i <= retries; i += 1) {
    try {
      const result = await withTimeout(fn(), timeoutMs);
      return result;
    } catch (err) {
      lastError = err;
      if (i >= retries) {
        break;
      }
      const delay = delaysMs[i] || delaysMs[delaysMs.length - 1] || 0;
      if (delay > 0) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

async function withTimeout(promise, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }

  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
