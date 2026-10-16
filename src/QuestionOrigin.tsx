import { CircleHelp, Cog, Sparkles, UserRound } from "lucide-react";
import "./QuestionOrigin.css";

type Props = {
  kind?: string | null;
  creator?: string | null;
};

/** Only pass creator in the admin editor; public views show the origin alone. */
export function QuestionOrigin({ kind, creator }: Props) {
  const origin =
    kind === "admin" || kind === "ai" || kind === "generator"
      ? kind
      : "unknown";
  const { label, Icon } = {
    admin: { label: "Admin · مشرف", Icon: UserRound },
    ai: { label: "AI · ذكاء اصطناعي", Icon: Sparkles },
    generator: { label: "توليد آلي", Icon: Cog },
    unknown: { label: "المنشئ غير معروف", Icon: CircleHelp },
  }[origin];

  return (
    <span
      className={`question-origin question-origin-${origin}`}
      data-testid="question-origin"
      data-origin={origin}
    >
      <span className="question-origin-context">منشئ السؤال: </span>
      <Icon size={14} aria-hidden="true" />
      <span dir="auto">{label}</span>
      {creator?.trim() && (
        <bdi className="question-origin-creator">{creator}</bdi>
      )}
    </span>
  );
}
