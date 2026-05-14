# FillNode Development Guidelines

FillNode is an open-source customer engagement platform built as a Ruby on Rails 7.1 monolith with a Vue.js 3 frontend. It centralizes customer conversations from multiple channels (live chat, email, Facebook Messenger, Instagram, WhatsApp, Telegram, SMS, Line, API) into a unified inbox, and includes a Help Center portal, automation rules, canned responses, team management, reporting, and AI-powered features.

---

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Backend | Ruby on Rails | 7.1 (Ruby 3.4.4) |
| Frontend | Vue.js | 3.5.x |
| Build Tool | Vite | 5.4.x |
| Package Manager | pnpm | 10.x |
| Database | PostgreSQL | 16+ (with pgvector extension) |
| Cache / PubSub | Redis | 6+ |
| Background Jobs | Sidekiq | 7.3+ |
| Search | OpenSearch (via searchkick) | — |
| CSS Framework | Tailwind CSS | 3.4.x |
| Real-time | Action Cable (WebSocket) | — |
| Testing (Backend) | RSpec | — |
| Testing (Frontend) | Vitest | 3.0.x |
| Node.js | | 24.x |

### Key Backend Gems
- **Authentication**: `devise`, `devise_token_auth`, `jwt`, `pundit`
- **2FA**: `devise-two-factor`
- **Channels**: `twilio-ruby`, `facebook-messenger`, `line-bot-api`, `koala`, `slack-ruby-client`, `twitty`
- **AI / LLM**: `ruby-openai`, `ai-agents`, `ruby_llm`, `ruby_llm-schema`, `neighbor`, `pgvector`
- **Storage**: `aws-sdk-s3`, `azure-storage-blob`, `google-cloud-storage`, `image_processing`
- **Observability**: `sentry-rails`, `datadog`, `newrelic_rpm`, `scout_apm`, `elastic-apm`
- **Billing**: `stripe`
- **Push**: `fcm`, `web-push`
- **Other**: `sidekiq-cron`, `wisper` (pub/sub), `liquid` (templating), `pg_search`

### Key Frontend Libraries
- **State**: Pinia, Vuex (legacy)
- **Routing**: Vue Router 4
- **HTTP**: Axios
- **i18n**: Vue I18n 9
- **UI**: Floating Vue, Vuedraggable, Vue Datepicker Next
- **Charts**: Chart.js + vue-chartjs
- **Audio/Video**: wavesurfer.js, video.js, videojs-record
- **Icons**: Iconify (via `@egoist/tailwindcss-icons`)

---

## Build / Test / Lint

### Prerequisites
- Ruby 3.4.4 (managed via `rbenv`)
- Node.js 24.x (managed via `.nvmrc`)
- pnpm 10.x
- PostgreSQL 16+ with `pgvector` extension
- Redis 6+

### Setup
```bash
rbenv install $(cat .ruby-version)
eval "$(rbenv init -)"
bundle install
pnpm install
cp .env.example .env
# Edit .env with your database and Redis credentials
bundle exec rails db:prepare
```

### Development
```bash
# Start all services (Rails, Sidekiq, Vite dev server)
pnpm dev
# or
overmind start -f ./Procfile.dev
```

The application runs at `http://localhost:3000` by default.

### Seed Data
```bash
# Minimal seed data for standard feature verification
bundle exec rails db:seed

# Bulk fixture generation for search/performance/manual load scenarios
bundle exec rails search:setup_test_data

# Richer test data via AccountSeeder
bundle exec rails runner "Internal::SeedAccountJob.perform_now(Account.find(<id>))"
# Or UI path: Super Admin → Accounts → Seed
```

Default development login after seeding:
- **Email:** john@acme.inc
- **Password:** Password1!

### Linting
```bash
# JavaScript / Vue
pnpm eslint
pnpm eslint:fix

# Ruby
bundle exec rubocop -a
# or parallel (CI)
bundle exec rubocop --parallel

# SCSS
scss-lint
```

### Testing
```bash
# Frontend (Vitest)
pnpm test
pnpm test:watch
pnpm test:coverage

# Backend (RSpec)
bundle exec rspec spec/path/to/file_spec.rb
bundle exec rspec spec/path/to/file_spec.rb:LINE_NUMBER

# All backend specs
bundle exec rspec
```

### Running Project
```bash
overmind start -f Procfile.dev
```

### Building SDK
```bash
# Builds the chat widget SDK as a single IIFE file to public/packs/js/sdk.js
BUILD_MODE=library vite build
```

