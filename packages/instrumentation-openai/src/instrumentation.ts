/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  context,
  diag,
  type Attributes,
  type DiagLogger,
  type MeterProvider,
  type TracerProvider,
} from '@opentelemetry/api';
import { isTracingSuppressed } from '@opentelemetry/core';
import {
  ATTR_GEN_AI_CONVERSATION_COMPACTED,
  ATTR_GEN_AI_CONVERSATION_ID,
  ATTR_GEN_AI_OUTPUT_TYPE,
  ATTR_GEN_AI_RESPONSE_STATUS,
  ENV_GENAI_CAPTURE_MESSAGE_CONTENT,
  GEN_AI_OPERATION_NAME_VALUE_CHAT,
  GEN_AI_OPERATION_NAME_VALUE_EMBEDDINGS,
  GEN_AI_PROVIDER_NAME_VALUE_OPENAI,
  TelemetryHandler,
  type EmbeddingInvocation,
  type InferenceInvocation,
} from '@opentelemetry/genai-util';
import {
  InstrumentationBase,
  InstrumentationNodeModuleDefinition,
} from '@opentelemetry/instrumentation';
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  Completions as ChatCompletions,
} from 'openai/resources/chat/completions';
import type {
  CreateEmbeddingResponse,
  EmbeddingCreateParams,
  Embeddings,
} from 'openai/resources/embeddings';
import type {
  Response,
  ResponseCreateParams,
  ResponseOutputItem,
  ResponseStreamEvent,
  Responses,
} from 'openai/resources/responses/responses';
import type { Stream } from 'openai/streaming';
import type { APIPromise } from './internal-types';
import {
  convertResponsesInputToMessages,
  convertResponsesOutputToMessages,
  deriveResponsesFinishReason,
  extractResponsesConversationId,
  extractResponsesSystemInstructions,
  hasCompactionItems,
} from './responses';
import type { OpenAIInstrumentationConfig } from './types';
import {
  ChatStreamAccumulator,
  extractChatInputMessages,
  extractChatOutputMessages,
  extractChatTokenUsage,
  extractResponsesTokenUsage,
  getOpenAIErrorType,
  inferEmbeddingDimensions,
  parseBaseURL,
  resolveCaptureMode,
  responseFormatToOutputType,
} from './utils';
/** @knipignore */
import { PACKAGE_NAME, PACKAGE_VERSION } from './version';

export class OpenAIInstrumentation extends InstrumentationBase<OpenAIInstrumentationConfig> {
  private _telemetryHandler?: TelemetryHandler;
  private _tracerProvider?: TracerProvider;
  private _meterProvider?: MeterProvider;

  constructor(config: OpenAIInstrumentationConfig = {}) {
    super(PACKAGE_NAME, PACKAGE_VERSION, config);

    const envVal = process.env[ENV_GENAI_CAPTURE_MESSAGE_CONTENT]?.trim();
    if (envVal) {
      this.setConfig({
        ...this.getConfig(),
        captureMessageContent: resolveCaptureMode(envVal, this._diag),
      });
    }
  }

  override setConfig(config: OpenAIInstrumentationConfig = {}): void {
    super.setConfig({
      ...config,
      captureMessageContent: resolveCaptureMode(
        config.captureMessageContent,
        this._diag ?? diag
      ),
    });
    this._telemetryHandler = undefined;
  }

  override setTracerProvider(provider: TracerProvider): void {
    super.setTracerProvider(provider);
    this._tracerProvider = provider;
    this._telemetryHandler = undefined;
  }

  override setMeterProvider(provider: MeterProvider): void {
    super.setMeterProvider(provider);
    this._meterProvider = provider;
    this._telemetryHandler = undefined;
  }

  private _getTelemetryHandler(): TelemetryHandler {
    return (this._telemetryHandler ??= new TelemetryHandler({
      instrumentationName: PACKAGE_NAME,
      instrumentationVersion: PACKAGE_VERSION,
      tracerProvider: this._tracerProvider,
      meterProvider: this._meterProvider,
      diag: this._diag,
      contentCaptureMode: resolveCaptureMode(
        this.getConfig().captureMessageContent,
        this._diag
      ),
    }));
  }

