import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessageRequest } from "./api.types";
import DifyChatClient from "./dify-client";

const request: ChatMessageRequest = {
  query: "hello",
  response_mode: "streaming",
  conversation_id: "",
  user: "user-a",
};

const encoder = new TextEncoder();

function sseLine(data: Record<string, unknown>) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/** An SSE response whose chunks the test pushes one by one. */
function controllableSse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start: (c) => {
      controller = c;
    },
  });
  return {
    response: new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
    fail: (error: Error) => controller.error(error),
  };
}

function sseResponse(...chunks: string[]) {
  const sse = controllableSse();
  chunks.forEach(sse.push);
  sse.close();
  return sse.response;
}

function respondWith(response: Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response)
  );
}

function stream(client = new DifyChatClient()) {
  const onMessage = vi.fn();
  const onCompleted = vi.fn();
  const done = client.streamChatMessage(request, { onMessage, onCompleted });
  return { done, onMessage, onCompleted };
}

describe("DifyChatClient.streamChatMessage", () => {
  beforeEach(() => {
    vi.stubEnv("DIFY_API_KEY", "app-test");
    vi.stubEnv("DIFY_API_BASE_URL", "https://dify.test/v1");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("resolves once the stream has ended and every message was delivered", async () => {
    respondWith(
      sseResponse(
        sseLine({ event: "message", answer: "Hel", conversation_id: "c1" }),
        sseLine({ event: "message", answer: "lo", conversation_id: "c1" }),
        sseLine({ event: "message_end", conversation_id: "c1" })
      )
    );

    const { done, onMessage, onCompleted } = stream();
    await done;

    const answers = onMessage.mock.calls.map(([text]) => text).join("");
    expect(answers).toBe("Hello");
    expect(onCompleted).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "a JSON body",
      () =>
        new Response(
          JSON.stringify({ code: "invalid_param", message: "bad" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        ),
    ],
    [
      "an HTML body",
      () =>
        new Response("<html>502 Bad Gateway</html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        }),
    ],
  ])("rejects on an HTTP error with %s", async (_label, response) => {
    respondWith(response());

    const { done, onCompleted } = stream();

    await expect(done).rejects.toThrow(/status code: (400|502)/i);
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it.each([400, 500])(
    "rejects when the stream carries an error event with status %i",
    async (status) => {
      respondWith(
        sseResponse(
          sseLine({
            event: "message",
            answer: "partial",
            conversation_id: "c1",
          }),
          sseLine({
            event: "error",
            status,
            code: "completion_request_error",
            message: "model overloaded",
          })
        )
      );

      const { done, onCompleted } = stream();

      await expect(done).rejects.toThrow("model overloaded");
      expect(onCompleted).not.toHaveBeenCalled();
    }
  );

  it("rejects when a line has no event", async () => {
    respondWith(sseResponse(sseLine({ message: "unexpected" })));

    await expect(stream().done).rejects.toThrow("unexpected");
  });

  it.each([
    ["an error event without a message", { event: "error", status: 500 }],
    ["an error event with an empty message", { event: "error", message: "" }],
    ["a line without event or message", { foo: 1 }],
  ])("rejects on %s", async (_label, line) => {
    respondWith(sseResponse(sseLine(line)));

    await expect(stream().done).rejects.toThrow(/dify/i);
  });

  it("aborts the request after an error event so the connection is released", async () => {
    const sse = controllableSse();
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) => sse.response
    );
    vi.stubGlobal("fetch", fetchMock);

    const { done } = stream();
    sse.push(sseLine({ event: "error", status: 500, message: "boom" }));
    await expect(done).rejects.toThrow("boom");

    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
  });

  it("rejects when the onCompleted callback throws", async () => {
    respondWith(sseResponse(sseLine({ event: "message_end" })));

    const done = new DifyChatClient().streamChatMessage(request, {
      onMessage: () => {},
      onCompleted: () => {
        throw new Error("callback failed");
      },
    });

    await expect(done).rejects.toThrow("callback failed");
  });

  it("rejects when reading the stream fails midway", async () => {
    const sse = controllableSse();
    respondWith(sse.response);

    const { done, onMessage } = stream();
    sse.push(
      sseLine({ event: "message", answer: "Hel", conversation_id: "c1" })
    );
    await vi.waitFor(() => expect(onMessage).toHaveBeenCalled());
    sse.fail(new Error("socket hang up"));

    await expect(done).rejects.toThrow("socket hang up");
  });

  describe("idle timeout", () => {
    function trackSettled(done: Promise<void>) {
      const state = { settled: false, error: undefined as unknown };
      done.then(
        () => (state.settled = true),
        (error) => {
          state.settled = true;
          state.error = error;
        }
      );
      return state;
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });

    it("rejects when nothing arrives for DIFY_IDLE_TIMEOUT_SEC", async () => {
      vi.stubEnv("DIFY_IDLE_TIMEOUT_SEC", "120");
      respondWith(controllableSse().response);

      const state = trackSettled(stream().done);
      await vi.advanceTimersByTimeAsync(119_000);
      expect(state.settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(state.error).toBeInstanceOf(Error);
      expect(String(state.error)).toMatch(/no response from dify for 120s/i);
    });

    it("restarts the idle countdown when a ping arrives", async () => {
      vi.stubEnv("DIFY_IDLE_TIMEOUT_SEC", "120");
      const sse = controllableSse();
      respondWith(sse.response);

      const state = trackSettled(stream().done);
      await vi.advanceTimersByTimeAsync(100_000);
      sse.push("event: ping\n\n");
      await vi.advanceTimersByTimeAsync(119_000);
      expect(state.settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(String(state.error)).toMatch(/no response from dify/i);
    });
  });
});
