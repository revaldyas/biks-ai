import { useState, useEffect } from "react";
import HeroStep from "./pages/HeroStep";
import DashboardStep from "./pages/DashboardStep";
import AccountsStep from "./pages/AccountsStep";
import BriefStep from "./pages/BriefStep";
import Navbar from "./components/Navbar";
import LoginModal from "./components/LoginModal";
import TrialEndedPage from "./pages/TrialEndedPage";
import HistoryPanel from "./components/HistoryPanel";
import { supabase, isSupabaseConfigured, TRIAL_DAYS } from "./lib/supabase";
import { saveHistory, type HistoryRow } from "./lib/history";

export interface BusinessProfile {
  companyName: string;
  website: string;
  summary: string;
  valueProposition: string;
  valuePropositions?: {
    valueLabel: string;
    valueCopy: string;
    websiteCopy?: string;
  }[];
  currentSegments: string[];
  customerSegments?: {
    segmentLabel: string;
    segmentDescription?: string;
    clientNames: string[];
    websiteCopy?: string;
  }[];
  products: string[];
  proofPoints: string[];
  expansionCategories: ExpansionCategory[];
}

export interface ExpansionCategory {
  name: string;
  whyRelevant: string;
  salesAngle: string;
  painPoints: string[];
  searchQueries: string[];
}

export interface Lead {
  name: string;
  url: string;
  summary: string;
  highlights: string[];
  fitScore: number;
  category: string;
  city: string;
  status: "pending" | "accepted" | "rejected";
  rejectionReason?: string;
  email?: string | null;
  linkedinUrl?: string | null;
}

export interface MemoryItem {
  id: string;
  text: string;
}

export interface Contact {
  name: string;
  title: string;
  linkedinUrl: string;
  source: string;
  verificationStatus?: string;
}

export interface MeetingBrief {
  accountBrief: string;
  fitRationale: string;
  meetingPrep: string;
  discoveryQuestions: string[];
  objectionsAndResponses: { objection: string; response: string }[];
  outreachEmailSubject: string;
  outreachEmailBody: string;
  memoriesUsed: string[];
}

export interface SalesKit {
  accountBrief: string;
  whyRelevantNow: string;
  synergies: { sellerProduct: string; prospectPain: string; evidence: string }[];
  suggestedAngle: string;
  outreachEmailSubject: string;
  outreachEmailBody: string;
  solutions: { title: string; description: string }[];
  whyThisProspect: string[];
  proofStats: { number: string; label: string }[];
  memoriesUsed: string[];
}

export interface ReviewAnalysis {
  reviews: { text: string; rating: number; source: string; sentiment: string }[];
  painPoints: { issue: string; frequency: string; severity: string; evidence: string }[];
  solutionMapping: { painPoint: string; ourSolution: string; talkingPoint: string }[];
  summary: string;
}

