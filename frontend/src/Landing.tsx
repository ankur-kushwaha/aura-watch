import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import { injectStructuredData, landingStructuredData } from './seo.ts';
import {
  Activity,
  ArrowRight,
  BellRing,
  Camera,
  Fingerprint,
  MessageSquare,
  Search,
} from 'lucide-react';



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

const TRACKING_TIMELINE_EXAMPLES = [
  {
    time: '10:42 AM',
    camera: 'Front Gate Camera',
    event: 'Person entering gate entrance',
    confidence: '98% match',
    status: 'entry',
  },
  {
    time: '10:44 AM',
    camera: 'Main Lobby Cam',
    event: 'Person tracked crossing lobby',
    confidence: '95% match',
    status: 'transit',
  },
  {
    time: '10:48 AM',
    camera: 'Restricted Back Office',
    event: 'Suspicious loitering alert',
    confidence: '97% match',
    status: 'alert',
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
    title: 'Track & monitor',
    description: 'Watch live feeds, trace movements across cameras, and get alerted on suspicious activity.',
  },
  {
    step: '04',
    title: 'Ask what happened',
    description: 'Missed something? Ask Camera AI in plain English and get cited footage back.',
  },
];

const FAQ_ITEMS = [
  {
    q: 'How does Aura-Watch connect to my existing cameras?',
    a: 'Aura-Watch connects to your cameras via standard streaming protocols such as RTSP, RTMP, WebRTC, or HTTP. You can easily connect IP cameras, NVRs, webcams, Raspberry Pi feeds, or NVIDIA Jetson streams in minutes using our lightweight edge agent.',
  },
  {
    q: 'Does my video footage upload to the cloud 24/7?',
    a: 'No. To save bandwidth and maintain privacy, our smart edge agent processes video locally. It only uploads short recorded clips to the dashboard when meaningful events (like people, vehicles, or motion) are detected.',
  },
  {
    q: 'How does multi-camera person tracking (Re-ID) work?',
    a: 'Our AI agent extracts visual feature vectors (embeddings) of detected individuals. When a person leaves one camera feed and enters another, our system matches these feature vectors to track their path chronologically across disjoint cameras, generating a unified movement timeline.',
  },
  {
    q: 'What is Ask Camera AI and how does it query my footage?',
    a: 'Ask Camera AI is a natural language search system. Every motion clip is transcribed into an AI-written summary. When you ask a question (e.g. "Did anyone carry a box?"), the system uses vector semantic search to query these summaries and returns the exact video clips as proof.',
  },
  {
    q: 'Can I set up custom alert rules for suspicious activity?',
    a: 'Yes. You can configure proactive alerts based on time, camera group, or event sequences (e.g. "Alert me if motion is detected on Camera 1 and then Camera 2 within 2 minutes after 10 PM"). Alerts are triggered instantly via the dashboard or webhooks.',
  },
  {
    q: 'Is my data secure and private?',
    a: 'Yes, privacy is a core value. All local processing runs on your edge hardware, and transmission of clips to the secure dashboard is fully encrypted. You retain complete control over your footage, logs, and user access levels.',
  },
];


function SectionHeader({ label, title, description }: { label: string; title: string; description: string }) {
  return (
    <div className="text-center mb-12 md:mb-14">
      <span className="text-[0.7rem] uppercase tracking-widest text-secondary font-bold">{label}</span>
      <h2 className="text-[2rem] md:text-[2.5rem] font-bold mt-3 mb-4">{title}</h2>
      <p className="text-text-secondary max-w-2xl mx-auto text-[1.05rem] leading-relaxed">{description}</p>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <div className="glass-panel border-white/6 bg-white/[0.015] hover:bg-white/[0.03] transition-all rounded-2xl overflow-hidden mb-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full text-left px-6 py-5 flex items-center justify-between gap-4 font-semibold text-[1.05rem] text-white hover:text-secondary transition-colors focus:outline-none"
        aria-expanded={isOpen}
      >
        <span>{q}</span>
        <span className={`text-secondary transform transition-transform duration-300 shrink-0 text-xl font-light ${isOpen ? 'rotate-45' : ''}`}>
          ＋
        </span>
      </button>
      <div
        className={`transition-all duration-300 ease-in-out overflow-hidden ${isOpen ? 'max-h-[500px] opacity-100 border-t border-white/5' : 'max-h-0 opacity-0'
          }`}
      >
        <p className="px-6 py-5 text-text-secondary text-[0.95rem] leading-relaxed bg-black/10">
          {a}
        </p>
      </div>
    </div>
  );
}

