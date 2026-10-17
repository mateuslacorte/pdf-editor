// Polyfills for cross-browser compatibility (Safari / WebKit / Chrome / Edge)

if (typeof globalThis !== 'undefined') {
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

  // 3. Polyfill Map.prototype.getOrInsertComputed (used by PDF.js PDFObjects.get)
  if (typeof Map !== 'undefined' && typeof (Map.prototype as any).getOrInsertComputed === 'undefined') {
    (Map.prototype as any).getOrInsertComputed = function <K, V>(
      this: Map<K, V>,
      key: K,
      callbackfn: (key: K) => V
    ): V {
      if (this.has(key)) {
        return this.get(key) as V;
      }
      const value = callbackfn(key);
      this.set(key, value);
      return value;
    };
  }

  // 4. Polyfill Math.sumPrecise (used by PDF.js OpenType name table builder)
  if (typeof (Math as any).sumPrecise === 'undefined') {
    (Math as any).sumPrecise = function (items: Iterable<number>): number {
      let sum = 0;
      for (const n of items) {
        sum += Number(n);
      }
      return sum;
    };
  }

  // 5. Polyfill Uint8Array.prototype.toBase64 (used by PDF.js FontFaceObject.createFontFaceRule)
  if (typeof Uint8Array !== 'undefined' && typeof (Uint8Array.prototype as any).toBase64 === 'undefined') {
    (Uint8Array.prototype as any).toBase64 = function (this: Uint8Array): string {
      let binary = '';
      const len = this.byteLength;
      const chunkSize = 0x8000;
      for (let i = 0; i < len; i += chunkSize) {
        const sub = this.subarray(i, Math.min(i + chunkSize, len));
        binary += String.fromCharCode.apply(null, Array.from(sub));
      }
      return typeof btoa === 'function' ? btoa(binary) : Buffer.from(this).toString('base64');
    };
  }
}

export {};