---

## Project Structure

### Backend (`app/`)
```
app/
  controllers/          # Rails controllers (API + Web)
    api/                # REST API controllers (v1)
    devise_overrides/   # Custom Devise controllers
    public/             # Public-facing controllers
    super_admin/        # Administrate super admin dashboard
    concerns/           # Shared controller concerns
  models/               # ActiveRecord models
    concerns/           # Shared model concerns
    channel/            # Polymorphic channel types (email, web, etc.)
    integrations/       # Third-party integration models
  services/             # Business logic service objects (primary pattern)
    auto_assignment/
    automation_rules/
    contacts/
    conversations/
    email/
    facebook/
    google/
    instagram/
    internal/
    linear/
    macros/
    messages/
    notification/
    reports/
    twilio/
    whatsapp/
    widget/
    ...
  jobs/                 # Sidekiq background job classes
    agents/
    channels/
    contacts/
    conversations/
    notification/
    ...
  policies/             # Pundit authorization policies
  mailers/              # ActionMailer classes
  mailboxes/            # ActionMailbox mailboxes
  channels/             # ActionCable channels
  listeners/            # Wisper event listeners
  presenters/           # View presenters
  builders/             # Object builders
  finders/              # Query objects
  actions/              # Service-like action classes
  drops/                # Liquid template drops
  fields/               # Custom form fields
  dashboards/           # Administrate dashboard configs
  dispatchers/          # Event dispatchers
  helpers/              # View helpers
  views/                # ERB templates (minimal, mostly API)
```

### Frontend (`app/javascript/`)
```
app/javascript/
  entrypoints/          # Vite entrypoints (one per app)
    dashboard.js
    widget.js
    sdk.js
    portal.js
    survey.js
    v3app.js
    superadmin.js
    superadmin_pages.js
  dashboard/            # Main Vue.js dashboard app
    components/         # Legacy Vue components
    components-next/    # New message bubble components (preferred)
    composables/        # Vue 3 Composition API composables
    store/              # Vuex stores (legacy)
    stores/             # Pinia stores (new)
    routes/             # Vue Router routes
    api/                # API client modules
    i18n/               # i18n messages
    helper/             # Utility functions
    constants/          # Constant values
    mixins/             # Shared Vue mixins (legacy)
    modules/            # Feature modules
    services/           # Frontend service modules
  v3/                   # Next-gen dashboard views (experimental/V3)
  widget/               # Embeddable chat widget
  sdk/                  # Widget SDK source
  portal/               # Help Center portal
  survey/               # CSAT survey app
  shared/               # Shared code across apps
    components/         # Shared Vue components
    composables/        # Shared composables
    helpers/            # Shared utilities
    constants/          # Shared constants
    store/              # Shared store modules
  superadmin_pages/     # Super admin frontend
  design-system/        # Design system assets
```

### Configuration & Infra
```
config/
  routes.rb             # Application routes
  app.yml               # Custom app configuration
  features.yml          # Feature flag definitions
  installation_config.yml # Installation-level config defaults
  sidekiq.yml           # Sidekiq queue configuration
  schedule.yml          # Sidekiq-cron schedules
  initializers/         # Rails initializers
  environments/         # Environment configs
  locales/              # i18n YAML files (backend)
  integration/          # Integration configs
  agents/               # AI agent configs
  llm.yml               # LLM provider configuration
  llm_models.json       # Available LLM models

db/
  migrate/              # 128+ migrations
  schema.rb
  seeds.rb

docker/
  dockerfiles/          # Multi-service Dockerfiles
  entrypoints/          # Container entrypoint scripts

deployment/             # systemd service files & setup scripts
spec/                   # RSpec test suite
  factories/            # FactoryBot factories
  fixtures/             # Test fixtures
  support/              # Test helpers and shared examples
  enterprise/           # Enterprise edition specs
  integration/          # Integration tests
lib/                    # Ruby libraries
  custom_exceptions/    # Domain-specific exceptions
  integrations/         # Integration logic
  llm/                  # LLM utilities
  redis/                # Redis abstractions
  seeders/              # Database seeders
  ...
public/                 # Static assets
  brand-assets/         # Brand logos
  vite-dev/             # Vite dev server output
swagger/                # OpenAPI/Swagger documentation
theme/                  # Tailwind theme
  colors.js             # Custom color palette (Radix UI based)
  icons.js              # Custom icon definitions
```

---