export default function Landing() {
  useEffect(() => injectStructuredData(landingStructuredData()), []);


  return (
    <div className="relative">
      {/* Nav */}
      <Header />

      <main className="relative">
        {/* Hero Background Image - Full height of browser/viewport, half width on desktop */}
        <div className="hidden lg:block absolute right-0 top-0 h-screen w-1/2 z-0 pointer-events-none select-none overflow-hidden hero-blur-mask">
          {/* Ambient Background Glow Spheres */}
          <div className="absolute top-1/2 left-2/3 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[80%] bg-[radial-gradient(circle,rgba(6,182,212,0.22),transparent_70%)] blur-3xl pointer-events-none z-10" />
          <div className="absolute top-1/2 left-1/3 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[80%] bg-[radial-gradient(circle,rgba(124,58,237,0.18),transparent_70%)] blur-3xl pointer-events-none z-10" />

          {/* Left-to-right fade gradient for desktop, top-to-bottom for mobile */}
          <div className="absolute inset-0 bg-gradient-to-b from-bg-dark/10 via-transparent to-bg-dark/30 lg:bg-gradient-to-r lg:from-bg-dark lg:via-bg-dark/10 lg:to-transparent z-20" />

          <img
            src="/screenshots/hero-right-graphic.png"
            alt=""
            className="w-full h-full object-cover object-center lg:object-right opacity-95 mix-blend-screen scale-100"
          />
        </div>

        {/* Hero Content Section */}
        <section className="relative pt-28 pb-16 px-6 max-w-6xl mx-auto min-h-screen flex items-center z-10" aria-labelledby="hero-heading">
          <div className="relative z-10 w-full grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            {/* Left Column: Hero Content */}
            <div className="lg:col-span-7 flex flex-col items-start text-left relative z-10">
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full border border-secondary/25 bg-secondary/5 text-[0.725rem] font-bold text-secondary mb-6 tracking-wider uppercase landing-fade-in">
                <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
                AI Powered. Always Watching.
              </div>

              <h1
                id="hero-heading"
                className="text-[3rem] md:text-[4.5rem] font-extrabold leading-[1.05] tracking-tight mb-6 landing-fade-in landing-delay-1"
              >
                <span className="text-white">AI Surveillance Agent </span>
                <br />
                <span className="text-gradient">that Watches. Detects. </span>
                <br />
                <span className="text-gradient-purple">Alerts. Answers.</span>
              </h1>

              <p className="text-text-secondary text-[1.05rem] md:text-[1.15rem] leading-relaxed max-w-xl mb-10 landing-fade-in landing-delay-2">
                Aura-Watch uses powerful AI agents to monitor your cameras, detect suspicious activity, and provide real-time answers—so your team can act faster and smarter.
              </p>

              <div className="flex flex-row items-center gap-4 landing-fade-in landing-delay-3">
                <Link to="/contact" className="btn btn-primary text-[1rem] px-8 py-3.5 font-semibold">
                  Request a Demo
                </Link>
                <a href="#capabilities" className="btn btn-secondary text-[1rem] px-8 py-3.5 font-semibold">
                  Explore Features
                </a>
              </div>
            </div>

            {/* Right Column: Feature card on desktop, stacked below content on mobile */}
            <div className="lg:col-span-5 relative z-10 w-full flex items-center justify-center landing-fade-in landing-delay-4">
              {/* Feature grid card — shown on both desktop (right col) and mobile (stacked) */}
              <div className="w-full max-w-[500px] lg:max-w-none mx-auto rounded-2xl border border-white/8 bg-white/[0.03] backdrop-blur-sm p-7 shadow-[0_0_50px_rgba(124,58,237,0.12)] relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-secondary/5 pointer-events-none" />
                <div className="absolute top-0 right-0 w-40 h-40 bg-secondary/8 rounded-full blur-2xl pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-primary/8 rounded-full blur-2xl pointer-events-none" />
                <div className="grid grid-cols-2 gap-4 relative z-10">
                  {[
                    { title: '24/7 AI Monitoring', desc: 'Across all your cameras', icon: Camera },
                    { title: 'Detect & Track', desc: 'Suspicious activity in real-time', icon: Fingerprint },
                    { title: 'Instant Alerts', desc: 'Stay informed, act faster', icon: BellRing },
                    { title: 'Ask. Get Answers.', desc: 'AI agent answers in seconds', icon: MessageSquare },
                  ].map((feat, idx) => (
                    <div key={idx} className="flex flex-col gap-3 p-5 rounded-xl border border-white/6 bg-white/[0.025] hover:bg-white/[0.05] hover:border-primary/25 transition-all group">
                      <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0 shadow-[0_0_16px_rgba(124,58,237,0.15)] group-hover:shadow-[0_0_20px_rgba(124,58,237,0.25)] transition-all">
                        <feat.icon size={20} />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[0.9rem] font-bold text-white leading-tight">{feat.title}</span>
                        <span className="text-[0.775rem] text-text-muted mt-1 leading-normal">{feat.desc}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
        {/* Deep dives */}
        <section className="px-6 py-20">
          <div className="max-w-6xl mx-auto flex flex-col gap-8">
            {/* Multi-camera tracking deep dive */}
            <div id="tracking" className="glass-panel active p-8 md:p-12 scroll-mt-24">
              <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[0.75rem] font-semibold uppercase tracking-wider mb-6">
                    <Fingerprint size={13} />
                    Multi-Camera Person Tracking
                  </div>
                  <h2 className="text-[2rem] md:text-[2.5rem] font-bold leading-tight mb-5">
                    Trace whereabouts.
                    <br />
                    <span className="text-gradient-purple">Know suspicious paths.</span>
                  </h2>
                  <p className="text-text-secondary text-[1.05rem] leading-relaxed mb-6">
                    Instantly track a person&apos;s movement across disjoint camera feeds. Using advanced person
                    re-identification (Re-ID), Aura Watch matches visual features to compile a unified, chronological
                    timeline of where individuals go—helping you spot suspicious behavior and unauthorized area access.
                  </p>
                  <Link to="/login" className="btn btn-primary text-[0.95rem] px-6 py-2.5">
                    Explore Re-ID Dashboard
                    <ArrowRight size={16} />
                  </Link>
                </div>

                {/* Simulated timeline mockup */}
                <div className="glass-panel p-6 border-white/6 bg-white/[0.02] flex flex-col gap-4">
                  <div className="flex items-center justify-between border-b border-white/6 pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-danger animate-pulse" />
                      <span className="text-[0.8rem] font-bold tracking-wider text-text-primary uppercase">Identity Trace: #104</span>
                    </div>
                    <span className="text-[0.7rem] bg-primary/20 text-primary border border-primary/30 px-2 py-0.5 rounded-full font-medium">Active Match Profile</span>
                  </div>

                  <div className="relative flex flex-col gap-6 pl-4 border-l border-dashed border-white/12">
                    {TRACKING_TIMELINE_EXAMPLES.map((step, idx) => (
                      <div key={idx} className="relative group/step">
                        {/* Timeline Dot */}
                        <div className={`absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-bg-dark transition-all ${step.status === 'entry' ? 'bg-success' : step.status === 'transit' ? 'bg-secondary' : 'bg-danger shadow-[0_0_8px_var(--color-danger)]'
                          }`} />

                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[0.85rem] font-semibold text-text-primary">{step.camera}</span>
                            <span className="text-[0.75rem] text-text-muted">{step.time}</span>
                          </div>
                          <p className="text-[0.8rem] text-text-secondary">{step.event}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[0.7rem] font-medium text-secondary">{step.confidence}</span>
                            {step.status === 'alert' && (
                              <span className="text-[0.65rem] bg-danger/10 text-danger border border-danger/25 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">
                                Suspicious Activity
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

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
                  <Link to="/login" className="btn btn-primary text-[0.95rem] px-6 py-2.5">
                    Try Ask Camera AI
                    <ArrowRight size={16} />
                  </Link>
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

        {/* Showcase Infographic Section */}
        <section className="px-6 py-20 bg-white/[0.01]">
          <div className="max-w-6xl mx-auto text-center">
            <SectionHeader
              label="System Overview"
              title="How Aura-Watch connects your premises"
              description="A complete visual overview of the live camera streams, edge detection AI, real-time alert timeline, and the monitoring interface."
            />

            <div className="glass-panel p-4 md:p-6 rounded-3xl overflow-hidden border border-white/10 shadow-[0_0_50px_rgba(124,58,237,0.15)] bg-white/[0.01] mx-auto mt-8">
              <img
                src="/screenshots/hero-right2.png"
                alt="Aura-Watch AI Surveillance Agent Infographic"
                className="w-full h-auto rounded-2xl block border border-white/5 shadow-2xl"
              />
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
                  { label: 'Person tracking', sub: 'Trace whereabouts', icon: Fingerprint },
                  { label: 'Live monitoring', sub: 'Watch & Alert', icon: Activity },
                  { label: 'Ask Camera AI', sub: 'Search & cited clips', icon: MessageSquare },
                ].map((node, i) => (
                  <React.Fragment key={node.label}>
                    <div className="flex flex-col items-center text-center">
                      <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-2">
                        <node.icon size={22} className="text-primary" />
                      </div>
                      <div className="font-semibold text-[0.9rem]">{node.label}</div>
                      <div className="text-[0.75rem] text-text-muted mt-0.5">{node.sub}</div>
                    </div>
                    {i < 3 && (
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

        {/* FAQ Section */}
        <section id="faq" className="px-6 py-20 scroll-mt-20">
          <div className="max-w-4xl mx-auto">
            <SectionHeader
              label="FAQ"
              title="Frequently Asked Questions"
              description="Got questions about Aura-Watch? We have answers to the most common queries about our surveillance agents."
            />
            <div className="mt-12 max-w-3xl mx-auto">
              {FAQ_ITEMS.map((item, idx) => (
                <FaqItem key={idx} q={item.q} a={item.a} />
              ))}
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
            <Link to="/login" className="btn btn-primary text-[1rem] px-8 py-3">
              Access Dashboard
              <ArrowRight size={18} />
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