  protected init() {
    return [
      new InstrumentationNodeModuleDefinition(
        'openai',
        ['>=4.19.0 <7'],
        module => {
          const modExports =
            module[Symbol.toStringTag] === 'Module'
              ? module.default // ESM
              : module; // CommonJS
          this._wrap(
            modExports.OpenAI.Chat.Completions.prototype,
            'create',
            this._getPatchedChatCompletionsCreate()
          );
          this._wrap(
            modExports.OpenAI.Embeddings.prototype,
            'create',
            this._getPatchedEmbeddingsCreate()
          );
          if (modExports.OpenAI.Responses) {
            this._wrap(
              modExports.OpenAI.Responses.prototype,
              'create',
              this._getPatchedResponsesCreate()
            );
          }

          return modExports;
        },
        module => {
          const modExports =
            module[Symbol.toStringTag] === 'Module'
              ? module.default // ESM
              : module; // CommonJS
          this._unwrap(modExports.OpenAI.Chat.Completions.prototype, 'create');
          this._unwrap(modExports.OpenAI.Embeddings.prototype, 'create');
          if (modExports.OpenAI.Responses) {
            this._unwrap(modExports.OpenAI.Responses.prototype, 'create');
          }
        }
      ),
    ];
  }

  private _failInvocation(
    invocation: InferenceInvocation | EmbeddingInvocation,
    err: unknown
  ): void {
    this._diag.debug('OpenAI APIPromise rejection: %O', err);
    // Chat/Responses spans historically record finish_reasons=["error"] on
    // failure paths; EmbeddingInvocation has no finish reasons.
    if ('setFinishReasons' in invocation) {
      (
        invocation as InferenceInvocation
      ).setFinishReasons(['error']);
    }
    invocation.fail({
      exception: err instanceof Error ? err : undefined,
      errorType: getOpenAIErrorType(err),
    });
  }

