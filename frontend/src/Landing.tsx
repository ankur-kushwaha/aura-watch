import React from 'react';
import {
  Activity,
  ArrowRight,
  BellRing,
  Brain,
  Camera,
  Cpu,
  Eye,
  Fingerprint,
  LayoutGrid,
  Mail,
  MessageSquare,
  Network,
  Phone,
  Search,
  Shield,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react';

const SCREENSHOTS = [
  {
    src: '/screenshots/dashboard-archive.png',
    alt: 'Aura Watch AI dashboard with live feed, event archive, video playback, and Ask Camera AI',
    label: 'Monitor & investigate',
    title: 'Live feeds and AI search in one place',
    description:
      'Watch cameras in real time, browse motion clips with AI summaries, and ask questions about your footage—all without leaving the dashboard.',
  },
  
];

const CONTACT = {
  name: 'Ankur Kushwaha',
  email: 'ankur.kus1@gmail.com',
  phone: '8587083895',
};

interface LandingProps {
  onSignIn: () => void;
}

const CORE_VALUES = [
  {
    id: 'monitoring',
    icon: LayoutGrid,
    tag: 'Active monitoring using AI',
    title: 'Watch every camera, live',
    description:
      'All your feeds—webcams, RTSP, Pi, Jetson—in one dashboard. Real-time streams, device status, and motion-triggered recordings. Built on a live event pipeline ready for proactive alerts when something matters.',
    highlights: [
      'Multi-camera live view with status overlays',
      'Motion-triggered clips—not 24/7 waste',
      'Proactive alert rules on a real-time pipeline',
    ],
    accent: 'primary' as const,
  },
  {
    id: 'ask-ai',
    icon: MessageSquare,
    tag: 'Ask Camera AI',
    title: 'Ask your cameras what happened',
    description:
      'Every clip gets an AI summary and is searchable by meaning. Skip the scrubbing—type a question in plain English and get cited footage back with proof.',
    highlights: [
      'Natural language search across all events',
      'AI-written summaries for every clip',
      'Cited video answers—not guesses',
    ],
    accent: 'secondary' as const,
  },
];

const ASK_AI_EXAMPLES = [
  'Did anyone walk by carrying a box between 2 PM and 4 PM?',
  'Has anyone walked past in a red shirt?',
  'How many people were seen today?',
  'Was anyone detected after 9 PM?',
  'What activity was recorded on the front camera this morning?',
];

const ALERT_EXAMPLES = [
  'Motion on any camera after 10 PM',
  'Someone enters the parking lot',
  'Person seen on front and back camera within 2 minutes',
  'Vehicle detected at the loading dock',
];

const CAPABILITIES = [
  {
    icon: Zap,
    title: 'Smart on-device detection',
    description: 'AI runs on your hardware. Clips upload only when people, vehicles, or motion are detected.',
  },
  {
    icon: Activity,
    title: 'Live multi-camera view',
    description: 'Stream every angle in real time—Monitoring, Recording, Processing, Offline at a glance.',
  },
  {
    icon: MessageSquare,
    title: 'Ask Camera AI',
    description: 'Query your entire archive in plain English. Get cited clips back instantly.',
  },
  {
    icon: Brain,
    title: 'AI video summaries',
    description: 'Every event gets a readable summary so you know what happened before hitting play.',
  },
  {
    icon: Fingerprint,
    title: 'Cross-camera tracking',
    description: 'Link the same person across cameras, merge duplicates, and define room connections.',
  },
  {
    icon: Network,
    title: 'Remote fleet management',
    description: 'Add streams, tweak thresholds, reboot devices, and read logs from one hub.',
  },
];

const USE_CASES = [
  {
    icon: Eye,
    title: 'Active multi-feed monitoring',
    featured: true,
    mode: 'monitor' as const,
    description:
      'For anyone who constantly watches several camera feeds—warehouse managers, front desk, homeowners with many angles. One command center instead of tab-hopping, with a real-time pipeline ready for proactive alerts.',
    examples: [
      'Watch all cameras from a single dashboard',
      'Alert me when motion is detected after hours',
      'Notify me if someone enters a restricted zone',
    ],
  },
  {
    icon: MessageSquare,
    title: 'Ask Camera AI investigations',
    featured: true,
    mode: 'ask' as const,
    description:
      'For when you weren\'t watching—or need to find something fast. Ask questions about past events in plain English and get cited clips. No scrubbing through hours of footage.',
    examples: [
      'Was anyone at the front door after midnight?',
      'Did anyone carry a box between 2–4 PM?',
      'Show me all deliveries to the loading dock this week',
    ],
  },
  {
    icon: Shield,
    title: 'Home & office security',
    featured: false,
    description: 'Monitor live when you\'re watching, ask AI when you need to catch up.',
    examples: ['How many visitors today?', 'What happened while I was away?'],
  },
  {
    icon: Users,
    title: 'Multi-camera investigations',
    featured: false,
    description: 'Trace a person from lobby to warehouse across your entire camera network.',
    examples: ['Where did they go after the east hallway?', 'Link these two sightings'],
  },
  {
    icon: Camera,
    title: 'Distributed camera fleets',
    featured: false,
    description: 'Deploy agents on Pi or Jetson anywhere. Manage streams and updates remotely.',
    examples: ['Add an RTSP stream', 'Restart an edge device from the dashboard'],
  },
];

const STEPS = [
  {
    step: '01',
    title: 'Connect your cameras',
    description: 'Install the edge agent. Add webcams or RTSP streams in minutes.',
  },
  {
    step: '02',
    title: 'Detect & record',
    description: 'On-device AI spots people and vehicles. Meaningful clips upload automatically.',
  },
  {
    step: '03',
    title: 'Monitor actively',
    description: 'Watch every feed live. Get alerted in real time when rules you care about fire.',
  },
  {
    step: '04',
    title: 'Ask what happened',
    description: 'Missed something? Ask Camera AI in plain English and get cited footage back.',
  },
];

function AccentIcon({
  icon: Icon,
  accent,
  size = 'md',
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accent: 'primary' | 'secondary';
  size?: 'md' | 'lg';
}) {
  const styles =
    accent === 'primary'
      ? 'bg-primary/15 text-primary shadow-[0_0_20px_rgba(124,58,237,0.15)]'
      : 'bg-secondary/15 text-secondary shadow-[0_0_20px_rgba(6,182,212,0.12)]';

  const dim = size === 'lg' ? 'w-14 h-14' : 'w-11 h-11';
  const iconSize = size === 'lg' ? 26 : 22;

  return (
    <div className={`${dim} rounded-xl flex items-center justify-center shrink-0 ${styles}`}>
      <Icon size={iconSize} />
    </div>
  );
}

function SectionHeader({ label, title, description }: { label: string; title: string; description: string }) {
  return (
    <div className="text-center mb-12 md:mb-14">
      <span className="text-[0.7rem] uppercase tracking-widest text-secondary font-bold">{label}</span>
      <h2 className="text-[2rem] md:text-[2.5rem] font-bold mt-3 mb-4">{title}</h2>
      <p className="text-text-secondary max-w-2xl mx-auto text-[1.05rem] leading-relaxed">{description}</p>
    </div>
  );
}

export default function Landing({ onSignIn }: LandingProps) {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  const featuredUseCases = USE_CASES.filter((u) => u.featured);
  const otherUseCases = USE_CASES.filter((u) => !u.featured);

  return (
    <div className="relative">
      {/* Nav */}
      <header className="fixed top-0 inset-x-0 z-50 border-b border-white/6 bg-[rgba(10,14,26,0.72)] backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary p-2 rounded-lg shadow-[0_0_15px_rgba(124,58,237,0.25)]">
              <Cpu size={20} color="white" />
            </div>
            <span className="font-heading font-bold text-[1.05rem] tracking-tight">AURA WATCH AI</span>
          </div>

          <nav className="hidden md:flex items-center gap-7 text-[0.875rem] text-text-secondary">
            <button type="button" onClick={() => scrollTo('monitoring')} className="hover:text-text-primary transition-colors">
              Monitoring
            </button>
            <button type="button" onClick={() => scrollTo('ask-ai')} className="hover:text-text-primary transition-colors">
              Ask Camera AI
            </button>
            <button type="button" onClick={() => scrollTo('product')} className="hover:text-text-primary transition-colors">
              Product
            </button>
            <button type="button" onClick={() => scrollTo('use-cases')} className="hover:text-text-primary transition-colors">
              Use Cases
            </button>
            <button type="button" onClick={() => scrollTo('contact')} className="hover:text-text-primary transition-colors">
              Contact
            </button>
          </nav>

          <button type="button" onClick={onSignIn} className="btn btn-primary text-[0.875rem] py-2 px-4">
            Sign In
            <ArrowRight size={15} />
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-32 pb-16 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/4 text-[0.8rem] text-text-secondary mb-8 landing-fade-in">
            <Sparkles size={14} className="text-secondary" />
            Live monitoring · Ask Camera AI
          </div>

          <p className="text-secondary text-[1.125rem] md:text-[1.35rem] font-medium mb-4 landing-fade-in landing-delay-1">
            Watch every feed—or ask your cameras what you missed.
          </p>

          <h1 className="text-[2.75rem] md:text-[4rem] font-extrabold leading-[1.08] tracking-tight mb-6 landing-fade-in landing-delay-2">
            <span className="text-gradient">See it live.</span>
            <br />
            <span className="text-gradient-purple">Ask what happened.</span>
          </h1>

          <p className="text-text-secondary text-[1.05rem] md:text-[1.15rem] max-w-2xl mx-auto leading-relaxed mb-10 landing-fade-in landing-delay-3">
            Aura Watch AI gives you two superpowers: monitor every camera from one dashboard in real time, and
            ask questions about your footage in plain English—with cited clips as proof.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 landing-fade-in landing-delay-4">
            <button type="button" onClick={() => scrollTo('monitoring')} className="btn btn-primary text-[1rem] px-7 py-3">
              Active monitoring using AI
              <Activity size={18} />
            </button>
            <button type="button" onClick={() => scrollTo('ask-ai')} className="btn btn-secondary text-[1rem] px-7 py-3">
              Ask Camera AI
              <MessageSquare size={18} />
            </button>
          </div>
        </div>
      </section>

      {/* Two core values */}
      <section className="px-6 pb-20">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-5">
          {CORE_VALUES.map((value) => (
            <div
              key={value.id}
              className={`glass-panel interactive p-8 flex flex-col gap-5 ${value.accent === 'primary' ? 'active' : ''}`}
            >
              <div className="flex items-center gap-3">
                <AccentIcon icon={value.icon} accent={value.accent} size="lg" />
                <span className="text-[0.7rem] uppercase tracking-widest text-text-muted font-bold">{value.tag}</span>
              </div>
              <h3 className="text-[1.35rem] font-semibold">{value.title}</h3>
              <p className="text-text-secondary text-[0.9rem] leading-relaxed">{value.description}</p>
              <ul className="flex flex-col gap-2.5 mt-auto">
                {value.highlights.map((h) => (
                  <li
                    key={h}
                    className="text-[0.85rem] text-text-muted flex items-center gap-2.5 before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-secondary before:shrink-0"
                  >
                    {h}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Product screenshots */}
      <section id="product" className="px-6 py-20 scroll-mt-20 bg-white/[0.015]">
        <div className="max-w-6xl mx-auto">
          <SectionHeader
            label="Product"
            title="Monitor and investigate from one screen"
            description="Live feeds on the left, event archive and Ask Camera AI below—everything you need whether you're watching now or catching up later."
          />

          <div className="flex flex-col gap-10">
            {SCREENSHOTS.map((shot, i) => (
              <div key={shot.title} className="glass-panel p-4 md:p-5 overflow-hidden">
                <div className="mb-4 px-1">
                  <span className="text-[0.7rem] uppercase tracking-widest text-secondary font-bold">{shot.label}</span>
                  <h3 className="text-[1.2rem] font-semibold mt-1">{shot.title}</h3>
                  <p className="text-text-secondary text-[0.9rem] mt-1 max-w-2xl">{shot.description}</p>
                </div>
                <div className="rounded-xl overflow-hidden border border-white/10 shadow-[0_0_40px_rgba(124,58,237,0.12)]">
                  <img
                    src={shot.src}
                    alt={shot.alt}
                    className="w-full h-auto block"
                    loading={i === 0 ? 'eager' : 'lazy'}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Monitoring + Ask AI deep dives */}
      <section className="px-6 py-20">
        <div className="max-w-6xl mx-auto flex flex-col gap-8">
          {/* Active monitoring using AI */}
          <div id="monitoring" className="glass-panel p-8 md:p-12 scroll-mt-24">
            <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[0.75rem] font-semibold uppercase tracking-wider mb-6">
                  <Activity size={13} />
                  Active monitoring using AI
                </div>
                <h2 className="text-[2rem] md:text-[2.5rem] font-bold leading-tight mb-5">
                  Every feed.
                  <br />
                  <span className="text-gradient-purple">One command center.</span>
                </h2>
                <p className="text-text-secondary text-[1.05rem] leading-relaxed">
                  Stop jumping between apps and missing events on another angle. Watch all your cameras live,
                  see what&apos;s recording, and layer proactive alerts on top—get notified the moment something
                  matters instead of staring at screens all day.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <p className="text-[0.75rem] uppercase tracking-widest text-text-muted font-semibold mb-1">
                  Example alert rules
                </p>
                {ALERT_EXAMPLES.map((rule) => (
                  <div
                    key={rule}
                    className="flex items-center gap-3 p-4 rounded-xl border border-white/8 bg-white/3"
                  >
                    <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                      <BellRing size={15} className="text-primary" />
                    </div>
                    <span className="text-[0.9rem] text-text-secondary">{rule}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Ask Camera AI */}
          <div id="ask-ai" className="glass-panel active p-8 md:p-12 scroll-mt-24">
            <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary/10 border border-secondary/20 text-secondary text-[0.75rem] font-semibold uppercase tracking-wider mb-6">
                  <MessageSquare size={13} />
                  Ask Camera AI
                </div>
                <h2 className="text-[2rem] md:text-[2.5rem] font-bold leading-tight mb-5">
                  Skip the scrubbing.
                  <br />
                  <span className="text-gradient-purple">Just ask.</span>
                </h2>
                <p className="text-text-secondary text-[1.05rem] leading-relaxed mb-6">
                  Weren&apos;t watching? Need to find something from hours ago? Ask Camera AI searches your
                  entire event archive in plain English and returns cited clips—so you get answers with proof,
                  not guesswork.
                </p>
                <button type="button" onClick={onSignIn} className="btn btn-primary text-[0.95rem] px-6 py-2.5">
                  Try Ask Camera AI
                  <ArrowRight size={16} />
                </button>
              </div>
              <div className="flex flex-col gap-3">
                <p className="text-[0.75rem] uppercase tracking-widest text-text-muted font-semibold mb-1">
                  Questions you can ask
                </p>
                {ASK_AI_EXAMPLES.map((q) => (
                  <div
                    key={q}
                    className="flex items-start gap-3 p-4 rounded-xl border border-white/8 bg-white/3 hover:border-secondary/25 hover:bg-secondary/5 transition-all"
                  >
                    <div className="w-8 h-8 rounded-lg bg-secondary/15 flex items-center justify-center shrink-0 mt-0.5">
                      <Search size={15} className="text-secondary" />
                    </div>
                    <span className="text-[0.9rem] text-text-secondary">&ldquo;{q}&rdquo;</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section id="capabilities" className="px-6 py-20 scroll-mt-20 bg-white/[0.015]">
        <div className="max-w-6xl mx-auto">
          <SectionHeader
            label="Capabilities"
            title="The full stack behind both modes"
            description="Whether you're watching live or searching the past, every layer works together—detection, summaries, search, and tracking."
          />

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {CAPABILITIES.map((cap) => (
              <div key={cap.title} className="glass-panel p-6 flex flex-col gap-3">
                <AccentIcon icon={cap.icon} accent="primary" />
                <h3 className="text-[1.05rem] font-semibold">{cap.title}</h3>
                <p className="text-text-secondary text-[0.875rem] leading-relaxed">{cap.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section id="use-cases" className="px-6 py-20 scroll-mt-20">
        <div className="max-w-6xl mx-auto">
          <SectionHeader
            label="Use cases"
            title="Two ways to use Aura Watch"
            description="Watch actively when you're on duty—or ask AI when you need to catch up, investigate, or find something fast."
          />

          <div className="grid md:grid-cols-2 gap-5 mb-5">
            {featuredUseCases.map((useCase) => (
              <div
                key={useCase.title}
                className={`glass-panel p-8 flex flex-col gap-4 ${useCase.mode === 'monitor' ? 'active' : ''}`}
              >
                <div className="flex items-center gap-4">
                  <AccentIcon icon={useCase.icon} accent={useCase.mode === 'monitor' ? 'primary' : 'secondary'} size="lg" />
                  <span className="text-[0.7rem] uppercase tracking-widest text-text-muted font-bold">
                    {useCase.mode === 'monitor' ? 'Watch live' : 'Ask AI'}
                  </span>
                </div>
                <h3 className="text-[1.2rem] font-semibold">{useCase.title}</h3>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed">{useCase.description}</p>
                <div className="flex flex-col gap-2 mt-auto">
                  {useCase.examples.map((ex) => (
                    <div
                      key={ex}
                      className="text-[0.85rem] text-text-muted flex items-center gap-2 before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-secondary before:shrink-0"
                    >
                      {ex}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {otherUseCases.map((useCase) => (
              <div key={useCase.title} className="glass-panel p-6 flex flex-col gap-3">
                <AccentIcon icon={useCase.icon} accent="primary" />
                <h3 className="text-[1.05rem] font-semibold">{useCase.title}</h3>
                <p className="text-text-secondary text-[0.85rem] leading-relaxed">{useCase.description}</p>
                <div className="flex flex-col gap-1.5 mt-auto">
                  {useCase.examples.map((ex) => (
                    <div key={ex} className="text-[0.8rem] text-text-muted">
                      {ex}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="px-6 py-20 scroll-mt-20 bg-white/[0.015]">
        <div className="max-w-6xl mx-auto">
          <SectionHeader
            label="How it works"
            title="Monitor now. Ask later."
            description="Connect cameras, detect what matters, watch live with alerts—and when you need answers, just ask."
          />

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
            {STEPS.map((step) => (
              <div key={step.step} className="glass-panel p-6 relative overflow-hidden">
                <span className="text-[2.5rem] font-extrabold text-white/4 absolute top-3 right-4 select-none">
                  {step.step}
                </span>
                <div className="text-secondary text-[0.7rem] font-bold uppercase tracking-widest mb-3">
                  Step {step.step}
                </div>
                <h3 className="text-[1.05rem] font-semibold mb-2">{step.title}</h3>
                <p className="text-text-secondary text-[0.85rem] leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>

          <div className="glass-panel p-8 md:p-10">
            <div className="flex flex-col md:flex-row items-center justify-center gap-6 md:gap-8">
              {[
                { label: 'Your cameras', sub: 'Detect & record', icon: Camera },
                { label: 'Live monitoring', sub: 'Watch · Alert', icon: Activity },
                { label: 'Ask Camera AI', sub: 'Search · Cited clips', icon: MessageSquare },
              ].map((node, i) => (
                <React.Fragment key={node.label}>
                  <div className="flex flex-col items-center text-center">
                    <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-2">
                      <node.icon size={22} className="text-primary" />
                    </div>
                    <div className="font-semibold text-[0.9rem]">{node.label}</div>
                    <div className="text-[0.75rem] text-text-muted mt-0.5">{node.sub}</div>
                  </div>
                  {i < 2 && (
                    <div className="hidden md:flex items-center text-text-muted/30">
                      <ArrowRight size={14} />
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
            Watch live when you&apos;re on duty.
            <br />
            <span className="text-gradient-purple">Ask AI when you need answers.</span>
          </h2>
          <p className="text-text-secondary text-[1.05rem] mb-8 max-w-lg mx-auto">
            Sign in to monitor every feed, get proactive alerts, and query your footage in plain English—all
            from one dashboard.
          </p>
          <button type="button" onClick={onSignIn} className="btn btn-primary text-[1rem] px-8 py-3">
            Access Dashboard
            <ArrowRight size={18} />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer id="contact" className="px-6 pt-16 pb-8 border-t border-white/6 scroll-mt-20">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-8 mb-12">
            <div className="sm:col-span-2 lg:col-span-1">
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-primary p-2 rounded-lg shadow-[0_0_15px_rgba(124,58,237,0.25)]">
                  <Cpu size={18} color="white" />
                </div>
                <span className="font-heading font-bold text-[1rem]">AURA WATCH AI</span>
              </div>
              <p className="text-[0.85rem] text-text-muted leading-relaxed max-w-xs">
                Multi-camera live monitoring and Ask Camera AI—watch every feed, ask what happened.
              </p>
            </div>

            <div>
              <h4 className="text-[0.75rem] uppercase tracking-widest text-text-secondary font-semibold mb-4">
                Explore
              </h4>
              <ul className="flex flex-col gap-2.5 text-[0.875rem] text-text-muted">
                <li>
                  <button type="button" onClick={() => scrollTo('monitoring')} className="hover:text-text-primary transition-colors">
                    Active monitoring using AI
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => scrollTo('ask-ai')} className="hover:text-text-primary transition-colors">
                    Ask Camera AI
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => scrollTo('product')} className="hover:text-text-primary transition-colors">
                    Product
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => scrollTo('use-cases')} className="hover:text-text-primary transition-colors">
                    Use Cases
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => scrollTo('how-it-works')} className="hover:text-text-primary transition-colors">
                    How It Works
                  </button>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-[0.75rem] uppercase tracking-widest text-text-secondary font-semibold mb-4">
                Contact
              </h4>
              <div className="flex flex-col gap-3 text-[0.875rem]">
                <span className="text-text-primary font-medium">{CONTACT.name}</span>
                <a
                  href={`mailto:${CONTACT.email}`}
                  className="flex items-center gap-2 text-text-muted hover:text-secondary transition-colors"
                >
                  <Mail size={14} className="shrink-0" />
                  {CONTACT.email}
                </a>
                <a
                  href={`tel:+91${CONTACT.phone}`}
                  className="flex items-center gap-2 text-text-muted hover:text-secondary transition-colors"
                >
                  <Phone size={14} className="shrink-0" />
                  +91 {CONTACT.phone}
                </a>
              </div>
            </div>

            <div>
              <h4 className="text-[0.75rem] uppercase tracking-widest text-text-secondary font-semibold mb-4">
                Dashboard
              </h4>
              <p className="text-[0.85rem] text-text-muted leading-relaxed mb-4">
                Monitor live feeds and ask your cameras questions—all from one place.
              </p>
              <button type="button" onClick={onSignIn} className="btn btn-primary text-[0.85rem] py-2 px-4">
                Sign In
                <ArrowRight size={14} />
              </button>
            </div>
          </div>

          <div className="pt-8 border-t border-white/6 flex flex-col sm:flex-row items-center justify-between gap-3 text-[0.8rem] text-text-muted">
            <span>&copy; {new Date().getFullYear()} Aura Watch AI. All rights reserved.</span>
            <span>Built by {CONTACT.name}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
