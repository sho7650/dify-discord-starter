/** Public exchanges are mentions, replies and keywords; private ones are /chat. */
export type ConversationKind = "public" | "private";

export interface ConversationScope {
  kind: ConversationKind;
  placeId: string;
  userId: string;
}

/**
 * Remembers the Dify conversation of each conversation scope.
 *
 * - `user` mode: one conversation per place × user × kind.
 * - `channel` mode: public exchanges are shared per place; private
 *   conversations stay per place × user.
 * - any other mode: nothing is remembered, so every call starts afresh.
 */
export class ConversationStore {
  private readonly conversations = new Map<string, string>();

  constructor(private readonly historyMode: string) {}

  public find(scope: ConversationScope): string {
    const key = this.keyOf(scope);
    return (key && this.conversations.get(key)) || "";
  }

  public remember(scope: ConversationScope, conversationId: string): void {
    const key = this.keyOf(scope);
    if (key) this.conversations.set(key, conversationId);
  }

  /** Forgets the public and private conversations `userId` takes part in at `placeId`. */
  public reset(placeId: string, userId: string): void {
    for (const kind of ["public", "private"] as const) {
      const key = this.keyOf({ kind, placeId, userId });
      if (key) this.conversations.delete(key);
    }
  }

  private keyOf({ kind, placeId, userId }: ConversationScope): string {
    switch (this.historyMode) {
      case "user":
        return `${kind}:${placeId}:${userId}`;
      case "channel":
        return kind === "public"
          ? `${kind}:${placeId}`
          : `${kind}:${placeId}:${userId}`;
      default:
        return "";
    }
  }
}
