export async function runWithTimeout(promiseOrFactory, timeoutMs, timeoutMessage = "Operation timeout") {
  const promise = typeof promiseOrFactory === "function" ? promiseOrFactory() : promiseOrFactory;

  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }

  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
