/**
 * «اسأل Claude» — the question as the LISTENER receives it.
 *
 * One object per waiting question, self-contained: the thread so far, the
 * logged issue it is about, the sheet's history for that machine and mould,
 * and ten-minute links to the photo and to the issue's voice notes. The exact
 * shape is documented for the listener's author in docs/ASK-CLAUDE-LISTENER.md
 * — change the two together.
 */
import { pendingQuestion, type AskThread } from "@/lib/ask";
import { signLink } from "@/lib/ask-crypto";
import { buildHistory, type AskHistory } from "@/lib/ask-history";

export type ListenerQuestion = {
  threadId: string;
  /** The message to answer — the last one in `messages`. */
  messageId: string;
  askedAt: number;
  askedBy: string;
  messages: { id: string; role: "user" | "assistant"; text: string; at: number; photoUrl: string | null }[];
  issue: null | {
    row: number; date: string; machine: string; product: string; category: string;
    description: string; action: string; status: string; note: string;
    /** false = the sheet did not confirm this row in time; the fields are as the phone sent them. */
    verified: boolean;
    issueAudioUrl: string | null;
    solutionAudioUrl: string | null;
  };
  history: AskHistory | null;
  /** true = some of the sheet's history could not be read in time; `missing` names the parts. */
  historyMissing: boolean;
  missing: string[];
};

export async function listenerQuestion(t: AskThread, origin: string, now: number = Date.now()): Promise<ListenerQuestion> {
  const file = (k: "photo" | "audio", id: string) =>
    `${origin}/api/ask/listener/file?t=${encodeURIComponent(signLink({ k, id, th: t.id }, now))}`;
  const pending = pendingQuestion(t)!;
  const { history, historyMissing, missing } = await buildHistory(t.issue);
  const i = t.issue;
  return {
    threadId: t.id,
    messageId: pending.id,
    askedAt: pending.at,
    askedBy: t.email,
    messages: t.messages.map((m) => ({
      id: m.id, role: m.role, text: m.text, at: m.at, photoUrl: m.photoId ? file("photo", m.photoId) : null,
    })),
    issue: i && {
      row: i.row, date: i.date, machine: i.machine, product: i.product, category: i.category,
      description: i.description, action: i.action, status: i.status, note: i.note, verified: i.verified,
      issueAudioUrl: i.verified && i.issueAudioId ? file("audio", i.issueAudioId) : null,
      solutionAudioUrl: i.verified && i.solutionAudioId ? file("audio", i.solutionAudioId) : null,
    },
    history,
    historyMissing,
    missing,
  };
}