  /**
   * Attach streaming telemetry without depending on genai-util's
   * `wrapAsyncStream` (#3831). Wraps OpenAI `Stream#iterator()` once so
   * `.withResponse()` / `.asResponse()` / `.tee()` keep working, records
   * per-chunk timing via `InferenceInvocation.recordStreamChunk()`, and
   * completes the invocation exactly once on end or error.
   *
   * When #3831 lands, this helper can be swapped for
   * `TelemetryHandler.wrapAsyncStream` without changing call-site hooks.
   */
  private _attachStreamTelemetry<TChunk>(
    apiPromise: APIPromise<Stream<TChunk>>,
    invocation: InferenceInvocation,
    createHooks: () => StreamTelemetryHooks<TChunk>
  ): APIPromise<Stream<TChunk>> {
    void apiPromise.then(
      stream => {
        interface StreamWithIterator {
          iterator: (...args: unknown[]) => AsyncIterableIterator<TChunk>;
        }
        const maybeIterator = (stream as unknown as Partial<StreamWithIterator>)
          .iterator;
        if (typeof maybeIterator === 'function') {
          const streamWithIterator = stream as unknown as StreamWithIterator;
          const diagLogger = this._diag;
          let consumed = false;
          this._wrap(streamWithIterator, 'iterator', origIterator => {
            return function wrappedIterator(
              this: StreamWithIterator,
              ...iterArgs: unknown[]
            ) {
              if (consumed) {
                // Preserve OpenAI's consumed-stream error on double iteration;
                // do not attach a second telemetry wrapper.
                return origIterator.apply(this, iterArgs);
              }
              consumed = true;
              const rawIterator = origIterator.apply(this, iterArgs);
              return wrapAsyncIteratorWithTelemetry(
                rawIterator,
                invocation,
                createHooks(),
                diagLogger
              );
            };
          });
          return;
        }

        // Fallback: wrap Symbol.asyncIterator in-place (do not discard the
        // wrapped iterable — a bug in an earlier draft).
        const diagLogger = this._diag;
        this._wrap(
          stream as Stream<TChunk>,
          Symbol.asyncIterator,
          origAsyncIterator => {
            let consumed = false;
            return function wrappedAsyncIterator(
              this: Stream<TChunk>
            ): AsyncIterableIterator<TChunk> {
              const rawIterator = origAsyncIterator.call(this);
              if (consumed) {
                return rawIterator;
              }
              consumed = true;
              return wrapAsyncIteratorWithTelemetry(
                rawIterator,
                invocation,
                createHooks(),
                diagLogger
              );
            };
          }
        );
      },
      err => {
        this._failInvocation(invocation, err);
      }
    );

    return apiPromise;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _getPatchedChatCompletionsCreate(): any {
    const self = this;
    return (original: ChatCompletions['create']) => {
      // https://platform.openai.com/docs/api-reference/chat/create
      return function patchedCreate(
        this: ChatCompletions,
        ...args: Parameters<ChatCompletions['create']>
      ) {
        if (!self.isEnabled() || isTracingSuppressed(context.active())) {
          return original.apply(this, args);
        }

        self._diag.debug('OpenAI.Chat.Completions.create args: %O', args);
        const params = args[0];
        const handler = self._getTelemetryHandler();

        let invocation: InferenceInvocation;
        try {
          invocation = self._startChatCompletionsInvocation(
            handler,
            params,
            this?._client?.baseURL
          );
        } catch (err) {
          self._diag.error('unexpected error starting span:', err);
          return original.apply(this, args);
        }

        let apiPromise: APIPromise<
          Stream<ChatCompletionChunk> | ChatCompletion
        >;
        try {
          apiPromise = invocation.withContext(() =>
            original.apply(this, args)
          ) as APIPromise<Stream<ChatCompletionChunk> | ChatCompletion>;
        } catch (err) {
          self._failInvocation(invocation, err);
          throw err;
        }

        if (isStreamPromise(params, apiPromise)) {
          return self._attachStreamTelemetry(apiPromise, invocation, () => {
            const accumulator = new ChatStreamAccumulator(
              invocation.shouldCaptureContent()
            );
            return {
              onChunk: chunk => {
                self._diag.debug(
                  'OpenAI.Chat.Completions.create stream chunk: %O',
                  chunk
                );
                accumulator.onChunk(chunk, invocation);
              },
              onEnd: () => {
                accumulator.finalize(invocation);
              },
            };
          });
        }

        void apiPromise.then(
          result => {
            self._onChatCompletionsCreateResult(
              invocation,
              result as ChatCompletion
            );
          },
          err => {
            self._failInvocation(invocation, err);
          }
        );

        return apiPromise;
      };
    };
  }

  private _startChatCompletionsInvocation(
    handler: TelemetryHandler,
    params: ChatCompletionCreateParams,
    baseURL: string | undefined
  ): InferenceInvocation {
    const { serverAddress, serverPort } = parseBaseURL(baseURL, this._diag);
    const maxTokens =
      typeof params.max_completion_tokens === 'number'
        ? params.max_completion_tokens
        : typeof params.max_tokens === 'number'
          ? params.max_tokens
          : undefined;
    const stopSequences =
      params.stop == null
        ? undefined
        : Array.isArray(params.stop)
          ? params.stop
          : [params.stop];

    const initialAttrs: Attributes = {};
    const outputType = responseFormatToOutputType(params.response_format);
    if (outputType) {
      initialAttrs[ATTR_GEN_AI_OUTPUT_TYPE] = outputType;
    }

    const captureContent = handler.shouldCaptureContent();

    return handler.startInference({
      providerName: GEN_AI_PROVIDER_NAME_VALUE_OPENAI,
      operationName: GEN_AI_OPERATION_NAME_VALUE_CHAT,
      requestModel: params.model,
      serverAddress,
      serverPort,
      attributes: initialAttrs,
      requestOptions: {
        temperature: params.temperature ?? undefined,
        topP: params.top_p ?? undefined,
        maxTokens,
        stopSequences,
        frequencyPenalty: params.frequency_penalty ?? undefined,
        presencePenalty: params.presence_penalty ?? undefined,
        choiceCount: params.n ?? undefined,
        seed: params.seed ?? undefined,
        stream: params.stream ? true : undefined,
        reasoningLevel: params.reasoning_effort ?? undefined,
      },
      inputMessages: captureContent
        ? extractChatInputMessages(params.messages)
        : undefined,
    });
  }

  private _onChatCompletionsCreateResult(
    invocation: InferenceInvocation,
    result: ChatCompletion
  ): void {
    this._diag.debug('OpenAI.Chat.Completions.create result: %O', result);
    try {
      if (result.id) {
        invocation.setResponseId(result.id);
      }
      if (result.model) {
        invocation.setResponseModel(result.model);
      }
      if (Array.isArray(result.choices)) {
        invocation.setFinishReasons(
          result.choices.map(c => c.finish_reason ?? '')
        );
        if (invocation.shouldCaptureContent()) {
          invocation.addOutputMessages(
            extractChatOutputMessages(result.choices)
          );
        }
      }
      const usage = extractChatTokenUsage(result.usage);
      if (usage) {
        invocation.setUsage(usage);
      }
    } catch (err) {
      this._diag.error(
        'unexpected error getting telemetry from chat result:',
        err
      );
    } finally {
      invocation.stop();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _getPatchedEmbeddingsCreate(): any {
    const self = this;
    return (original: Embeddings['create']) => {
      // https://platform.openai.com/docs/api-reference/embeddings/create
      return function patchedCreate(
        this: Embeddings,
        ...args: Parameters<Embeddings['create']>
      ) {
        if (!self.isEnabled() || isTracingSuppressed(context.active())) {
          return original.apply(this, args);
        }

        self._diag.debug('OpenAI.Embeddings.create args: %O', args);
        const params = args[0];
        const handler = self._getTelemetryHandler();

        let invocation: EmbeddingInvocation;
        try {
          invocation = self._startEmbeddingsInvocation(
            handler,
            params,
            this?._client?.baseURL
          );
        } catch (err) {
          self._diag.error('unexpected error starting span:', err);
          return original.apply(this, args);
        }

        let apiPromise: APIPromise<CreateEmbeddingResponse>;
        try {
          apiPromise = invocation.withContext(() =>
            original.apply(this, args)
          ) as APIPromise<CreateEmbeddingResponse>;
        } catch (err) {
          self._failInvocation(invocation, err);
          throw err;
        }

        void apiPromise.then(
          result => {
            self._onEmbeddingsCreateResult(invocation, params, result);
          },
          err => {
            self._failInvocation(invocation, err);
          }
        );

        return apiPromise;
      };
    };
  }

  private _startEmbeddingsInvocation(
    handler: TelemetryHandler,
    params: EmbeddingCreateParams,
    baseURL: string | undefined
  ): EmbeddingInvocation {
    const { serverAddress, serverPort } = parseBaseURL(baseURL, this._diag);
    return handler.startEmbedding({
      providerName: GEN_AI_PROVIDER_NAME_VALUE_OPENAI,
      operationName: GEN_AI_OPERATION_NAME_VALUE_EMBEDDINGS,
      requestModel: params.model,
      encodingFormats:
        params.encoding_format != null ? [params.encoding_format] : undefined,
      dimensionCount: params.dimensions ?? undefined,
      serverAddress,
      serverPort,
    });
  }

  private _onEmbeddingsCreateResult(
    invocation: EmbeddingInvocation,
    params: EmbeddingCreateParams,
    result: CreateEmbeddingResponse
  ): void {
    this._diag.debug('OpenAI.Embeddings.create result: %O', result);
    try {
      if (result.model) {
        invocation.setResponseModel(result.model);
      }
      if (params.dimensions == null) {
        const inferredDims = inferEmbeddingDimensions(
          result.data?.[0]?.embedding as number[] | string | undefined
        );
        if (inferredDims !== undefined) {
          invocation.setDimensionCount(inferredDims);
        }
      }
      if (result.usage?.prompt_tokens !== undefined) {
        invocation.setUsage(result.usage.prompt_tokens);
      }
    } catch (err) {
      this._diag.error(
        'unexpected error getting telemetry from embeddings result:',
        err
      );
    } finally {
      invocation.stop();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _getPatchedResponsesCreate(): any {
    const self = this;
    return (original: Responses['create']) => {
      // https://platform.openai.com/docs/api-reference/responses/create
      return function patchedCreate(
        this: Responses,
        ...args: Parameters<Responses['create']>
      ) {
        if (!self.isEnabled() || isTracingSuppressed(context.active())) {
          return original.apply(this, args);
        }

        self._diag.debug('OpenAI.Responses.create args: %O', args);
        const params = args[0];
        const handler = self._getTelemetryHandler();

        let invocation: InferenceInvocation;
        try {
          invocation = self._startResponsesInvocation(
            handler,
            params,
            this?._client?.baseURL
          );
        } catch (err) {
          self._diag.error('unexpected error starting span:', err);
          return original.apply(this, args);
        }

        let apiPromise: APIPromise<Stream<ResponseStreamEvent> | Response>;
        try {
          apiPromise = invocation.withContext(() =>
            original.apply(this, args)
          ) as APIPromise<Stream<ResponseStreamEvent> | Response>;
        } catch (err) {
          self._failInvocation(invocation, err);
          throw err;
        }

        if (isStreamPromise(params, apiPromise)) {
          return self._attachStreamTelemetry(apiPromise, invocation, () =>
            self._createResponsesStreamHooks(invocation)
          );
        }

        void apiPromise.then(
          result => {
            self._onResponsesCreateResult(invocation, result as Response);
          },
          err => {
            self._failInvocation(invocation, err);
          }
        );

        return apiPromise;
      };
    };
  }

  private _startResponsesInvocation(
    handler: TelemetryHandler,
    params: ResponseCreateParams,
    baseURL: string | undefined
  ): InferenceInvocation {
    const { serverAddress, serverPort } = parseBaseURL(baseURL, this._diag);
    const conversationId = extractResponsesConversationId(params.conversation);
    const outputType = responseFormatToOutputType(params.text?.format);

    const initialAttrs: Attributes = {};
    if (outputType) {
      initialAttrs[ATTR_GEN_AI_OUTPUT_TYPE] = outputType;
    }
    if (hasCompactionItems(params.input)) {
      initialAttrs[ATTR_GEN_AI_CONVERSATION_COMPACTED] = true;
    }

    const captureContent = handler.shouldCaptureContent();

    return handler.startInference({
      providerName: GEN_AI_PROVIDER_NAME_VALUE_OPENAI,
      operationName: GEN_AI_OPERATION_NAME_VALUE_CHAT,
      requestModel: params.model,
      conversationId,
      serverAddress,
      serverPort,
      attributes: initialAttrs,
      requestOptions: {
        temperature: params.temperature ?? undefined,
        topP: params.top_p ?? undefined,
        maxTokens: params.max_output_tokens ?? undefined,
        stream: params.stream ? true : undefined,
        reasoningLevel: params.reasoning?.effort ?? undefined,
      },
      systemInstructions: captureContent
        ? extractResponsesSystemInstructions(params.instructions)
        : undefined,
      inputMessages: captureContent
        ? convertResponsesInputToMessages(params.input)
        : undefined,
    });
  }

  private _createResponsesStreamHooks(
    invocation: InferenceInvocation
  ): StreamTelemetryHooks<ResponseStreamEvent> {
    const completedItems: ResponseOutputItem[] = [];
    let terminalResponse: Response | undefined;
    let streamErrorType: string | undefined;

    return {
      onChunk: event => {
        this._diag.debug('OpenAI.Responses.create stream event: %O', event);
        switch (event.type) {
          case 'response.created':
          case 'response.in_progress': {
            const response = event.response;
            if (response.id) {
              invocation.setResponseId(response.id);
            }
            if (response.model) {
              invocation.setResponseModel(response.model);
            }
            const convId = extractResponsesConversationId(
              response.conversation
            );
            if (convId) {
              invocation.setAttribute(ATTR_GEN_AI_CONVERSATION_ID, convId);
            }
            break;
          }
          case 'response.output_item.done': {
            completedItems.push(event.item);
            break;
          }
          case 'response.completed':
          case 'response.incomplete': {
            terminalResponse = event.response;
            break;
          }
          case 'response.failed': {
            terminalResponse = event.response;
            streamErrorType = event.response.error?.code ?? 'response_failed';
            break;
          }
          case 'error': {
            streamErrorType = event.code ?? 'stream_error';
            break;
          }
        }
      },
      onEnd: () => {
        if (terminalResponse) {
          this._applyResponsesMetadataAndContent(
            invocation,
            terminalResponse,
            completedItems
          );
        } else if (completedItems.length > 0) {
          if (hasCompactionItems(completedItems)) {
            invocation.setAttribute(ATTR_GEN_AI_CONVERSATION_COMPACTED, true);
          }
          const finishReason = deriveResponsesFinishReason(completedItems);
          invocation.setFinishReasons([finishReason]);
          if (invocation.shouldCaptureContent()) {
            invocation.addOutputMessages(
              convertResponsesOutputToMessages(completedItems, finishReason)
            );
          }
        }

        if (streamErrorType) {
          invocation.fail({ errorType: streamErrorType });
        }
      },
    };
  }

  private _applyResponsesMetadataAndContent(
    invocation: InferenceInvocation,
    result: Response,
    fallbackItems?: ReadonlyArray<ResponseOutputItem>
  ): void {
    if (result.id) {
      invocation.setResponseId(result.id);
    }
    if (result.model) {
      invocation.setResponseModel(result.model);
    }
    const convId = extractResponsesConversationId(result.conversation);
    if (convId) {
      invocation.setAttribute(ATTR_GEN_AI_CONVERSATION_ID, convId);
    }
    if (result.status) {
      invocation.setAttribute(ATTR_GEN_AI_RESPONSE_STATUS, result.status);
    }

    const usage = extractResponsesTokenUsage(result.usage);
    if (usage) {
      invocation.setUsage(usage);
    }

    const outputItems =
      Array.isArray(result.output) && result.output.length > 0
        ? result.output
        : (fallbackItems ?? []);

    if (hasCompactionItems(outputItems)) {
      invocation.setAttribute(ATTR_GEN_AI_CONVERSATION_COMPACTED, true);
    }

    const finishReason = deriveResponsesFinishReason(
      outputItems,
      result.status,
      result.incomplete_details
    );
    invocation.setFinishReasons([finishReason]);

    if (invocation.shouldCaptureContent() && outputItems.length > 0) {
      invocation.addOutputMessages(
        convertResponsesOutputToMessages(outputItems, finishReason)
      );
    }
  }

  private _onResponsesCreateResult(
    invocation: InferenceInvocation,
    result: Response
  ): void {
    this._diag.debug('OpenAI.Responses.create result: %O', result);
    let errorType: string | undefined;
    try {
      this._applyResponsesMetadataAndContent(invocation, result);
      if (result.status === 'failed') {
        errorType = result.error?.code ?? 'response_failed';
      }
    } catch (err) {
      this._diag.error(
        'unexpected error getting telemetry from responses result:',
        err
      );
    } finally {
      if (errorType) {
        invocation.fail({ errorType });
      } else {
        invocation.stop();
      }
    }
  }
}

interface StreamTelemetryHooks<TChunk> {
  onChunk?: (chunk: TChunk) => void | Promise<void>;
  onEnd?: () => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
}

/**
 * Main-compatible stand-in for genai-util `wrapAsyncStream` (#3831).
 * Records chunk timing and completes the invocation exactly once.
 */
function wrapAsyncIteratorWithTelemetry<TChunk>(
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

  return {
    async next(...args): Promise<IteratorResult<TChunk>> {
      try {
        const result = await originalNext(...args);
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
      try {
        if (originalThrow) {
          const result = await originalThrow(error);
          if (result.done) {
            await finalizeFailure(error);
          }
          return result;
        }
      } catch (inner) {
        await finalizeFailure(inner);
        throw inner;
      }
      await finalizeFailure(error);
      throw error;
    },

    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

function isStreamPromise<
  Params extends { stream?: boolean | null } | undefined,
  Chunk,
  NonStream,
>(
  params: Params,
  value: APIPromise<Stream<Chunk> | NonStream>
): value is APIPromise<Stream<Chunk>> {
  return Boolean(params?.stream);
}
