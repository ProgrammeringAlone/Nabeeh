import { z } from "zod";
import { digest, candidateSchema, ingestWith } from "./content.ts";
import { mediaSchema, answerMediaSchema } from "./media.ts";
import { transaction } from "./db.ts";

const submissionSchema = z
  .object({
    text: z.string().trim().min(8).max(600),
    answer: z.string().trim().min(1).max(300),
    explanation: z.string().trim().min(8).max(2000),
    hint: z.string().trim().min(2).max(300),
    categoryIds: z.array(z.string().min(1).max(80)).min(1).max(5),
    difficulty: z.enum(["easy", "medium", "hard", "expert"]),
    format: z.enum(["text", "image", "audio", "video"]),
    region: z.enum(["all", "sa", "kw", "ae", "bh", "qa", "om"]).default("all"),
    aliases: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
    tags: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
    media: mediaSchema.partial({ alt: true }).optional(),
    answerMedia: answerMediaSchema.partial({ alt: true }).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.format === "text" && v.media)
      ctx.addIssue({
        code: "custom",
        path: ["media"],
        message: "السؤال النصي لا يحتاج ملف وسائط.",
      });
  });

export async function submitQuestion(input: unknown, actor: string) {
  const v = submissionSchema.parse(input);
  // The same supporting fact and answer retain one identity across categories and formats.
  const fact = v.explanation.slice(0, 1000);
  const canonical = digest(fact + " " + v.answer);
  const candidate = candidateSchema.parse({
    ...v,
    ...(v.answerMedia
      ? {
          answerMedia: {
            ...v.answerMedia,
            alt: v.answerMedia.alt?.trim() || "صورة الإجابة الصحيحة",
          },
        }
      : {}),
    ...(v.media
      ? {
          media: {
            ...v.media,
            alt:
              v.media.alt?.trim() ||
              (v.format === "image"
                ? "الصورة المرفقة بالسؤال"
                : v.format === "audio"
                  ? "المقطع الصوتي المرفق بالسؤال"
                  : "الفيديو المرفق بالسؤال"),
          },
        }
      : {}),
    fact,
    factKey: "editorial:" + canonical,
    subject: fact.slice(0, 200),
    predicate: "answer",
    deterministic: false,
    provenance:
      "Manually entered through the authenticated admin question form; pending editorial review.",
  });
  return transaction(async (db) => {
    const result = await ingestWith(db, candidate, undefined, {
      kind: "admin",
      createdBy: actor,
    });
    await db.query(
      "INSERT INTO audit_logs(actor_id,action,target,metadata) VALUES($1,'submit-question',$2,$3)",
      [
        actor,
        result.id,
        {
          format: candidate.format,
          difficulty: candidate.difficulty,
          categoryIds: candidate.categoryIds,
          creationKind: "admin",
        },
      ],
    );
    return result;
  });
}
