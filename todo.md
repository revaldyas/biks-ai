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

## B2B Sales Kit Integration (from skill)
- [x] POST /api/generate-sales-kit - SSE endpoint that runs full sales kit workflow
- [x] Seller website deep analysis (extract products, positioning, design language, logo, colors, fonts)
- [x] Prospect website deep analysis (extract pain points, synergies, logo)
- [x] Generate HTML marketing one-pager (self-contained, seller-branded, both logos)
- [x] Generate account brief with synergy table
- [x] Generate personalized outreach email (under 180 words, specific, peer-to-peer)
- [x] Add "Marketing Kit" tab in Step 5 with HTML one-pager preview
- [x] Add download button for the HTML one-pager
- [x] Integrate seller design tokens (colors, fonts) into the generated kit

## Send Kit Email from Marketing Kit Tab
- [x] Add "Send Kit Email" button in Marketing Kit tab (after kit is generated)
- [x] Email contains outreach email body + link to HTML one-pager
- [x] Uses fixed recipient ngurah.linggih@gmail.com via Resend
- [x] Success/failure state display after sending

## Fix City Picker for Exa Search
- [x] Replace city text input with dropdown (Singapore, Jakarta, etc.)
- [x] Ensure Exa search query properly filters by selected city
- [x] Verify companies returned are actually from the chosen city

## Dashboard Redesign (Match Reference Screenshot)
- [x] 4-panel grid layout: Company Summary, Core Value Proposition, Current Customer Segments, New Business Opportunities
- [x] Sticky bottom memory bar with text input and Save button
- [x] New Business Opportunities as clickable list items with arrow → go to Target Accounts
- [x] Remove separate Memory step (Step 3) from wizard flow
- [x] Adjust wizard flow: Hero → Dashboard (with memory) → Target Accounts → Sales Kit
- [x] Navbar shows website URL + Reset button on right side
- [x] Memory saved toast/notification on save

## Bug Fixes & UI Improvements
- [x] Fix active memory pills UI (gepeng/squished) in Target Accounts page
- [x] Add delete memory function (×) in Dashboard memory chips
- [x] Add delete memory function (×) in Target Accounts active memory pills
- [x] Simplify lead cards - smaller, less detail (detail goes to Brief page)
- [x] Remove Find Contact button from lead cards in Target Accounts
- [x] Fix city filter - Exa search still showing Jakarta results regardless of city selection

## Lead Card Enhancements
- [x] Add company summary to lead cards
- [x] Add LinkedIn link to lead cards
- [x] Add location/city to lead cards

## Brief Page Enhancements
- [x] Auto-fetch company contacts (decision makers: CEO, Founder, Director) via Exa when entering Brief page
- [x] Display contacts section in Account Brief tab below Fit Rationale
- [x] Marketing Kit email: send as native HTML email (not link to one-pager)
- [x] Marketing Kit email design: modern, Biks.ai themed, accurate data from selected company

## Strict City Filter & Marketing Kit Email Redesign
- [x] Exa city filter must be strict - only show companies actually from the selected city
- [x] Add multiple validation layers for city filtering (domain, text content, URL)
- [x] Return empty results with message if no companies match the city
- [x] Marketing Kit: remove HTML one-pager attachment/link approach
- [x] Marketing Kit: send as native email with modern design directly in body
- [x] Marketing Kit email: dynamic data from selected company (not hardcoded)
- [x] Marketing Kit email: modern dark-themed design matching Biks.ai aesthetic

## Marketing Kit Email Preview
- [x] Add email preview in Marketing Kit tab before sending
- [x] Render the native HTML email in an iframe so user can review
- [x] Preview shows exactly what will be sent via Resend

## Review Scraper & Pain Points Feature
- [x] POST /api/scrape-reviews - Fetch customer reviews/feedback of prospect company via Exa web search
- [x] LLM analysis of negative reviews to extract pain points
- [x] Map pain points to seller's services/solutions
- [x] Return structured data: reviews, pain points, solution mapping, summary
- [x] Add "Prospect Pain Points" section in Account Brief tab
- [x] Auto-fetch reviews when lead is selected in Brief page
- [x] Display review snippets with star ratings and sentiment indicators (negative filtered first)
- [x] Display pain points with severity badges (high=red, medium=yellow, low=gray)
- [x] Display solution mapping table (Their Pain → Our Solution → Talking Point)
- [x] Loading state while scraping/analyzing
- [x] Error handling: graceful fallback when reviews API fails or returns empty
- [x] Feed pain points into Marketing Kit email generation for personalized outreach
