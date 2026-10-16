# Question publishing and leaderboards

## Add a question

Open **غرفة التحرير → إضافة سؤال**. Choose text, picture, audio or video first. The form then asks for the question, answer, explanation, hint, category and difficulty. Accepted answers, regional scope and tags are optional. No JSON or internal canonical identifiers are needed in this workflow.

Factual questions require a specific HTTPS source and the passage supporting the answer. An editor-authored puzzle instead requires an original-content declaration, provenance and a clear solution/proof. Both enter review; neither publishes automatically. Models cannot declare their output to be source-free original content.

Pictures accept PNG/JPEG/WebP, audio accepts WAV/OGG/MP3 and video accepts MP4/WebM. Files have a 10 MiB maximum. The UI supports selecting or dropping a file, local previews, licensed/owned-content declarations and reuse from the private media library. Audio/video do not autoplay. Enter one main question. Optional accessibility descriptions and text equivalents are available in collapsed details; they are not separate questions. When omitted, the submission endpoint assigns a generic media label instead of copying the question. If submission fails after uploading, retry reuses that asset and preserves the question fields.

Choose **نوع الإجابة → صورة** for a visual solution. Upload a separate PNG/JPEG/WebP image or reuse a licensed picture from the private library. The question and answer images have independent previews and rights declarations. Keep a short textual answer for editorial identity and duplicate checks; the game displays the answer image as the solution, with the explanation in collapsed details. The review card shows both images. The answer asset and its metadata remain unavailable to players until **اكشف الإجابة**, including direct requests to its protected game URL. Text answers continue to work without any extra upload.

Configured private S3-compatible storage is preferred. Without it, private PostgreSQL blob storage makes the free pilot functional. `MEDIA_DATABASE_BUDGET_BYTES` defaults to 104857600 (100 MiB), is enforced atomically, and can be set to 0 to stop new database uploads while keeping existing assets readable. This is a bounded pilot option; use object storage for a substantial media library. Uploaded files survive Render restarts. Ownership, authorization, immutable SHA identity and byte-range checks apply to both stores.

## Review

**مراجعة المحتوى** starts with **بانتظار المراجعة**, rather than mixing previous decisions into the waiting list. Category/difficulty filters and pages of twelve questions support the queue. Separate tabs retain duplicate, approved and rejected records.

Each card has its own category selections, difficulty and review note. Approving/rejecting saves those choices in the same transaction as the decision. Classification changes rerun duplicate checks and are audited. Approval requires valid evidence, an adequate review note and confirmation that similar questions were checked when present. Obvious duplicates cannot be approved. A stale revision returns a conflict and must be refreshed.

After a successful decision, the card immediately leaves the active queue. It remains in decision history. Editing a draft uses normal text fields, with an advanced JSON option for other formats. Approved canonical IDs and exposure history are never reset by these workflows.

## Suggestions and AI

**اقتراحات الأسئلة** ranks editorial targets using approved categories, levels, formats and regions, review decisions, current valid inventory and existing pending drafts. Cards explain the recommendation. Review an existing backlog first, compose a new question or request supported generation. Manual shortcuts for advanced text formats explicitly offer a text question; exact advanced formats can be imported or generated where enabled.

The recommendation engine runs without an external model. It is an explainable ranking algorithm, not a newly trained language model. Optional model generation privately uses up to three approved examples as editorial style context, and enforces the requested category, difficulty, format and region. Examples are not permission to copy questions. Free arithmetic generation also respects selected levels. No generator creates invented media asset IDs.

The free pilot keeps `GENERATION_DAILY_BUDGET_CENTS=0`; live model generation requires securely configured provider credentials and a positive operator budget. All proposals remain subject to human review and duplicate checks. There were no paid provider calls during implementation.

## Leaderboards

**لوحة الصدارة** ranks registered, opted-in accounts or host-owned teams by total points, completed games or wins. New accounts default to private. Opting in makes the username/statistics and hosted team names/results public. Opting out removes them immediately.

Before play, choose **فريق حسابك في هذه اللعبة** and assign a team to each linked participant token. Written player names alone are not account links. Only registered accounts with recorded pre-game team assignments receive their team's completed result. Guest or historical unassigned games do not invent individual credit. Each completed game counts once; draws award no win; scoring retries cannot add another result.

Team identities combine the host profile and normalized team name, keeping identically named teams belonging to different hosts separate. Ambiguous historical games with identical opposing team names are excluded. These are friendly, host-adjudicated team results rather than independently verified individual scores.

## Routes

- `POST /api/admin/submissions`: guided question submission; editor/admin only.
- `GET /api/admin/media`: private paginated media metadata, filtered by format.
- `POST /api/admin/media`: private validated upload.
- `GET /api/games/:id/answer-media/:instanceId`: host-only answer image, available after reveal with private byte-range delivery.
- `GET /api/admin/review-queue`: status/category/difficulty filters and pagination.
- `POST /api/admin/candidates/:id/review`: revision-checked decision with category/difficulty choices.
- `GET /api/admin/suggestions`: editor-only recommendation targets and provider readiness.
- `POST /api/admin/jobs`: bounded generation with selected difficulty, format and region.
- `GET /api/leaderboard`: public opt-in rankings by view/metric/page.
- `GET|POST /api/account/leaderboard`: authenticated privacy preference.

Mutations retain the same-origin and `X-Nabeeh-Request: 1` requirements. Account export includes the leaderboard preference and recorded team memberships; deletion removes the public account identity. GitHub checks now run on `nabeeh-launch` pushes as well as main/PRs.
