/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { diag, type DiagLogger } from '@opentelemetry/api';
import type { InferenceInvocation } from '@opentelemetry/genai-util';
import { getOpenAIErrorType } from './utils';

export interface StreamTelemetryHooks<TChunk> {
  onChunk?: (chunk: TChunk) => void | Promise<void>;
  onEnd?: () => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
}

/**
 * Main-compatible stand-in for genai-util `wrapAsyncStream` (#3831).
 * Records chunk timing and completes the invocation exactly once.
 *
 * Limitations (same class of risk as classic OpenAI instrumentation):
 * - If the wrapped iterator is never pulled, the invocation is not completed.
 * - Callers must iterate (or early-break / return / throw) for span end.
 */
export function wrapAsyncIteratorWithTelemetry<TChunk>(
  iterator: AsyncIterator<TChunk>,
  invocation: InferenceInvocation,
  hooks: StreamTelemetryHooks<TChunk>,
  diagLogger: DiagLogger = diag
): AsyncIterableIterator<TChunk> {
  let finalized = false;

  const finalizeSuccess = async (): Promise<void> => {
    if (finalized) {
      return;
    }
    finalized = true;
    try {
      await hooks.onEnd?.();
    } catch (err) {
      diagLogger.error('Error in OpenAI stream onEnd hook', err);
    } finally {
      // If onEnd already failed the invocation (e.g. Responses stream error
      // event), stop() is a no-op.
      invocation.stop();
    }
  };

  const finalizeFailure = async (error: unknown): Promise<void> => {
    if (finalized) {
      return;
    }
    finalized = true;
    try {
      await hooks.onError?.(error);
    } catch (err) {
      diagLogger.error('Error in OpenAI stream onError hook', err);
    } finally {
      invocation.setFinishReasons(['error']);
      invocation.fail({
        exception: error instanceof Error ? error : undefined,
        errorType: getOpenAIErrorType(error),
      });
    }
  };

  const originalNext = iterator.next.bind(iterator);
  const originalReturn =
    typeof iterator.return === 'function'
      ? iterator.return.bind(iterator)
      : undefined;
  const originalThrow =
    typeof iterator.throw === 'function'
      ? iterator.throw.bind(iterator)
      : undefined;

  // Shared with next()/throw(): both can yield a chunk, complete, or reject.
  const advance = async (
    step: () => Promise<IteratorResult<TChunk>>
  ): Promise<IteratorResult<TChunk>> => {
    try {
      const result = await step();
      if (result.done) {
        await finalizeSuccess();
        return result;
      }
      try {
        await hooks.onChunk?.(result.value);
      } catch (err) {
        diagLogger.error('Error in OpenAI stream onChunk hook', err);
      }
      invocation.recordStreamChunk();
      return result;
    } catch (error) {
      await finalizeFailure(error);
      throw error;
    }
  };

  return {
    async next(...args): Promise<IteratorResult<TChunk>> {
      return advance(() => originalNext(...args));
    },

    async return(value?: unknown): Promise<IteratorResult<TChunk>> {
      try {
        const result: IteratorResult<TChunk> = originalReturn
          ? await originalReturn(value)
          : { done: true, value: value as TChunk };
        await finalizeSuccess();
        return result;
      } catch (error) {
        await finalizeFailure(error);
        throw error;
      }
    },

    async throw(error?: unknown): Promise<IteratorResult<TChunk>> {
      if (originalThrow) {
        return advance(() => originalThrow(error));
      }
      try {
        if (originalReturn) {
          await originalReturn();
        }
      } finally {
        await finalizeFailure(error);
      }
      throw error;
    },

    [Symbol.asyncIterator]() {
      return this;
    },
  };
}