function BiksApp({ onSignOut, trialDaysLeft, authed, onRequireAuth }: { onSignOut: () => void; trialDaysLeft: number | null; authed: boolean; onRequireAuth: () => void }) {
  const [step, setStep] = useState(1);
  const [maxStepReached, setMaxStepReached] = useState(1);
  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [brief, setBrief] = useState<MeetingBrief | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [salesKit, setSalesKit] = useState<SalesKit | null>(null);
  const [reviewAnalysis, setReviewAnalysis] = useState<ReviewAnalysis | null>(null);
  const [initialCategory, setInitialCategory] = useState(0);
  const [showHistory, setShowHistory] = useState(false);

  // Save the kit to history the moment it's generated (wraps setSalesKit).
  const handleSetSalesKit = (k: SalesKit | null) => {
    setSalesKit(k);
    if (k && business && selectedLead) {
      saveHistory("kit", selectedLead.name, { business, lead: selectedLead, salesKit: k, contacts });
    }
  };

  // Reopen a saved item — restores state and jumps to its step, no Manus re-run.
  const openHistory = (row: HistoryRow) => {
    const d = row.data || {};
    if (row.kind === "analysis" && d.business) {
      setBusiness(d.business); setMaxStepReached((p) => Math.max(p, 2)); setStep(2);
    } else if (row.kind === "leads" && d.business) {
      setBusiness(d.business); setLeads(d.leads || []); setMaxStepReached((p) => Math.max(p, 3)); setStep(3);
    } else if (row.kind === "kit" && d.business && d.lead) {
      setBusiness(d.business); setSelectedLead(d.lead); setContacts(d.contacts || []);
      setSalesKit(d.salesKit || null); setMaxStepReached((p) => Math.max(p, 4)); setStep(4);
    }
  };

  // Forward progression: advance and remember the furthest step reached.
  const goToStep = (newStep: number) => {
    setStep(newStep);
    setMaxStepReached((prev) => Math.max(prev, newStep));
  };

  // Only allow navigating to a step the user has already reached AND whose
  // required state still exists — never open a blank/invalid view.
  const canNavigateToStep = (targetStep: number) => {
    if (targetStep > maxStepReached) return false;
    if (targetStep === 2) return !!business;
    if (targetStep === 3) return !!business;
    if (targetStep === 4) return !!business && !!selectedLead;
    return false;
  };

  const handleStepClick = (targetStep: number) => {
    if (canNavigateToStep(targetStep)) {
      setStep(targetStep);
    }
  };

  const handleReset = () => {
    setStep(1);
    setMaxStepReached(1);
    setBusiness(null);
    setMemories([]);
    setLeads([]);
    setSelectedLead(null);
    setBrief(null);
    setContacts([]);
    setSalesKit(null);
    setReviewAnalysis(null);
    setInitialCategory(0);
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {step > 1 && (
        <Navbar
          currentStep={step}
          maxStepReached={maxStepReached}
          canNavigateToStep={canNavigateToStep}
          onStepClick={handleStepClick}
          onReset={handleReset}
          website={business?.website || ""}
          onSignOut={onSignOut}
          trialDaysLeft={trialDaysLeft}
          onOpenHistory={() => setShowHistory(true)}
        />
      )}
      {step === 1 && (
        <HeroStep
          onComplete={(data) => { setBusiness(data); saveHistory("analysis", data.companyName, { business: data }); goToStep(2); }}
          onSignOut={authed ? onSignOut : undefined}
          trialDaysLeft={trialDaysLeft}
          authed={authed}
          onRequireAuth={onRequireAuth}
          onOpenHistory={authed ? () => setShowHistory(true) : undefined}
        />
      )}
      {step === 2 && business && (
        <DashboardStep
          business={business}
          memories={memories}
          setMemories={setMemories}
          onSelectCategory={(i) => { setInitialCategory(i); goToStep(3); }}
        />
      )}
      {step === 3 && business && (
        <AccountsStep
          business={business}
          memories={memories}
          setMemories={setMemories}
          leads={leads}
          setLeads={setLeads}
          contacts={contacts}
          setContacts={setContacts}
          onSelectLead={(lead) => { saveHistory("leads", `${lead.category} · ${lead.city}`, { business, leads }); setSelectedLead(lead); setContacts([]); setBrief(null); setSalesKit(null); setReviewAnalysis(null); goToStep(4); }}
          onBack={() => setStep(2)}
          initialCategory={initialCategory}
        />
      )}
      {step === 4 && business && selectedLead && (
        <BriefStep
          business={business}
          lead={selectedLead}
          memories={memories}
          brief={brief}
          setBrief={setBrief}
          contacts={contacts}
          setContacts={setContacts}
          salesKit={salesKit}
          setSalesKit={handleSetSalesKit}
          reviewAnalysis={reviewAnalysis}
          setReviewAnalysis={setReviewAnalysis}
          onBack={() => setStep(3)}
        />
      )}
      <HistoryPanel open={showHistory} onClose={() => setShowHistory(false)} onOpenItem={openHistory} />
    </div>
  );
}

// ── Auth + 7-day-trial gate ────────────────────────────────────────────────
function App() {
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [session, setSession] = useState<any>(null);
  const [trialDaysLeft, setTrialDaysLeft] = useState<number | null>(null);
  const [plan, setPlan] = useState<string>("trial");
  const [showLogin, setShowLogin] = useState(false);

  const loadProfile = async (userId: string) => {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("plan, trial_started_at")
        .eq("id", userId)
        .single();
      if (data) {
        setPlan(data.plan || "trial");
        const started = new Date(data.trial_started_at).getTime();
        const elapsedDays = (Date.now() - started) / 86_400_000;
        setTrialDaysLeft(Math.max(0, Math.ceil(TRIAL_DAYS - elapsedDays)));
      } else {
        // No profile row yet (trigger pending) — fail open: treat as fresh trial.
        setPlan("trial");
        setTrialDaysLeft(TRIAL_DAYS);
      }
    } catch {
      setPlan("trial");
      setTrialDaysLeft(TRIAL_DAYS);
    }
  };

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabase.auth.getSession().then(async ({ data }: any) => {
      setSession(data.session);
      if (data.session?.user) await loadProfile(data.session.user.id);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e: any, s: any) => {
      setSession(s);
      if (s?.user) { await loadProfile(s.user.id); setShowLogin(false); } // close modal on login
      else { setTrialDaysLeft(null); setPlan("trial"); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => { await supabase.auth.signOut(); };

  // No Supabase configured → run the app without auth (graceful fallback).
  if (!isSupabaseConfigured) return <BiksApp authed onSignOut={() => {}} onRequireAuth={() => {}} trialDaysLeft={null} />;

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <div style={{ width: 22, height: 22, border: "2px solid var(--line-strong)", borderTopColor: "var(--sage)", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
      </div>
    );
  }

  // Logged-in but trial expired → upgrade wall.
  const trialExpired = !!session && plan !== "paid" && trialDaysLeft !== null && trialDaysLeft <= 0;
  if (trialExpired) return <TrialEndedPage email={session.user?.email} onSignOut={signOut} />;

  // Landing is visible to everyone; the login modal opens when an unauthenticated
  // user tries to act (clicks Analyze) or hits "Sign in".
  return (
    <>
      <BiksApp
        authed={!!session}
        onSignOut={signOut}
        onRequireAuth={() => setShowLogin(true)}
        trialDaysLeft={session && plan !== "paid" ? trialDaysLeft : null}
      />
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  );
}

export default App;
