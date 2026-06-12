import { useState } from "react";
import HeroStep from "./pages/HeroStep";
import DashboardStep from "./pages/DashboardStep";
import MemoryStep from "./pages/MemoryStep";
import AccountsStep from "./pages/AccountsStep";
import BriefStep from "./pages/BriefStep";
import Navbar from "./components/Navbar";

export interface BusinessProfile {
  companyName: string;
  website: string;
  summary: string;
  valueProposition: string;
  currentSegments: string[];
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
  memoriesUsed: string[];
  onePagerUrl: string;
}

function App() {
  const [step, setStep] = useState(1);
  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [brief, setBrief] = useState<MeetingBrief | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [salesKit, setSalesKit] = useState<SalesKit | null>(null);

  const handleReset = () => {
    setStep(1);
    setBusiness(null);
    setMemories([]);
    setLeads([]);
    setSelectedLead(null);
    setBrief(null);
    setContacts([]);
    setSalesKit(null);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0f0f0f" }}>
      {step > 1 && (
        <Navbar
          currentStep={step}
          onStepClick={(s) => { if (s < step) setStep(s); }}
          onReset={handleReset}
          website={business?.website || ""}
        />
      )}
      {step === 1 && (
        <HeroStep
          onComplete={(data) => { setBusiness(data); setStep(2); }}
        />
      )}
      {step === 2 && business && (
        <DashboardStep
          business={business}
          onNext={() => setStep(3)}
        />
      )}
      {step === 3 && (
        <MemoryStep
          memories={memories}
          setMemories={setMemories}
          onNext={() => setStep(4)}
          onBack={() => setStep(2)}
        />
      )}
      {step === 4 && business && (
        <AccountsStep
          business={business}
          memories={memories}
          setMemories={setMemories}
          leads={leads}
          setLeads={setLeads}
          contacts={contacts}
          setContacts={setContacts}
          onSelectLead={(lead) => { setSelectedLead(lead); setStep(5); }}
          onBack={() => setStep(3)}
        />
      )}
      {step === 5 && business && selectedLead && (
        <BriefStep
          business={business}
          lead={selectedLead}
          memories={memories}
          brief={brief}
          setBrief={setBrief}
          contacts={contacts}
          salesKit={salesKit}
          setSalesKit={setSalesKit}
          onBack={() => setStep(4)}
        />
      )}
    </div>
  );
}

export default App;
