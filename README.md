# FillNode

A modern, open-source customer engagement platform. Centralize all your customer conversations across multiple channels into one unified inbox.

---

## Features

### Omnichannel Inbox

Manage all customer conversations from a single dashboard. FillNode supports:

- **Website Live Chat** - Real-time chat widget for your website
- **Email** - Forward support emails into shared inboxes
- **Facebook Messenger** - Connect your Facebook pages
- **Instagram DM** - Respond to Instagram direct messages
- **WhatsApp** - Integrate with WhatsApp Business API
- **Telegram** - Connect Telegram bots
- **SMS** - Twilio-powered SMS support
- **Line** - Line messaging integration
- **API Channel** - Build custom integrations via REST API

### Help Center Portal

Publish help articles, FAQs, and guides through the built-in Help Center. Enable customers to find answers on their own and reduce repetitive support queries.

### Collaboration & Productivity

- Private Notes and @mentions for internal team discussions
- Labels to organize and categorize conversations
- Keyboard Shortcuts and Command Bar for quick navigation
- Canned Responses for frequently asked questions
- Auto-Assignment to route conversations based on agent availability
- Multi-lingual Support for serving customers in multiple languages
- Custom Views and Filters for better inbox organization
- Business Hours and Auto-Responders to manage response expectations
- Teams and Automation tools for scaling support workflows

### Customer Data & Segmentation

- Contact Management with profiles and interaction history
- Contact Segments and Notes for targeted communication
- Campaigns to proactively engage customers
- Custom Attributes for storing additional customer data
- Pre-Chat Forms to collect user information before starting conversations

### Integrations

- **Slack** - Manage conversations directly from Slack
- **Dialogflow** - Chatbot automation
- **Dashboard Apps** - Embed internal tools within FillNode
- **Shopify** - View and manage customer orders
- **Google Translate** - Translate messages in real-time
- **Linear** - Create and manage Linear tickets
- **Webhooks** - Build custom integrations via HTTP callbacks

### Reports & Insights

- Live View of ongoing conversations for real-time monitoring
- Conversation, Agent, Inbox, Label, and Team Reports
- CSAT Reports to measure customer satisfaction
- Downloadable Reports for offline analysis

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Ruby on Rails 7.1 |
| Frontend | Vue.js 3 + Vite |
| Database | PostgreSQL |
| Cache | Redis |
| Background Jobs | Sidekiq |
| Styling | Tailwind CSS |
| Real-time | Action Cable (WebSocket) |

---

## Getting Started

### Prerequisites

- Ruby 3.4.4
- Node.js 24.x
- pnpm 10.x
- PostgreSQL
- Redis

### Installation

```bash
# Clone the repository
git clone https://github.com/irfanmuhammedharis/fillnode.git
cd fillnode

# Install dependencies
bundle install
pnpm install

# Setup database
cp .env.example .env
# Edit .env with your database and Redis credentials
bundle exec rails db:prepare

# Start the development server
foreman start -f Procfile.dev
```

The application will be available at `http://localhost:3000`.

### Default Login (Development)

After running `db:prepare`, seed data is created:

- **Email:** john@acme.inc
- **Password:** Password1!

---

## Configuration

All configuration is managed through environment variables. Copy `.env.example` to `.env` and update the values:

```bash
cp .env.example .env
```

Key configurations:

| Variable | Description |
|----------|-------------|
| `SECRET_KEY_BASE` | Secret key for Rails |
| `FRONTEND_URL` | URL where the app is accessible |
| `REDIS_URL` | Redis connection URL |
| `POSTGRES_*` | PostgreSQL credentials |

---

## Project Structure

```
app/
  controllers/      # Rails API controllers
  models/           # ActiveRecord models
  services/         # Business logic services
  jobs/             # Background job classes
  views/            # ERB templates
  javascript/
    dashboard/      # Vue.js dashboard application
      routes/       # Frontend routing
      components/   # Vue components
      store/        # Vuex state management
      api/          # API client modules
      i18n/         # Internationalization
    widget/         # Chat widget
    shared/         # Shared utilities and composables
config/             # Rails configuration
db/                 # Database migrations and seeds
lib/                # Ruby libraries and utilities
theme/              # Tailwind theme (colors, icons)
public/             # Static assets and brand logos
```

---

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'feat: add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## License

Released under the [MIT License](LICENSE).
