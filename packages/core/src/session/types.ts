import { ConversationMessage } from "../providers/types.js";

export interface SessionMetadata {
  id: string; // random id, e.g. crypto.randomUUID()
  title: string; // user-editable; defaults to a truncated first user message
  providerId: string;
  model: string;
  createdAt: string; // ISO timestamp
  updatedAt: string;
}

export interface StoredSession {
  metadata: SessionMetadata;
  history: ConversationMessage[];
}