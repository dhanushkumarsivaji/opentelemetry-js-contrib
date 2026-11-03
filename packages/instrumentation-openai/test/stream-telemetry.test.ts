/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { SpanStatusCode } from '@opentelemetry/api';
import {
  GEN_AI_OPERATION_NAME_VALUE_CHAT,
  GEN_AI_PROVIDER_NAME_VALUE_OPENAI,
  TelemetryHandler,
} from '@opentelemetry/genai-util';
import {
  getTestSpans,
  resetMemoryExporter,
} from '@opentelemetry/contrib-test-utils';
import { expect } from 'expect';
import { attachOpenAIStreamTelemetry } from '../src/stream-telemetry';

function startInvocation() {
  const handler = new TelemetryHandler({
    instrumentationName: 'test-openai-stream',
    instrumentationVersion: '0.0.0',
    contentCaptureMode: 'none',
  });
  return {
    handler,
    invocation: handler.startInference({
      providerName: GEN_AI_PROVIDER_NAME_VALUE_OPENAI,
      operationName: GEN_AI_OPERATION_NAME_VALUE_CHAT,
      requestModel: 'gpt-test',
    }),
  };
}

async function* genChunks(
  values: number[],
  opts?: { throwAfter?: number; error?: Error }
): AsyncGenerator<number> {
  for (let i = 0; i < values.length; i++) {
    if (opts?.throwAfter === i) {
      throw opts.error ?? new Error('boom');
    }
    yield values[i];
  }
}

/**
 * Minimal stand-in for OpenAI `Stream`: own-property `iterator` used by
 * `tee()`, plus `[Symbol.asyncIterator]` delegating to it.
 */
function makeOpenAILikeStream(
  values: number[],
  opts?: { throwAfter?: number; error?: Error }
): AsyncIterable<number> & {
  iterator: () => AsyncIterator<number>;
  teeCalls: number;
  tee(): [AsyncIterable<number>, AsyncIterable<number>];
} {
  let consumed = false;
  const iterator = async function* () {
    if (consumed) {
      throw new Error(
        'Cannot iterate over a consumed stream, use `.tee()` to split the stream.'
      );
    }
    consumed = true;
    yield* genChunks(values, opts);
  };

  const stream: AsyncIterable<number> & {
    iterator: () => AsyncIterator<number>;
    teeCalls: number;
    tee(): [AsyncIterable<number>, AsyncIterable<number>];
  } = {
    iterator,
    teeCalls: 0,
    [Symbol.asyncIterator]() {
      return this.iterator();
    },
    tee() {
      this.teeCalls++;
      // Mirror OpenAI: tee pulls via this.iterator() directly.
      const shared = this.iterator();
      const buffer: Array<Promise<IteratorResult<number>>> = [];
      const make = () => ({
        async next() {
          const p = shared.next();
          buffer.push(p);
          return p;
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      });
      return [make(), make()] as [
        AsyncIterable<number>,
        AsyncIterable<number>,
      ];
    },
  };
  return stream;
}

describe('attachOpenAIStreamTelemetry', function () {
  beforeEach(() => {
    resetMemoryExporter();
  });

  it('records chunks and ends the span exactly once on normal completion', async () => {
    const { handler, invocation } = startInvocation();
    const chunks: number[] = [];
    let onEndCount = 0;
    const stream = makeOpenAILikeStream([1, 2, 3]);
    attachOpenAIStreamTelemetry(handler, stream, invocation, {
      onChunk: c => {
        chunks.push(c);
      },
      onEnd: () => {
        onEndCount++;
      },
    });

    const seen: number[] = [];
    for await (const c of stream) {
      seen.push(c);
    }

    expect(seen).toEqual([1, 2, 3]);
    expect(chunks).toEqual([1, 2, 3]);
    expect(onEndCount).toBe(1);

    const spans = getTestSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].ended).toBe(true);
    expect(spans[0].status.code).not.toBe(SpanStatusCode.ERROR);
  });

  it('finalizes successfully on early break via iterator.return()', async () => {
    const { handler, invocation } = startInvocation();
    let onEndCount = 0;
    const stream = makeOpenAILikeStream([1, 2, 3, 4]);
    attachOpenAIStreamTelemetry(handler, stream, invocation, {
      onEnd: () => {
        onEndCount++;
      },
    });

    for await (const c of stream) {
      if (c === 2) {
        break;
      }
    }

    expect(onEndCount).toBe(1);
    const spans = getTestSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].ended).toBe(true);
  });

  it('fails the span exactly once when the iterator throws', async () => {
    const { handler, invocation } = startInvocation();
    let onErrorCount = 0;
    const boom = new Error('stream boom');
    const stream = makeOpenAILikeStream([1], { throwAfter: 0, error: boom });
    attachOpenAIStreamTelemetry(handler, stream, invocation, {
      onError: () => {
        onErrorCount++;
      },
    });

    await expect(
      (async () => {
        for await (const chunk of stream) {
          void chunk;
        }
      })()
    ).rejects.toThrow('stream boom');

    expect(onErrorCount).toBe(1);
    const spans = getTestSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
  });

  it('instruments tee() consumption through stream.iterator()', async () => {
    const { handler, invocation } = startInvocation();
    const chunks: number[] = [];
    const stream = makeOpenAILikeStream([10, 20]);
    attachOpenAIStreamTelemetry(handler, stream, invocation, {
      onChunk: c => {
        chunks.push(c);
      },
    });

    const [left] = stream.tee();
    expect(stream.teeCalls).toBe(1);
    const seen: number[] = [];
    // Consume one side; shared underlying iterator drives telemetry.
    for await (const c of left as AsyncIterable<number>) {
      seen.push(c);
    }
    expect(seen).toEqual([10, 20]);
    expect(chunks).toEqual([10, 20]);
    expect(getTestSpans()).toHaveLength(1);
    expect(getTestSpans()[0].ended).toBe(true);
  });

  it('leaves the span open if the wrapped stream is never pulled (classic/#3831/#9 parity)', async () => {
    // Span is created before attach (request-start semantics). Without
    // iteration there is no completion hook — same as published
    // instrumentation-openai, genai-util wrapAsyncStream, and draft #9.
    const { handler, invocation } = startInvocation();
    const stream = makeOpenAILikeStream([1]);
    attachOpenAIStreamTelemetry(handler, stream, invocation, {});
    expect(getTestSpans()).toHaveLength(0);
    invocation.stop();
    expect(getTestSpans()).toHaveLength(1);
  });
});
