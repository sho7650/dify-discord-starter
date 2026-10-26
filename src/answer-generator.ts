import { ChatMessageRequest } from "./dify-client/api.types";
import DifyChatClient from "./dify-client/dify-client";
import { DifyFile, ThoughtItem, VisionFile } from "./dify-client/dify.types";
import { splitMessage } from "./split-message";

export type DifyChat = Pick<DifyChatClient, "streamChatMessage">;

export type AnswerFile = VisionFile & { thought?: ThoughtItem };

export interface Answer {
  messages: string[];
  files: AnswerFile[];
}

export interface GenerateAnswerOptions {
  maxMessageLength: number;
  onConversationId: (conversationId: string) => void;
  onPing?: () => void;
  handleChatflowAnswer?: (messages: string[], files?: AnswerFile[]) => void;
}

export async function generateAnswer(
  dify: DifyChat,
  request: ChatMessageRequest,
  {
    maxMessageLength,
    onConversationId,
    onPing,
    handleChatflowAnswer,
  }: GenerateAnswerOptions
): Promise<Answer> {
  if (request.query.length === 0) return { messages: [], files: [] };

  const split = (text: string) =>
    splitMessage(text, { maxLength: maxMessageLength });
  const buffer = { defaultAnswer: "", chatflowAnswer: "" };
  let files: VisionFile[] = [];
  const fileGenerationThought: ThoughtItem[] = [];
  let bufferType = "defaultMessage";

  // Callbacks stay synchronous: the client runs them inside its own error
  // handling, whereas a rejected promise returned from one would be dropped.
  await dify.streamChatMessage(request, {
    onMessage: (answer, _isFirstMessage, { conversationId }) => {
      switch (bufferType) {
        case "defaultMessage":
          buffer.defaultAnswer += answer;
          break;
        case "chatflowAnswer":
          buffer.chatflowAnswer += answer;
          break;
      }
      // Partial lines report no conversation; keep the one already known.
      if (conversationId) onConversationId(conversationId);
    },
    onFile: (file: DifyFile) => {
      files.push(file);
    },
    onThought: (thought) => {
      fileGenerationThought.push(thought);
    },
    onNodeStarted: (nodeStarted) => {
      switch (nodeStarted?.data?.node_type) {
        case "llm":
          bufferType = "chatflowAnswer";
          onPing?.();
          break;
        case "tool":
          onPing?.();
          break;
      }
    },
    onNodeFinished: (nodeFinished) => {
      switch (nodeFinished?.data?.node_type) {
        case "answer":
          bufferType = "defaultMessage";
          handleChatflowAnswer?.(split(buffer.chatflowAnswer), files);
          files = [];
          buffer.chatflowAnswer = "";
          break;
        case "tool":
          if (nodeFinished.data.title?.includes("DALL-E")) {
            files.push(...(nodeFinished.data.outputs?.files ?? []));
          }
          break;
      }
    },
    onPing,
  });

  return {
    messages: split(
      [buffer.chatflowAnswer, buffer.defaultAnswer].filter(Boolean).join("\n\n")
    ),
    files: files.map((file) => ({
      ...file,
      thought: fileGenerationThought.find(
        (t) => file.id && t.message_files?.includes(file.id)
      ),
    })) as AnswerFile[],
  };
}
