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

export function generateAnswer(
  dify: DifyChat,
  request: ChatMessageRequest,
  {
    maxMessageLength,
    onConversationId,
    onPing,
    handleChatflowAnswer,
  }: GenerateAnswerOptions
): Promise<Answer> {
  if (request.query.length === 0)
    return Promise.resolve({ messages: [], files: [] });
  return new Promise(async (resolve, reject) => {
    try {
      let buffer = { defaultAnswer: "", chatflowAnswer: "" };
      let files: VisionFile[] = [];
      let fileGenerationThought: ThoughtItem[] = [];
      let bufferType = "defaultMessage";
      await dify.streamChatMessage(request, {
        onMessage: async (answer, isFirstMessage, { conversationId }) => {
          switch (bufferType) {
            case "defaultMessage":
              buffer.defaultAnswer += answer;
              break;
            case "chatflowAnswer":
              buffer.chatflowAnswer += answer;
              break;
          }
          onConversationId(conversationId);
        },
        onFile: async (file: DifyFile) => {
          files.push(file);
        },
        onThought: async (thought) => {
          fileGenerationThought.push(thought);
        },
        onNodeStarted: async (nodeStarted) => {
          switch (nodeStarted.data.node_type) {
            case "llm":
              bufferType = "chatflowAnswer";
              onPing?.();
              break;
            case "tool":
              onPing?.();
              break;
          }
        },
        onNodeFinished: async (nodeFinished) => {
          switch (nodeFinished.data.node_type) {
            case "answer":
              bufferType = "defaultMessage";
              handleChatflowAnswer?.(
                splitMessage(buffer.chatflowAnswer, {
                  maxLength: maxMessageLength,
                }),
                files
              );
              files = [];
              buffer.chatflowAnswer = "";
              break;
            case "tool":
              if (
                nodeFinished.data.title.includes("DALL-E") &&
                nodeFinished.data?.outputs?.files?.length > 0
              ) {
                for (let file of nodeFinished.data.outputs.files!) {
                  files.push(file);
                }
              }
              break;
          }
        },
        onCompleted: () => {
          resolve({
            messages: splitMessage(
              [buffer.chatflowAnswer, buffer.defaultAnswer]
                .filter(Boolean)
                .join("\n\n"),
              {
                maxLength: maxMessageLength,
              }
            ),
            files: files.map((file) => ({
              ...file,
              thought: fileGenerationThought.find(
                (t) => file.id && t.message_files?.includes(file.id)
              ),
            })) as any,
          });
        },
        onPing,
      });
    } catch (error: any) {
      reject(error);
    }
  });
}
