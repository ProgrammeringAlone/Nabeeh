# Editorial operations

Every model/import candidate enters review, never the playable pool. Exact normalized text, canonical fact key, direction-independent relation/entity signature and global near-match retrieval run before review. Approved variants share the canonical question ID. Exposure constraints operate on canonical IDs across categories and modes.

## Candidate import

Import one object or an array (100 maximum) in the admin dashboard. Fields:

```json
{
  "text": "كم يساوي حاصل 19 ضرب 19؟",
  "answer": "361",
  "aliases": ["٣٦١"],
  "explanation": "19 × 19 = 361.",
  "hint": "احسب 20 × 19 ثم اطرح 19.",
  "factKey": "arithmetic:19x19",
  "subject": "19,19",
  "predicate": "multiply",
  "fact": "19*19=361",
  "categoryIds": ["logic"],
  "difficulty": "medium",
  "format": "text",
  "region": "all",
  "tags": ["حساب"],
  "sources": [],
  "provenance": "Original editor-authored arithmetic challenge",
  "deterministic": true
}
```

Use `easy`, `medium`, `hard`, or `expert`. Text, choice (with 2–8 `options`), ordering, word, image, audio and video challenges are supported by host adjudication. Ordering requires `options` and a matching `orderedAnswer` permutation; saved choice and ordering responses survive refresh. Media requires `media: {assetId, alt, transcript?}` plus first-party or licensed rights metadata in the media library. Provide text equivalents; add appropriate captions before publishing spoken videos. Accepted answers are exact editorial aliases after conservative normalization; no fuzzy automatic correctness. For `choice`, the true answer must be among the options. Region is `all`, `sa`, `kw`, `ae`, `bh`, `qa`, or `om`.

Factual candidates need HTTPS citations with specific source passages. Open each source independently, verify question and answer, check licensing/provenance, record the verification in the review note, and inspect every similar question. A source URL proposed by a model is not evidence of truth. General homepage links in the development seed are discovery references, not release-quality citations; revalidate those entries and replace links with exact pages before production. Sensitive, disputed or time-sensitive facts require corroboration and an expiry/review date. No source-fetching endpoint accepts arbitrary URLs, avoiding server-side request forgery.

The release pack contains 36 original drafts in six challenge categories, including 18 bundled media assets. See release-review.md for exact answers, proofs and review steps. None are approved automatically. The development seed is 48 original questions across 8 categories. Its factual entries are development content. Do not inflate counts or copy competitor questions. The arithmetic generator creates solveable original proposals and normalizes commuted operands into one fact family; even these candidates wait for editor approval.

## Duplicates and semantic analysis

Alef variants, Alef maqsura, diacritics, tatweel, punctuation and digit scripts normalize. Taa marbuta and hamza on waw/ya stay distinct. Normalized hashes are a duplicate signal, not a perfect statement of Arabic semantic equality. Stable subject/relation identifiers and fact keys are required editorial discipline. Reversed relation/entity edges produce identical fact signatures; category and difficulty never create a new fact.

The default lexical/structured retrieval flags ambiguity rather than declaring semantic uniqueness. Set `MODEL_API_KEY`, `MODEL_BASE_URL`, `MODEL_NAME`, and `EMBEDDING_MODEL` on the server to activate the real OpenAI-compatible embedding and similarity-judge integration:

```sh
npm run content:semantic
```

It precomputes vectors, retrieves cosine neighbors (>=0.72), and records advisory same-fact/different/uncertain judgments. All decisions still require human approval. When available, migration 008 enables pgvector with a 1536-dimensional HNSW index; this path passed a real pgvector check with synthetic fixtures. The bounded small-library fallback is unavailable for a populated production semantic library without pgvector. Test recall on an Arabic editorial benchmark before using live semantic results. The verified TLS/proxy transport is tested; live generation, embeddings and model judgments remain unvalidated without credentials. A model is not a mathematical originality oracle. Human-reviewed canonical families are necessary to maintain paraphrase exclusions.

## Generation and availability

Start `npm run worker`. Admins schedule arithmetic or model jobs with bounded counts. Low arithmetic inventory also queues replenishment; other shortages create durable editorial replenishment requests visible in the dashboard. RUN_WORKER=true runs an event-driven worker within the web service; the free service drains work while awake and resumes expired leases after restarting. Jobs use transaction locks, leases, bounded retries, a conservative per-request budget reservation and HTTP timeouts. Semantic embeddings and judges reserve conservative costs against the same daily budget; use provider-side budget limits as well. The free pilot sets GENERATION_DAILY_BUDGET_CENTS=0 and has no model key. No external model call is needed for the original pack. Missing model credentials cause observable failed jobs, not unverified publication. The generator prompt is server-only and contains no personal player data.

Question approval makes content eligible immediately; it never modifies exposures. Empty inventory returns `FRESH_POOL_EXHAUSTED` and rolls back the entire board. Unopened reservations release on explicit abandonment, while exposure persists permanently. Do not silently recycle or automatically reset histories.

## Review quality

- Easy: one widely taught fact or one arithmetic step.
- Medium: specific knowledge or two logical steps.
- Hard: less familiar but well-supported fact or several reasoning steps.
- Expert: specialist material reviewed by a qualified editor.

Use Modern Standard Arabic for factual text and consistent Gulf phrasing in interface copy. Avoid fabricated quotations, misleading hints, approximate fuzzy grading, repeated templates and transient sports statistics without dates. Retiring a question prevents new boards from reserving it; existing boards retain their original content. Admin audit logs record approvals and retirement. Admin role provisioning is CLI-only.

## Promote original development content safely

The editor Library tab provides release-source verification. Supply JSON with `id`, `sources: [{url, citation}]`, and a detailed `note`; alternatively a server-verified arithmetic `verifiedFact` must match both the stored canonical fact and answer. This removes only the development-content restriction, records evidence/reviewer/audit and preserves the canonical ID, categories and every exposure record. Never delete and recreate a question to make it release content. Human verification of a specific source remains necessary; a checked UI box is not an automatic factual validator.

Draft edits rerun validation and similarity checks, increment a revision and retain an audit note. Review/edit API calls carry expectedRevision; a changed draft returns REVIEW_CHANGED for refresh and rereview. Approved content requires the separate correction workflow, retaining canonical identity. Identical media bytes remain the same duplicate signal even if uploaded under another asset ID.
