# Biks.ai - Project TODO

## Core Infrastructure
- [x] Set up environment secrets (EXA_API_KEY, MEM0_API_KEY, RESEND_API_KEY)
- [x] Configure dark theme global styles and fonts (Inter, DM Serif Display)
- [x] Remove Tailwind/shadcn dependencies from frontend, use inline CSS only

## API Routes
- [x] POST /api/analyze-website - SSE streaming website analysis via built-in LLM
- [x] GET/POST/DELETE /api/mem0 - Memory CRUD via Mem0 API
- [x] POST /api/exa-search - Lead discovery via Exa API
- [x] POST /api/find-contacts - Contact finder via Exa LinkedIn search
- [x] POST /api/generate-brief - SSE streaming sales kit generation via built-in LLM
- [x] POST /api/send-email - Send outreach email via Resend API

## Frontend - Step 1: Hero / URL Input
- [x] Full-screen hero with URL input field
- [x] Analyze button triggers SSE stream
- [x] Real-time progress display during analysis
- [x] Transition to Step 2 on completion

## Frontend - Step 2: Business Dashboard
- [x] Display company summary, value proposition
- [x] Display products/services list
- [x] Display proof points
- [x] Display expansion categories as opportunity cards
- [x] "Next" button to proceed to Step 3

## Frontend - Step 3: Memory Manager
- [x] Two-panel layout with sidebar
- [x] Text input to add new memories
- [x] Memory chips display
- [x] Delete individual memories
- [x] Mem0 API integration (add/fetch/delete)

## Frontend - Step 4: Lead Discovery (Accounts)
- [x] Two-panel layout with sidebar
- [x] Category and city selection
- [x] Exa search integration
- [x] Lead cards with fit score, evidence, source URL
- [x] Accept/Reject actions on each lead
- [x] Rejection feedback saved to Mem0
- [x] Contact finder (CEO/Founder/Director via Exa LinkedIn)
- [x] Memory-influenced lead re-ranking

## Frontend - Step 5: Sales Kit / Meeting Prep Brief
- [x] Two-panel layout with sidebar
- [x] SSE streaming brief generation via built-in LLM
- [x] Three tabs: Account Brief, Outreach Email, Meeting Prep
- [x] Memories used display
- [x] Send email button (Resend integration)
- [x] Email send success/failure state

## App Shell & Navigation
- [x] Persistent navbar on Steps 2-5 with step indicators
- [x] Step-aware routing (done/active/pending states)
- [x] Logo "Biks.ai" with DM Serif Display font
- [x] Reset button to return to Step 1

## Design System (Inline CSS)
- [x] Dark theme: bg #0f0f0f, surface #161616, border #2a2a2a
- [x] Accent colors: blue #5b8af5, green #3ecf8e, red #f5454a
- [x] All styling via inline CSS (no Tailwind/external CSS)
- [x] Custom scrollbar styling
- [x] Animations (fadeIn, pulse, spin)

## Updates - Exa Email & Resend Config
- [x] Exa search should also fetch company email from results
- [x] Configure Resend with fixed from: nura@biks.ai
- [x] Configure Resend with fixed to: ngurah.linggih@gmail.com
- [x] Update send-email endpoint to use fixed recipient
- [x] Update frontend to show fixed recipient instead of input field
