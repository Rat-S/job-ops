import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LlmService } from "./llm/service";
import type { JsonSchemaDefinition } from "./llm/types";

const mockCreateRun = vi.fn().mockResolvedValue({ id: "test-run-id" });
const mockUpdateRun = vi.fn().mockResolvedValue(undefined);

vi.mock("langsmith", () => {
  class Client {
    createRun = mockCreateRun;
    updateRun = mockUpdateRun;
  }
  return { Client };
});

const testSchema: JsonSchemaDefinition = {
  name: "test_schema",
  schema: {
    type: "object",
    properties: {
      value: { type: "string" },
    },
    required: ["value"],
    additionalProperties: false,
  },
};

describe("LlmService Tracing", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.LLM_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "test-api-key";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: { content: JSON.stringify({ value: "hello" }) },
          },
        ],
      }),
    } as Response);
    mockCreateRun.mockClear();
    mockUpdateRun.mockClear();
  });

  afterEach(() => {
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.LANGSMITH_TRACING;
    delete process.env.LANGSMITH_API_KEY;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("does not trace to Langsmith when tracing is disabled (default)", async () => {
    const llm = new LlmService({
      provider: "openrouter",
      apiKey: "test-api-key",
    });

    const result = await llm.callJson({
      model: "test-model",
      messages: [{ role: "user", content: "test" }],
      jsonSchema: testSchema,
    });

    expect(result.success).toBe(true);
    expect(mockCreateRun).not.toHaveBeenCalled();
    expect(mockUpdateRun).not.toHaveBeenCalled();
  });

  it("traces to Langsmith when tracing is enabled and API key is present", async () => {
    process.env.LANGSMITH_TRACING = "true";
    process.env.LANGSMITH_API_KEY = "lsv2_some_test_key";

    const llm = new LlmService({
      provider: "openrouter",
      apiKey: "test-api-key",
    });

    const result = await llm.callJson({
      model: "test-model",
      messages: [{ role: "user", content: "test" }],
      jsonSchema: testSchema,
    });

    expect(result.success).toBe(true);
    expect(mockCreateRun).toHaveBeenCalledTimes(1);
    expect(mockCreateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        name: "LlmService.callJson",
        run_type: "llm",
        inputs: expect.objectContaining({
          model: "test-model",
        }),
      }),
    );
    expect(mockUpdateRun).toHaveBeenCalledTimes(1);
    expect(mockUpdateRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        outputs: { result: { value: "hello" } },
      }),
    );
  });
});
