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
import { wrapAsyncIteratorWithTelemetry } from '../src/stream-telemetry';

function startInvocation() {
  const handler = new TelemetryHandler({
    instrumentationName: 'test-openai-stream',
    instrumentationVersion: '0.0.0',
    contentCaptureMode: 'none',
  });
  return handler.startInference({
    providerName: GEN_AI_PROVIDER_NAME_VALUE_OPENAI,
    operationName: GEN_AI_OPERATION_NAME_VALUE_CHAT,
    requestModel: 'gpt-test',
  });
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

describe('wrapAsyncIteratorWithTelemetry', function () {
  beforeEach(() => {
    resetMemoryExporter();
  });

  it('records chunks and ends the span exactly once on normal completion', async () => {
    const invocation = startInvocation();
    const chunks: number[] = [];
    let onEndCount = 0;
    const wrapped = wrapAsyncIteratorWithTelemetry(
      genChunks([1, 2, 3])[Symbol.asyncIterator](),
      invocation,
      {
        onChunk: c => {
          chunks.push(c);
        },
        onEnd: () => {
          onEndCount++;
        },
      }
    );

    const seen: number[] = [];
    for await (const c of wrapped) {
      seen.push(c);
    }

    expect(seen).toEqual([1, 2, 3]);
    expect(chunks).toEqual([1, 2, 3]);
    expect(onEndCount).toBe(1);

    // Second completion path must be a no-op.
    await wrapped.return?.();
    expect(onEndCount).toBe(1);

    const spans = getTestSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].ended).toBe(true);
    expect(spans[0].status.code).toBe(SpanStatusCode.UNSET);
  });

  it('finalizes successfully on early break via iterator.return()', async () => {
    const invocation = startInvocation();
    let onEndCount = 0;
    const wrapped = wrapAsyncIteratorWithTelemetry(
      genChunks([10, 20, 30])[Symbol.asyncIterator](),
      invocation,
      {
        onEnd: () => {
          onEndCount++;
        },
      }
    );

    const iter = wrapped[Symbol.asyncIterator]();
    expect((await iter.next()).value).toBe(10);
    await iter.return?.();

    expect(onEndCount).toBe(1);
    const spans = getTestSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].ended).toBe(true);
    expect(spans[0].status.code).toBe(SpanStatusCode.UNSET);
  });

  it('fails the span exactly once when the iterator throws', async () => {
    const invocation = startInvocation();
    let onErrorCount = 0;
    const wrapped = wrapAsyncIteratorWithTelemetry(
      genChunks([1, 2], { throwAfter: 1, error: new Error('stream fail') })[
        Symbol.asyncIterator
      ](),
      invocation,
      {
        onError: () => {
          onErrorCount++;
        },
      }
    );

    const seen: number[] = [];
    await expect(async () => {
      for await (const c of wrapped) {
        seen.push(c);
      }
    }).rejects.toThrow('stream fail');

    expect(seen).toEqual([1]);
    expect(onErrorCount).toBe(1);

    // Exactly-once: a second failure path must not re-enter onError.
    await expect(wrapped.throw?.(new Error('again'))).rejects.toThrow('again');
    expect(onErrorCount).toBe(1);

    const spans = getTestSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].ended).toBe(true);
    expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
  });

  it('fails via iterator.throw() when the source has no throw()', async () => {
    const invocation = startInvocation();
    const source: AsyncIterator<number> = {
      next: async () => ({ done: true, value: undefined as unknown as number }),
    };
    const wrapped = wrapAsyncIteratorWithTelemetry(source, invocation, {});
    await expect(wrapped.throw?.(new Error('injected'))).rejects.toThrow(
      'injected'
    );
    const spans = getTestSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].ended).toBe(true);
    expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
  });

  it('documents that an unconsumed wrapped iterator leaves the span open', async () => {
    // Known limitation shared with classic OpenAI streaming instrumentation and
    // the draft wrapAsyncStream attach path: no iteration ⇒ no finalize.
    const invocation = startInvocation();
    wrapAsyncIteratorWithTelemetry(
      genChunks([1])[Symbol.asyncIterator](),
      invocation,
      {}
    );
    // Do not iterate.
    expect(getTestSpans()).toHaveLength(0);
    // Clean up to avoid leaking an open span into later tests.
    invocation.stop();
    expect(getTestSpans()).toHaveLength(1);
  });
});
