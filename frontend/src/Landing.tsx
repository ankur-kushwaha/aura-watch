import React from 'react';
import {
  Activity,
  ArrowRight,
  Brain,
  Camera,
  Cpu,
  Fingerprint,
  MessageSquare,
  Network,
  Search,
  Shield,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react';

interface LandingProps {
  onSignIn: () => void;
}

const FEATURES = [
  {
    icon: Zap,
    title: 'Edge-Native Detection',
    description:
      'YOLOv8 + ByteTrack run on Pi, Jetson, or your laptop. Motion-triggered clips—not wasteful 24/7 recording.',
    accent: 'primary' as const,
  },
  {
    icon: Brain,
    title: 'AI Video Summaries',
    description:
      'Every clip is analyzed by Gemini. Events are vector-indexed in Qdrant for instant semantic retrieval.',
    accent: 'secondary' as const,
  },
  {
    icon: MessageSquare,
    title: 'Ask Camera AI',
    description:
      'Query footage in plain English. Get cited clips back—"Who walked by in a red shirt after 9 PM?"',
    accent: 'primary' as const,
  },
  {
    icon: Fingerprint,
    title: 'Cross-Camera ReID',
    description:
      'Track people across rooms and cameras. Link identities, merge duplicates, and define topology rules.',
    accent: 'secondary' as const,
  },
  {
    icon: Activity,
    title: 'Live Monitoring',
    description:
      'WebSocket live feeds with motion overlays. Real-time status: Monitoring, Recording, Processing, Offline.',
    accent: 'primary' as const,
  },
  {
    icon: Network,
    title: 'Fleet Management',
    description:
      'One-line edge installer. Add webcams or RTSP streams, remote config, reboot, and device logs from one hub.',
    accent: 'secondary' as const,
  },
];

const USE_CASES = [
  {
    icon: Shield,
    title: 'Home & Office Security',
    description:
      'Smart detection on the edge, cloud intelligence for review. Know what happened without scrubbing hours of footage.',
    queries: ['Was anyone at the front door after midnight?', 'How many visitors today?'],
  },
  {
    icon: Search,
    title: 'Investigations & Compliance',
    description:
      'Search archived events by description, time, or camera. AI summaries and cited clips accelerate incident review.',
    queries: ['Did anyone carry a box between 2–4 PM?', 'Show deliveries to the loading dock this week'],
  },
  {
    icon: Users,
    title: 'Multi-Camera Tracking',
    description:
      'Follow a person from lobby to warehouse. ReID gallery links appearances across your entire camera network.',
    queries: ['Where did Person #12 go after the east hallway?', 'Link these two sightings'],
  },
  {
    icon: Camera,
    title: 'Remote Camera Fleets',
    description:
      'Deploy Raspberry Pi or Jetson agents anywhere. Manage streams, thresholds, and updates from a single dashboard.',
    queries: ['Add RTSP stream', 'Restart edge device remotely'],
  },
];

const EXAMPLE_QUERIES = [
  'Did anyone walk by carrying a box between 2 PM and 4 PM?',
  'Has anyone walked past in a red shirt?',
  'How many people were seen today?',
  'Was anyone detected after 9 PM?',
];

const STEPS = [
  {
    step: '01',
    title: 'Deploy at the Edge',
    description: 'Install the agent on Pi, Jetson, or dev machine. Connect webcams or RTSP streams in minutes.',
  },
  {
    step: '02',
    title: 'Detect & Record Smart',
    description: 'On-device YOLO detects people and vehicles. Clips upload only when motion matters.',
  },
  {
    step: '03',
    title: 'Understand & Search',
    description: 'Gemini summarizes, Qdrant indexes. Ask questions in natural language and get cited answers.',
  },
];

function AccentIcon({
  icon: Icon,
  accent,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accent: 'primary' | 'secondary';
}) {
  const styles =
    accent === 'primary'
      ? 'bg-primary/15 text-primary shadow-[0_0_20px_rgba(124,58,237,0.15)]'
      : 'bg-secondary/15 text-secondary shadow-[0_0_20px_rgba(6,182,212,0.12)]';

  return (
    <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${styles}`}>
      <Icon size={22} />
    </div>
  );
}

export default function Landing({ onSignIn }: LandingProps) {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen relative">
      {/* Nav */}
      <header className="fixed top-0 inset-x-0 z-50 border-b border-white/[0.06] bg-[rgba(10,14,26,0.72)] backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary p-2 rounded-lg shadow-[0_0_15px_rgba(124,58,237,0.25)]">
              <Cpu size={20} color="white" />
            </div>
            <span className="font-heading font-bold text-[1.05rem] tracking-tight">AURA WATCH AI</span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-[0.875rem] text-text-secondary">
            <button type="button" onClick={() => scrollTo('features')} className="hover:text-text-primary transition-colors">
              Features
            </button>
            <button type="button" onClick={() => scrollTo('use-cases')} className="hover:text-text-primary transition-colors">
              Use Cases
            </button>
            <button type="button" onClick={() => scrollTo('how-it-works')} className="hover:text-text-primary transition-colors">
              How It Works
            </button>
          </nav>

          <button type="button" onClick={onSignIn} className="btn btn-primary text-[0.875rem] py-2 px-4">
            Sign In
            <ArrowRight size={15} />
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/[0.04] text-[0.8rem] text-text-secondary mb-8 landing-fade-in">
            <Sparkles size={14} className="text-secondary" />
            Edge surveillance · Vector search · RAG-powered
          </div>

          <p className="text-secondary text-[1.125rem] md:text-[1.35rem] font-medium mb-4 landing-fade-in landing-delay-1">
            What if your security cameras could actually answer back?
          </p>

          <h1 className="text-[2.75rem] md:text-[4rem] font-extrabold leading-[1.08] tracking-tight mb-6 landing-fade-in landing-delay-2">
            <span className="text-gradient">See everything.</span>
            <br />
            <span className="text-gradient-purple">Ask anything.</span>
          </h1>

          <p className="text-text-secondary text-[1.05rem] md:text-[1.15rem] max-w-2xl mx-auto leading-relaxed mb-10 landing-fade-in landing-delay-3">
            Aura Watch AI runs detection on the edge, understands footage in the cloud, and lets you query your
            entire camera network in plain English—with cited clips, not guesswork.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 landing-fade-in landing-delay-4">
            <button type="button" onClick={onSignIn} className="btn btn-primary text-[1rem] px-7 py-3">
              Open Dashboard
              <ArrowRight size={18} />
            </button>
            <button type="button" onClick={() => scrollTo('features')} className="btn btn-secondary text-[1rem] px-7 py-3">
              Explore capabilities
            </button>
          </div>

          {/* Example query pills */}
          <div className="mt-16 max-w-3xl mx-auto landing-fade-in landing-delay-5">
            <p className="text-[0.75rem] uppercase tracking-widest text-text-muted mb-4 font-semibold">
              Questions your cameras can answer
            </p>
            <div className="flex flex-wrap justify-center gap-2.5">
              {EXAMPLE_QUERIES.map((q) => (
                <span
                  key={q}
                  className="text-[0.8rem] text-text-secondary px-4 py-2 rounded-full border border-white/[0.08] bg-white/[0.03] hover:border-primary/30 hover:bg-primary/[0.06] transition-all cursor-default"
                >
                  &ldquo;{q}&rdquo;
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <section className="px-6 pb-20">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { value: 'Edge', label: 'On-device YOLO + tracking' },
            { value: 'RAG', label: 'Natural language search' },
            { value: 'ReID', label: 'Cross-camera identity' },
            { value: 'Live', label: 'Real-time WebSocket feeds' },
          ].map((stat) => (
            <div key={stat.label} className="glass-panel p-5 text-center">
              <div className="text-gradient-purple text-[1.5rem] font-extrabold mb-1">{stat.value}</div>
              <div className="text-[0.8rem] text-text-muted">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="px-6 py-20 scroll-mt-20">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-[2rem] md:text-[2.5rem] font-bold mb-4">Built for real surveillance workloads</h2>
            <p className="text-text-secondary max-w-2xl mx-auto text-[1.05rem]">
              From motion on a Raspberry Pi to semantic search across thousands of events—every layer is designed
              for speed, privacy, and clarity.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="glass-panel interactive p-6 flex flex-col gap-4">
                <AccentIcon icon={feature.icon} accent={feature.accent} />
                <h3 className="text-[1.15rem] font-semibold">{feature.title}</h3>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section id="use-cases" className="px-6 py-20 scroll-mt-20">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-[2rem] md:text-[2.5rem] font-bold mb-4">Where teams put it to work</h2>
            <p className="text-text-secondary max-w-2xl mx-auto text-[1.05rem]">
              Whether you&apos;re securing a single office or orchestrating a multi-site camera fleet, Aura Watch
              adapts to how you actually investigate events.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            {USE_CASES.map((useCase) => (
              <div key={useCase.title} className="glass-panel p-7 flex flex-col gap-4">
                <div className="flex items-start gap-4">
                  <AccentIcon icon={useCase.icon} accent="primary" />
                  <div>
                    <h3 className="text-[1.15rem] font-semibold mb-2">{useCase.title}</h3>
                    <p className="text-text-secondary text-[0.9rem] leading-relaxed">{useCase.description}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 mt-1 pl-[3.75rem]">
                  {useCase.queries.map((q) => (
                    <div
                      key={q}
                      className="text-[0.8rem] text-text-muted flex items-center gap-2 before:content-[''] before:w-1 before:h-1 before:rounded-full before:bg-secondary before:shrink-0"
                    >
                      {q}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="px-6 py-20 scroll-mt-20">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-[2rem] md:text-[2.5rem] font-bold mb-4">From motion to meaning</h2>
            <p className="text-text-secondary max-w-2xl mx-auto text-[1.05rem]">
              Three tiers working together—detect locally, understand globally, investigate instantly.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5 mb-10">
            {STEPS.map((step) => (
              <div key={step.step} className="glass-panel p-7 relative overflow-hidden">
                <span className="text-[3rem] font-extrabold text-white/[0.04] absolute top-4 right-5 select-none">
                  {step.step}
                </span>
                <div className="text-secondary text-[0.75rem] font-bold uppercase tracking-widest mb-3">
                  Step {step.step}
                </div>
                <h3 className="text-[1.15rem] font-semibold mb-3">{step.title}</h3>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>

          {/* Architecture diagram */}
          <div className="glass-panel p-8 md:p-10">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 md:gap-4">
              {[
                { label: 'Edge Agent', sub: 'Pi · Jetson · Laptop', icon: Cpu },
                { label: 'Cloud Hub', sub: 'Gemini · Qdrant · MongoDB', icon: Brain },
                { label: 'Dashboard', sub: 'Live · Archive · ReID', icon: Camera },
              ].map((node, i) => (
                <React.Fragment key={node.label}>
                  <div className="flex flex-col items-center text-center flex-1">
                    <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
                      <node.icon size={26} className="text-primary" />
                    </div>
                    <div className="font-semibold text-[1rem]">{node.label}</div>
                    <div className="text-[0.8rem] text-text-muted mt-1">{node.sub}</div>
                  </div>
                  {i < 2 && (
                    <div className="hidden md:flex items-center text-text-muted/40 flex-shrink-0">
                      <div className="w-12 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                      <ArrowRight size={16} className="mx-1" />
                      <div className="w-12 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-20">
        <div className="max-w-3xl mx-auto glass-panel active p-10 md:p-14 text-center">
          <h2 className="text-[1.75rem] md:text-[2.25rem] font-bold mb-4">
            Your cameras already see everything.
            <br />
            <span className="text-gradient-purple">Now make them talk.</span>
          </h2>
          <p className="text-text-secondary text-[1.05rem] mb-8 max-w-lg mx-auto">
            Sign in to monitor live feeds, browse AI-summarized events, and ask questions across your entire
            camera network.
          </p>
          <button type="button" onClick={onSignIn} className="btn btn-primary text-[1rem] px-8 py-3">
            Access Dashboard
            <ArrowRight size={18} />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-[0.8rem] text-text-muted">
          <div className="flex items-center gap-2">
            <Cpu size={16} className="text-primary" />
            <span>Aura Watch AI — Edge Surveillance Vector Search &amp; RAG Dashboard</span>
          </div>
          <button type="button" onClick={onSignIn} className="hover:text-text-secondary transition-colors">
            Sign in →
          </button>
        </div>
      </footer>
    </div>
  );
}