## Code Style

### Ruby
- Follow RuboCop rules (max line length: 150 characters)
- Max class length: 175 lines (except `Message` and `Conversation` models)
- Max method length: 19 lines
- Use compact `module/class` definitions; avoid nested styles
- Use strong params in controllers
- Validate presence/uniqueness in models, add proper indexes
- Prefer custom exceptions in `lib/custom_exceptions/` over generic errors

### Vue / JavaScript
- ESLint: Airbnb base + Vue 3 recommended
- Vue Components: PascalCase
- Events: camelCase
- Always use Composition API with `<script setup>` at the top
- Use PropTypes for type safety in Vue components
- No bare strings in templates; always use i18n

### Styling
- **Tailwind Only**: Do not write custom CSS, scoped CSS, or inline styles. Always use Tailwind utility classes.
- Refer to `tailwind.config.js` for color definitions.
- Colors are based on Radix UI scales (`@radix-ui/colors`).
- Custom icons available via `woot:` prefix in Tailwind classes.

### General
- Clear, descriptive names with consistent casing
- MVP focus: least code change, happy-path only
- No unnecessary defensive programming
- Ship the happy path first, then iterate
- Prefer minimal, readable code over elaborate abstractions
- Break down complex tasks into small, testable units
- Remove dead/unreachable/unused code
- Don't write multiple versions or backups for the same logic

---

## Testing Strategy

### Frontend Tests (Vitest)
- **Runner**: Vitest with jsdom environment
- **Location**: `app/**/*.{test,spec}.?(c|m)[jt]s?(x)`
- **Setup**: `vitest.setup.js` configures Vue Test Utils with i18n and FloatingVue
- **Mocks**: `fake-indexeddb` for IndexedDB mocking
- **Globals**: Enabled (no need to import `describe`, `it`, `expect`)
- **Coverage**: Outputs lcov + text; excludes specs, stories, routes, and i18n files

### Backend Tests (RSpec)
- **Framework**: RSpec Rails with FactoryBot
- **Helpers**: `test-prof` (`before_all`, `let_it_be`) for performance
- **Database**: Transactional fixtures enabled; `database_cleaner` for non-transactional cases
- **Authorization**: Pundit RSpec matchers
- **Background Jobs**: `sidekiq/testing` (inline by default)
- **Request Specs**: Include Skooma for OpenAPI response validation against `swagger/swagger.json`
- **Custom Helpers**: `SlackStubs`, `FileUploadHelpers`, `CsvSpecHelpers`, `InstagramSpecHelpers`
- **Time Travel**: `ActiveSupport::Testing::TimeHelpers`
- **Env Mutation**: Prefer `with_modified_env` (from spec helpers) over stubbing `ENV` directly
- **Parallel/Reloading**: Prefer comparing `error.class.name` over constant class equality when asserting raised errors

### Writing Specs
- Avoid writing specs unless explicitly asked
- Infer spec type from file location (`config.infer_spec_type_from_file_location!`)
- Place Enterprise-specific specs under `spec/enterprise`, mirroring OSS layout

---

## Security Considerations

### Encryption
- **Active Record Encryption** is required for MFA/2FA features.
- Keys: `ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY`, `ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY`, `ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT`
- Generate via: `rails db:encryption:init`
- Supports unencrypted data during migration; deterministic queries match both encrypted and plaintext rows.

### Authentication & Authorization
- Devise Token Auth for API authentication
- Pundit policies for authorization
- OmniAuth for OAuth (Google, Microsoft, SAML)
- CSRF protection for OAuth via `omniauth-rails_csrf_protection`

### Input Safety
- `rack-attack` for throttling abusive requests
- `ssrf_filter` for SSRF-safe URL fetching
- `csv-safe` for CSV injection prevention
- `html2text` and `lettersanitizer` for safe HTML handling
- DOMPurify on frontend for HTML sanitization

### Secrets
- `SECRET_KEY_BASE` must be alphanumeric; avoid special characters
- Never commit `.env`; use `.env.example` as template

---

## Deployment & Operations

### Docker
- Multi-service Docker Compose setup included (`docker-compose.yaml`)
- Services: Rails, Sidekiq, Vite dev server, PostgreSQL (pgvector), Redis, MailHog
- Production Docker Compose: `docker-compose.production.yaml`

### Heroku
- `app.json` for Heroku Button deployment
- `Procfile` defines web and worker processes
- Uses `heroku-24` stack
- Addons: Heroku Redis + Heroku PostgreSQL

