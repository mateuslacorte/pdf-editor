// Polyfills for cross-browser compatibility (specifically Safari / WebKit)

if (typeof window !== 'undefined') {
  // 1. Polyfill ReadableStream[Symbol.asyncIterator]
  // Fixes: "TypeError: undefined is not a function (near '...t of e...')" in Safari when PDF.js streams textContent
  if (typeof ReadableStream !== 'undefined' && !(ReadableStream.prototype as any)[Symbol.asyncIterator]) {
    (ReadableStream.prototype as any)[Symbol.asyncIterator] = async function* (this: ReadableStream) {
      const reader = this.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    };
  }

  // 2. Polyfill Promise.withResolvers for Safari < 17.4
  if (typeof (Promise as any).withResolvers === 'undefined') {
    (Promise as any).withResolvers = function <T>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: any) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
  }
}

export {};
