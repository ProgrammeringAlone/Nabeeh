# Nabeeh | نبيه
Think fast. Know more. Challenge everyone.

نبيه is an Arabic trivia and party game that brings friends and family together through exciting questions, clever challenges, and friendly competition.

Explore a wide range of categories, from Saudi and Gulf culture, history, science, and geography to football, entertainment, riddles, and much more. Build your teams, choose your categories, use strategic lifelines, collect points, and prove who truly has the sharpest mind.

With a constantly expanding library of verified questions, intelligent question selection, and personalized tracking that keeps previously seen questions out of your regular games, every round brings a fresh challenge.

Whether you're hosting a family gathering, competing with friends, or testing your knowledge against the toughest questions, Nabeeh turns every gathering into a battle of brains.

نبيه — مو كل ذكي يفوز، لكن الفطين يعرف يلعبها صح.

## Development application

Nabeeh now includes an Arabic RTL React application with a TypeScript/Express API and a real PostgreSQL database. Guests can create and complete classic or rapid two-team games, use limited lifelines, resume after refresh, and link history to an account for use on another device. Question exposure and score events are authoritative on the server.

The editor workflow supports candidate imports, global canonical duplicate checks, source review, approval/rejection, corrections that retain question identity, retirement, jobs, reports and audit. An arithmetic generator runs independently of optional model/embedding integrations. Unapproved generated content never enters games. Inventory exhaustion fails explicitly instead of repeating questions.

```sh
npm ci --cache /workspace/.npm-cache
npm run db:local     # separate terminal, keep running
npm run db:migrate
npm run db:seed
npm run db:index-facts
npm run release:prepare  # creates original drafts for human review
npm run dev          # separate terminal
npm run worker       # separate terminal
```

Use Node 24+. Run `npm run build`, `npm test`, and `npm run test:e2e`. The browser runner starts its own app and isolated database. Local defaults require no environment file. Production requires PostgreSQL, HTTPS, secure cookies, and approved release content; development seeds are deliberately excluded in production mode.

- [Research and comparison](docs/research.md): verified public-page observations, documentation claims, and access limitations.
- [Architecture and API](docs/architecture.md): canonical identities, locks, guest linking, security and product decisions.
- [Editorial workflow](docs/content.md): validated imports, source review, generation and semantic integration.
- [Deployment and recovery](docs/deployment.md): local/cloud startup, production configuration and backup guidance.
- [Delivery status](docs/status.md): verified capabilities and remaining work.
- [Free Render + Neon launch](docs/launch.md): setup steps and a path to paid scaling.
- [Release review pack](docs/release-review.md): 36 original drafts, including image/audio/video puzzles.

The pilot is prepared for deployment. Release questions still require your editorial approval, and the hosted service needs validation after deployment. Free hosting has suspension and usage limits; shared Redis, database connection budgets and optional private object storage support future scaling. Live AI and external storage integrations remain unvalidated without provider credentials.