### Background Jobs
- Sidekiq queues (highest to lowest priority): `critical`, `high`, `medium`, `default`, `mailers`, `action_mailbox_routing`, `low`, `scheduled_jobs`, `deferred`, `purgrable`, `housekeeping`, `async_database_migration`, `bulk_reindex_low`, `active_storage_*`, `action_mailbox_incineration`
- Concurrency defaults to 10, configurable via `SIDEKIQ_CONCURRENCY`
- Cron jobs defined in `config/schedule.yml`

### Health Checks
- `/health` endpoint available
- `sidekiq_alive` for Sidekiq health monitoring

---

## Internationalization (i18n)

- **Backend**: `config/locales/en.yml` (only update `en.yml`; other languages community-managed)
- **Frontend**: `app/javascript/dashboard/i18n/` (only update English `en.json`)
- No bare strings in Vue templates

---

## Feature Flags

Features are defined in `config/features.yml` with a strict order (never change the order). Examples:
- `inbound_emails`, `channel_email`, `channel_facebook`, `help_center`, `agent_bots`, `macros`, `automations`, `canned_responses`, `integrations`, `custom_attributes`, `disable_branding`, `ip_lookup`, etc.

Check `config/features.yml` for the full canonical list.

---

## Codex Worktree Workflow

- Use a separate git worktree + branch per task to keep changes isolated.
- Keep Codex-specific local setup under `.codex/` and use `Procfile.worktree` for worktree process orchestration.
- The setup workflow in `.codex/environments/environment.toml` should dynamically generate per-worktree DB/port values (Rails, Vite, Redis DB index) to avoid collisions.
- Start each worktree with its own Overmind socket/title so multiple instances can run at the same time.

---

## Commit Messages

- Prefer Conventional Commits: `type(scope): subject` (scope optional)
- Example: `feat(auth): add user authentication`
- Don't reference Claude in commit messages

---

## PR Description Format

- Start with a short, user-facing paragraph describing the product change.
- Add a `Closes` section with relevant issue links (GitHub, Linear, etc.).
- For feature PRs, add `How to test` from a product/UX standpoint.
- For bugfix PRs, use `How to reproduce` when helpful.
- Optionally add a `What changed` section for implementation highlights.
- Do not add a `How this was tested` section listing specs/commands.

---

## Enterprise Edition Notes

- FillNode has an Enterprise overlay under `enterprise/` that extends/overrides OSS code.
- When you add or modify core functionality, always check for corresponding files in `enterprise/` and keep behavior compatible.
- Follow the Enterprise development practices documented here:
  - https://fillnode.help/hc/handbook/articles/developing-enterprise-edition-features-38

### Practical Checklist for Core Logic / Public API Changes
- Search for related files in both trees before editing (e.g., `rg -n "FooService|ControllerName|ModelName" app enterprise`).
- If adding new endpoints, services, or models, consider whether Enterprise needs:
  - An override (e.g., `enterprise/app/...`), or
  - An extension point (e.g., `prepend_mod_with`, hooks, configuration) to avoid hard forks.
- Avoid hardcoding instance- or plan-specific behavior in OSS; prefer configuration, feature flags, or extension points consumed by Enterprise.
- Keep request/response contracts stable across OSS and Enterprise; update both sets of routes/controllers when introducing new APIs.
- When renaming/moving shared code, mirror the change in `enterprise/` to prevent drift.
- Tests: Add Enterprise-specific specs under `spec/enterprise`, mirroring OSS spec layout where applicable.
- When modifying existing OSS features for Enterprise-only behavior, add an Enterprise module (via `prepend_mod_with`/`include_mod_with`) instead of editing OSS files directly—especially for policies, controllers, and services. For Enterprise-exclusive features, place code directly under `enterprise/`.

---

## Branding / White-labeling

- For user-facing strings that currently contain "FillNode" but should adapt to branded/self-hosted installs, prefer applying `replaceInstallationName` from `shared/composables/useBranding` in the UI layer (for example tooltip and suggestion labels) instead of adding hardcoded brand-specific copy.

---

## AI / LLM Integration

- LLM providers and models are configured in `config/llm.yml` and `config/llm_models.json`.
- The `ai-agents` gem and `ruby_llm` are used for AI agent orchestration.
- Captain is the internal AI assistant feature; related code lives in `lib/captain/` and `app/services/` under captain namespaces.
- OpenTelemetry is configured for LLM observability.
