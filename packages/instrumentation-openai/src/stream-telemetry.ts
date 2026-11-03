/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { InferenceInvocation, TelemetryHandler } from '@opentelemetry/genai-util';
import { getOpenAIErrorType } from './utils';

export interface StreamTelemetryHooks<TChunk> {
  onChunk?: (chunk: TChunk) => void | Promise<void>;
  onEnd?: () => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
}

/**
 * Attach genai-util `TelemetryHandler.wrapAsyncStream` (#3831) to an OpenAI
 * `Stream` (or any async iterable) while preserving OpenAI stream identity.
 *
 * OpenAI's `Stream` keeps the producer on the own-property `iterator` and
 * `tee()` consumes via `this.iterator()` directly. `wrapAsyncStream` only
 * replaces `[Symbol.asyncIterator]`, so a Symbol-only wrap would miss `tee()`.
 * This helper feeds a producer proxy into `wrapAsyncStream`, then points both
 * `stream.iterator` (when present) and `[Symbol.asyncIterator]` at the wrapped
 * pull path — without recursion into the raw producer.
 *
 * Unconsumed streams: the invocation/span is created before the HTTP call
 * (required for `withContext` nesting and TTFT from request start). Neither
 * OpenAI's `Stream` nor `wrapAsyncStream` finalize when the object is merely
 * dropped. Classic instrumentation-openai, #3831, and draft #9 all leave the
 * span open until iteration/return/throw. This helper keeps that semantics —
 * no timeouts or FinalizationRegistry.
 */
export function attachOpenAIStreamTelemetry<TChunk>(
  handler: TelemetryHandler,
  stream: AsyncIterable<TChunk>,
  invocation: InferenceInvocation,
  hooks: StreamTelemetryHooks<TChunk>
): AsyncIterable<TChunk> {
  const streamRecord = stream as AsyncIterable<TChunk> & {
    iterator?: (...args: unknown[]) => AsyncIterator<TChunk>;
  };

  const rawIterator =
    typeof streamRecord.iterator === 'function'
      ? streamRecord.iterator.bind(streamRecord)
      : undefined;

  const rawAsyncIterator =
    typeof stream[Symbol.asyncIterator] === 'function'
      ? stream[Symbol.asyncIterator].bind(stream)
      : undefined;

  const producer: AsyncIterable<TChunk> = {
    [Symbol.asyncIterator](): AsyncIterator<TChunk> {
      if (rawIterator) {
        return rawIterator();
      }
      if (rawAsyncIterator) {
        return rawAsyncIterator();
      }
      throw new TypeError('OpenAI stream is not async-iterable');
    },
  };

  handler.wrapAsyncStream(producer, {
    invocation,
    onChunk: hooks.onChunk,
    onEnd: hooks.onEnd,
    onError: async error => {
      // wrapAsyncStream's fail() path does not pass OpenAI-specific error.type;
      // end the invocation here first so RateLimitError / APIError subclasses
      // keep the same error.type as non-streaming paths. A subsequent fail()
      // from wrapAsyncStream is a no-op.
      invocation.fail({
        exception: error instanceof Error ? error : undefined,
        errorType: getOpenAIErrorType(error),
      });
      await hooks.onError?.(error);
    },
  });

  const pullWrapped = (): AsyncIterableIterator<TChunk> =>
    producer[Symbol.asyncIterator]() as AsyncIterableIterator<TChunk>;

  if (rawIterator) {
    Object.defineProperty(stream, 'iterator', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: pullWrapped,
    });
  }

  Object.defineProperty(stream, Symbol.asyncIterator, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: pullWrapped,
  });

  return stream;
}
