import { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useNavigate, Navigate, useLocation } from 'react-router-dom';
import {
  Terminal,
  Copy,
  Check,
  RefreshCw,
  Play,
  BookOpen,
  ChevronRight,
  ChevronLeft,
  Menu,
  X,
  ArrowRight,
  LogIn,
} from 'lucide-react';
import Header from './components/Header';
import Footer from './components/Footer';
import { getStoredOrg, isLoggedIn } from './api';
import { buildInstallCmd } from './utils/install';

type Subheading = { id: string; label: string };

type Topic = {
  id: string;
  title: string;
  description: string;
  subheadings: Subheading[];
};

type Section = {
  title: string;
  topics: Topic[];
};

const DOCUMENTATION: Section[] = [
  {
    title: 'GETTING STARTED',
    topics: [
      {
        id: 'quick-start',
        title: 'Quick Start',
        description: 'A simple overview of how Aura Watch works and what you need to get going.',
        subheadings: [
          { id: 'overview', label: 'What you\'ll do' },
          { id: 'architecture', label: 'How it works' },
          { id: 'checklist', label: 'What you need' },
        ],
      },
    ],
  },
  {
    title: 'SET UP YOUR DEVICE',
    topics: [
      {
        id: 'streaming-device',
        title: 'Connect Your Device',
        description: 'Hook up a small computer on your premises so your cameras can talk to Aura Watch.',
        subheadings: [
          { id: 'device-prep', label: 'Before you start' },
          { id: 'enrollment-token', label: 'Your setup code' },
          { id: 'installer-command', label: 'Copy and run this' },
          { id: 'verify-connection', label: 'Check it worked' },
          { id: 'diagnostics-tool', label: 'Try a test run' },
        ],
      },
    ],
  },
  {
    title: 'ADD YOUR CAMERAS',
    topics: [
      {
        id: 'adding-camera',
        title: 'Add Your Cameras',
        description: 'Bring your security cameras into Aura Watch — automatically or one at a time.',
        subheadings: [
          { id: 'rtsp-format', label: 'Find your camera link' },
          { id: 'rtsp-by-brand', label: 'Links by camera brand' },
          { id: 'verify-rtsp-vlc', label: 'Test with VLC' },
          { id: 'auto-discovery', label: 'Let us find them' },
          { id: 'manual-add', label: 'Add one yourself' },
          { id: 'troubleshoot-streams', label: 'Something wrong?' },
        ],
      },
    ],
  },
  {
    title: 'USE THE DASHBOARD',
    topics: [
      {
        id: 'live-monitoring',
        title: 'Watch Cameras Live',
        description: 'See your camera feeds in real time and switch between zones and cameras.',
        subheadings: [
          { id: 'live-overview', label: 'What this screen does' },
          { id: 'live-wall', label: 'Live wall' },
          { id: 'camera-panel', label: 'Camera settings panel' },
        ],
      },
      {
        id: 'event-archive',
        title: 'Review Past Events',
        description: 'Open saved clips, read AI summaries, and inspect detected objects.',
        subheadings: [
          { id: 'archive-overview', label: 'What you can review' },
          { id: 'clip-list', label: 'Clip list' },
          { id: 'clip-details', label: 'Clip details' },
        ],
      },
      {
        id: 'ask-camera-ai',
        title: 'Ask Camera AI',
        description: 'Search your footage using plain English questions.',
        subheadings: [
          { id: 'ask-overview', label: 'What it does' },
          { id: 'search-box', label: 'Search box' },
          { id: 'question-ideas', label: 'Question ideas' },
        ],
      },
    ],
  },
  {
    title: 'ALERTS & SETTINGS',
    topics: [
      {
        id: 'manage-alert-rules',
        title: 'Create Alert Rules',
        description: 'Set up automatic alerts when important things happen on selected cameras.',
        subheadings: [
          { id: 'rules-overview', label: 'How alerts work' },
          { id: 'rule-fields', label: 'Fill in the rule' },
          { id: 'rule-channels', label: 'Where alerts are sent' },
        ],
      },
      {
        id: 'notification-center',
        title: 'Check Notifications',
        description: 'See all alerts and system messages in one place and filter them quickly.',
        subheadings: [
          { id: 'feed-overview', label: 'Notification feed' },
          { id: 'feed-filters', label: 'Use filters' },
          { id: 'empty-feed', label: 'If nothing appears' },
        ],
      },
      {
        id: 'organization-settings',
        title: 'Organization Settings',
        description: 'Turn major product features on or off for your team.',
        subheadings: [
          { id: 'settings-overview', label: 'What this page controls' },
          { id: 'video-ai-settings', label: 'Video and AI options' },
          { id: 'notification-settings', label: 'Notification options' },
        ],
      },
    ],
  },
];

const ALL_TOPICS = DOCUMENTATION.flatMap((s) => s.topics);

const TUTORIAL_IMAGES = {
  addDevice: '/tutorials/add-edge-device.png',
  dashboard: '/tutorials/streaming-devices-dashboard.png',
  addCamera: '/tutorials/add-ip-camera.png',
  liveMonitoring: '/tutorials/live-monitoring.png',
  eventArchive: '/tutorials/event-archive.png',
  askCameraAi: '/tutorials/ask-camera-ai.png',
  manageNotifications: '/tutorials/manage-notifications.png',
  notificationCenter: '/tutorials/notification-center.png',
  orgSettings: '/tutorials/org-settings.png',
} as const;

function topicIndex(id: string) {
  return ALL_TOPICS.findIndex((t) => t.id === id);
}

function CopyButton({ onCopy, copied }: { onCopy: () => void; copied: boolean }) {
  return (
    <button
      type="button"
      onClick={onCopy}
      className="p-2 bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.06)] border border-border-glass hover:border-cyan-500/30 rounded-xl transition-all cursor-pointer text-text-secondary hover:text-white shrink-0"
      aria-label="Copy to clipboard"
    >
      {copied ? <Check size={14} className="text-cyan-400" /> : <Copy size={14} />}
    </button>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[rgba(6,182,212,0.2)] bg-[rgba(6,182,212,0.05)] px-4 py-3 text-[0.82rem] text-text-secondary leading-relaxed">
      {children}
    </div>
  );
}

function Screenshot({ src, alt, caption }: { src: string; alt: string; caption?: string }) {
  return (
    <figure className="my-5 flex flex-col gap-2.5">
      <div className="rounded-xl border border-white/10 overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.35)] bg-[#0a0e1a] ring-1 ring-white/5">
        <img src={src} alt={alt} className="w-full h-auto block" loading="lazy" />
      </div>
      {caption && (
        <figcaption className="text-[0.76rem] text-text-muted leading-relaxed px-1">{caption}</figcaption>
      )}
    </figure>
  );
}

export default function Tutorials() {
  const { topicId } = useParams<{ topicId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const activeTopic = ALL_TOPICS.find((t) => t.id === topicId) ?? null;
  const [activeSubheadingId, setActiveSubheadingId] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [copiedRtsp, setCopiedRtsp] = useState(false);
  const [testerStatus, setTesterStatus] = useState<'idle' | 'testing' | 'success'>('idle');
  const [testerLogs, setTesterLogs] = useState<string[]>([]);

  const loggedIn = isLoggedIn();
  const orgId = getStoredOrg()?.id;
  const sampleRtsp = 'rtsp://admin:your_password@192.168.1.100:554/h264Preview_01_main';
  const installCmd = buildInstallCmd(orgId ?? 'YOUR_ORG_ID', 'tskey-auth-your-key-here');

  const prevTopic = topicIndex(topicId ?? '') > 0 ? ALL_TOPICS[topicIndex(topicId ?? '') - 1] : null;
  const nextTopic =
    topicIndex(topicId ?? '') >= 0 && topicIndex(topicId ?? '') < ALL_TOPICS.length - 1
      ? ALL_TOPICS[topicIndex(topicId ?? '') + 1]
      : null;

  useEffect(() => {
    document.title = activeTopic
      ? `${activeTopic.title} — Tutorials — Aura Watch AI`
      : 'Tutorials — Aura Watch AI';

    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.setAttribute('name', 'description');
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute(
      'content',
      'Easy step-by-step guides to set up Aura Watch — connect your device, add cameras, and start monitoring with AI.'
    );

    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', `https://aura-watch.adboardtools.com/tutorials/${topicId ?? 'quick-start'}`);
  }, [activeTopic, topicId]);

  useEffect(() => {
    if (!activeTopic) return;
    const hash = location.hash.replace('#', '');
    if (hash && activeTopic.subheadings.some((s) => s.id === hash)) {
      requestAnimationFrame(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' });
      });
    } else {
      window.scrollTo({ top: 0 });
    }
  }, [activeTopic, location.hash]);

  useEffect(() => {
    if (!activeTopic) return;
    const ids = activeTopic.subheadings.map((s) => s.id);
    const elements = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) {
          setActiveSubheadingId(visible[0].target.id);
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [activeTopic]);

  const handleCopy = useCallback((text: string, setter: (v: boolean) => void) => {
    navigator.clipboard.writeText(text).then(() => {
      setter(true);
      setTimeout(() => setter(false), 2000);
    });
  }, []);

  const runTesterSimulation = () => {
    setTesterStatus('testing');
    setTesterLogs([]);
    const logs = [
      'Connecting to Aura Watch...',
      'Checking your network...',
      'Checking your setup code...',
      'Confirming the device is allowed to join...',
      'Waiting for your device to check in...',
    ];

    logs.forEach((log, idx) => {
      setTimeout(() => {
        setTesterLogs((prev) => [...prev, log]);
        if (idx === logs.length - 1) {
          setTimeout(() => {
            setTesterLogs((prev) => [...prev, 'All good — your device is connected!']);
            setTesterStatus('success');
          }, 800);
        }
      }, (idx + 1) * 600);
    });
  };

  const goToTopic = (id: string, hash?: string) => {
    setSidebarOpen(false);
    navigate(`/tutorials/${id}${hash ? `#${hash}` : ''}`);
  };

  const scrollToSection = (id: string) => {
    setActiveSubheadingId(id);
    navigate(`/tutorials/${topicId}#${id}`, { replace: true });
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  if (!topicId) {
    return <Navigate to="/tutorials/quick-start" replace />;
  }

  if (!activeTopic) {
    return <Navigate to="/tutorials/quick-start" replace />;
  }

  return (
    <div className="relative min-h-screen bg-[#070b13] text-text-primary">
      <Header />

      {/* Mobile sidebar toggle */}
      <div className="lg:hidden fixed top-[4.25rem] left-0 right-0 z-40 border-b border-white/6 bg-[rgba(10,14,26,0.92)] backdrop-blur-xl px-4 py-2.5 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="flex items-center gap-2 text-[0.82rem] font-semibold text-text-secondary hover:text-white"
        >
          <Menu size={16} />
          {activeTopic.title}
        </button>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] h-full bg-[#0a0e1a] border-r border-white/8 overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-6">
              <span className="text-[0.72rem] font-bold tracking-wider text-text-muted uppercase">Tutorials</span>
              <button type="button" onClick={() => setSidebarOpen(false)} className="text-text-muted hover:text-white">
                <X size={18} />
              </button>
            </div>
            <SidebarNav activeTopicId={topicId} onTopicClick={goToTopic} />
          </aside>
        </div>
      )}

      <div className="max-w-[1400px] mx-auto px-6 pt-24 lg:pt-24 pb-20 flex items-start gap-8">
        {/* Left sidebar spacer */}
        <div className="hidden lg:block w-60 shrink-0" aria-hidden="true" />

        {/* Left sidebar */}
        <aside className="hidden lg:block fixed top-24 bottom-6 w-60 overflow-y-auto pr-4 border-r border-white/5 select-none text-left">
          <SidebarNav activeTopicId={topicId} onTopicClick={goToTopic} />
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 max-w-3xl text-left pt-10 lg:pt-0">
          <nav className="flex items-center gap-1.5 text-[0.72rem] text-text-muted font-medium mb-6 select-none" aria-label="Breadcrumb">
            <Link to="/tutorials/quick-start" className="hover:text-text-secondary transition-colors">
              Learn
            </Link>
            <ChevronRight size={10} />
            <span className="text-[var(--color-secondary)]">{activeTopic.title}</span>
          </nav>

          {topicId === 'quick-start' && (
            <article className="flex flex-col gap-8">
              <section id="overview" className="scroll-mt-28">
                <h1 className="text-[2.1rem] font-extrabold text-white tracking-tight mb-3 leading-tight">
                  Quick Start
                </h1>
                <p className="text-text-secondary text-[0.95rem] leading-relaxed mb-5">
                  New to Aura Watch? No problem. These guides walk you through setup in plain language — no tech
                  background needed. In short: you plug a small computer into your network, connect your cameras to
                  it, and watch everything from your dashboard.
                </p>
                <div className="rounded-xl border border-white/5 bg-gradient-to-br from-[#0c121e] to-[#04060b] p-5 flex flex-col gap-3">
                  <h2 className="text-[0.9rem] font-bold text-white flex items-center gap-2">
                    <BookOpen size={16} className="text-[var(--color-secondary)]" />
                    Here&apos;s the plan
                  </h2>
                  <ul className="text-[0.84rem] text-text-secondary flex flex-col gap-2 list-disc pl-5">
                    <li>Understand how your cameras, a local computer, and Aura Watch work together.</li>
                    <li>Set up that local computer with a simple copy-paste command.</li>
                    <li>Add your security cameras — we can often find them for you automatically.</li>
                    <li>Fix common problems if something doesn&apos;t show up right away.</li>
                  </ul>
                </div>
              </section>

              <section id="architecture" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">How it works</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-4">
                  Most camera systems send all your video to the cloud. Aura Watch is different. Your cameras connect
                  to a <strong className="text-white font-semibold">small computer at your location</strong> (like a
                  Raspberry Pi or office PC). That computer watches the feeds and only sends you useful updates —
                  things like &ldquo;someone at the front door&rdquo; — not hours of raw footage. Your video stays
                  private, and you use far less internet bandwidth.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[0.78rem]">
                  {[
                    { step: '1', label: 'Your cameras', desc: 'The CCTV cameras you already have' },
                    { step: '2', label: 'Local computer', desc: 'Watches feeds and runs AI on-site' },
                    { step: '3', label: 'Aura Watch', desc: 'Your dashboard, alerts, and Ask AI' },
                  ].map((item) => (
                    <div key={item.step} className="glass-panel p-4 border border-white/5 rounded-xl text-center">
                      <span className="text-[var(--color-secondary)] font-extrabold text-[0.7rem]">STEP {item.step}</span>
                      <p className="text-white font-bold mt-1">{item.label}</p>
                      <p className="text-text-muted mt-0.5">{item.desc}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section id="checklist" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">What you need</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-4">
                  Before you start, make sure you have these ready:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    {
                      title: 'A small computer',
                      desc: 'A Raspberry Pi, Intel NUC, or any Mac/Linux PC on the same Wi‑Fi or network as your cameras. Someone technical can help pick one if needed.',
                    },
                    {
                      title: 'Security cameras',
                      desc: 'IP cameras that can share a video link (most modern CCTV cameras can). They should be on the same network as the computer above.',
                    },
                    {
                      title: 'An Aura Watch account',
                      desc: 'Free to sign up. You\'ll get a personal setup code that links your computer to your account.',
                    },
                    {
                      title: 'Internet on that computer',
                      desc: 'The local computer needs internet so it can talk to Aura Watch. Your cameras themselves don\'t need to be on the public internet.',
                    },
                  ].map((item) => (
                    <div key={item.title} className="glass-panel p-4 border border-white/5 rounded-xl flex items-start gap-3">
                      <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 shrink-0">
                        <Check size={14} />
                      </div>
                      <div>
                        <h3 className="text-[0.84rem] font-bold text-white">{item.title}</h3>
                        <p className="text-[0.76rem] text-text-muted mt-1 leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </article>
          )}

          {topicId === 'streaming-device' && (
            <article className="flex flex-col gap-8">
              <section id="device-prep" className="scroll-mt-28">
                <h1 className="text-[2.1rem] font-extrabold text-white tracking-tight mb-3 leading-tight">
                  Connect Your Device
                </h1>
                <p className="text-text-secondary text-[0.95rem] leading-relaxed">
                  This step links a computer on your premises to your Aura Watch account. Think of it as teaching
                  that computer who it works for. You only need to do this once per computer — if you have two
                  locations, you&apos;ll set up one computer at each.
                </p>
                <Callout>
                  <p>
                    <strong className="text-white">Need a hand?</strong> Ask whoever manages your IT or networks to
                    open a terminal on the computer and paste the command in step 3. The steps below are written so
                    you can forward them as-is.
                  </p>
                </Callout>
              </section>

              <section id="enrollment-token" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">Your setup code</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-4">
                  This is a unique code tied to your Aura Watch account. When you run the install command, this code
                  tells the computer &ldquo;join this customer&apos;s account.&rdquo; Treat it like a password — don&apos;t
                  share it publicly.
                </p>

                {loggedIn && orgId ? (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center justify-between gap-4">
                    <div className="flex flex-col min-w-0">
                      <span className="text-[0.62rem] font-black uppercase text-emerald-400 tracking-wider">
                        Your setup code
                      </span>
                      <code className="text-[0.78rem] font-mono text-emerald-300 truncate mt-1">{orgId}</code>
                    </div>
                    <CopyButton onCopy={() => handleCopy(orgId, setCopiedToken)} copied={copiedToken} />
                  </div>
                ) : (
                  <Callout>
                    <p className="flex items-start gap-2">
                      <LogIn size={16} className="text-[var(--color-secondary)] shrink-0 mt-0.5" />
                      <span>
                        <Link to="/login" className="text-[var(--color-secondary)] font-semibold hover:underline">
                          Sign in
                        </Link>{' '}
                        or{' '}
                        <Link to="/register" className="text-[var(--color-secondary)] font-semibold hover:underline">
                          create a free account
                        </Link>{' '}
                        to see and copy your setup code. After signing in, click{' '}
                        <strong className="text-white">+ Add streaming device</strong> in the dashboard — a popup
                        like the one below will show your code and the install command.
                      </span>
                    </p>
                  </Callout>
                )}
                <Screenshot
                  src={TUTORIAL_IMAGES.addDevice}
                  alt="Add a New Edge Device dialog showing organization ID and install command"
                  caption="Sign in, click + Add streaming device, and copy your setup code (green box) and install command from this popup."
                />
              </section>

              <section id="installer-command" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">Copy and run this</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-4">
                  On the local computer, open the <strong className="text-white font-semibold">Terminal</strong>{' '}
                  app (Mac) or command line (Linux). Copy the text below, paste it in, and press Enter. If you&apos;re
                  not signed in yet, replace <code className="text-cyan-400 text-[0.82rem]">YOUR_ORG_ID</code> with
                  your setup code from the step above.
                </p>
                <div className="rounded-xl border border-white/5 bg-black/40 p-4 flex items-start justify-between gap-4">
                  <div className="flex-1 flex flex-col min-w-0">
                    <span className="text-[0.62rem] font-black uppercase text-cyan-400 tracking-wider mb-1.5 flex items-center gap-1">
                      <Terminal size={10} /> One-line install command
                    </span>
                    <code className="text-[0.72rem] font-mono text-cyan-300 break-all leading-relaxed whitespace-pre-wrap">
                      {installCmd}
                    </code>
                  </div>
                  <CopyButton onCopy={() => handleCopy(installCmd, setCopiedCommand)} copied={copiedCommand} />
                </div>
                <p className="text-[0.78rem] text-text-muted mt-3">
                  The command downloads Aura Watch&apos;s software and starts it automatically. It may take a few
                  minutes. You&apos;ll see text scrolling in the terminal — that&apos;s normal. The same command is
                  also shown in the dashboard popup above — either copy works.
                </p>
              </section>

              <section id="verify-connection" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">Check it worked</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-3">
                  When the command finishes, give it up to a minute. Then sign in to Aura Watch and open{' '}
                  <strong className="text-white font-semibold">Streaming Devices</strong>. Your computer should
                  appear there with a green <strong className="text-emerald-400 font-semibold">Online</strong> label.
                  If it does — you&apos;re done with this step!
                </p>
                <Screenshot
                  src={TUTORIAL_IMAGES.dashboard}
                  alt="Streaming Devices dashboard showing an online device named pi"
                  caption="Look for your device in the Streaming Devices section. A green Online badge means it connected successfully."
                />
                {loggedIn ? (
                  <Link
                    to="/app/live"
                    className="inline-flex items-center gap-2 text-[0.84rem] font-semibold text-[var(--color-secondary)] hover:underline"
                  >
                    Open your dashboard <ArrowRight size={14} />
                  </Link>
                ) : (
                  <Link
                    to="/login"
                    className="inline-flex items-center gap-2 text-[0.84rem] font-semibold text-[var(--color-secondary)] hover:underline"
                  >
                    Sign in to check <ArrowRight size={14} />
                  </Link>
                )}
              </section>

              <section id="diagnostics-tool" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">Try a test run</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-4">
                  Not sure what happens behind the scenes? Click the button below to see a demo of the steps your
                  computer goes through when connecting:
                </p>
                <div className="flex flex-col md:flex-row gap-4 items-stretch">
                  <div className="flex-1 bg-black/50 border border-white/5 rounded-xl p-3.5 h-[160px] overflow-y-auto flex flex-col gap-1.5 text-[0.8rem]">
                    {testerLogs.length === 0 ? (
                      <span className="text-text-muted italic select-none">
                        Ready when you are — click &ldquo;Run test&rdquo; to see what happens.
                      </span>
                    ) : (
                      testerLogs.map((log, index) => (
                        <div
                          key={index}
                          className={`leading-relaxed ${log.startsWith('All good') ? 'text-emerald-400 font-semibold' : 'text-cyan-300'}`}
                        >
                          {log}
                        </div>
                      ))
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={runTesterSimulation}
                    disabled={testerStatus === 'testing'}
                    className="py-3 px-5 bg-[#7C3AED] hover:bg-[#6d28d9] disabled:bg-[rgba(124,58,237,0.4)] disabled:cursor-not-allowed text-white font-bold text-[0.78rem] rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-all shadow-[0_4px_12px_rgba(124,58,237,0.25)] shrink-0 self-center"
                  >
                    {testerStatus === 'testing' ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" /> Running&hellip;
                      </>
                    ) : (
                      <>
                        <Play size={14} /> Run test
                      </>
                    )}
                  </button>
                </div>
              </section>
            </article>
          )}

          {topicId === 'adding-camera' && (
            <article className="flex flex-col gap-8">
              <section id="rtsp-format" className="scroll-mt-28">
                <h1 className="text-[2.1rem] font-extrabold text-white tracking-tight mb-3 leading-tight">
                  Add Your Cameras
                </h1>
                <p className="text-text-secondary text-[0.95rem] leading-relaxed mb-4">
                  Once your local computer is connected, it&apos;s time to bring in your cameras. The good news: Aura
                  Watch can often find them for you automatically. If not, you&apos;ll need a &ldquo;camera link&rdquo;
                  from your camera&apos;s settings — your installer or camera brand&apos;s app usually has this.
                </p>
                <h2 className="text-[1.1rem] font-bold text-white mb-2">What a camera link looks like</h2>
                <p className="text-[0.86rem] text-text-secondary mb-3">
                  It&apos;s a web-style address with your camera&apos;s username, password, and location. Here&apos;s an example:
                </p>
                <div className="rounded-xl border border-white/5 bg-black/40 p-4 flex items-center justify-between gap-4">
                  <code className="text-[0.74rem] font-mono text-cyan-300 break-all">{sampleRtsp}</code>
                  <CopyButton onCopy={() => handleCopy(sampleRtsp, setCopiedRtsp)} copied={copiedRtsp} />
                </div>
                <p className="text-[0.78rem] text-text-muted mt-3">
                  The link always starts with <code className="text-cyan-400 text-[0.76rem]">rtsp://</code> and
                  includes your camera&apos;s IP address, username, and password. The path at the end varies by brand —
                  see the next section for common examples.
                </p>
              </section>

              <section id="rtsp-by-brand" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">Links by camera brand</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-4">
                  Every brand formats the link slightly differently. Replace the placeholders below with your own
                  values: <strong className="text-white font-semibold">username</strong>,{' '}
                  <strong className="text-white font-semibold">password</strong>, and your camera&apos;s{' '}
                  <strong className="text-white font-semibold">IP address</strong> (e.g.{' '}
                  <code className="text-cyan-400 text-[0.82rem]">192.168.1.100</code>). Port{' '}
                  <code className="text-cyan-400 text-[0.82rem]">554</code> is standard for RTSP unless your
                  installer used a different one.
                </p>
                <div className="flex flex-col gap-3">
                  {[
                    {
                      brand: 'Hikvision',
                      where: 'Camera web page → Configuration → Network → Advanced → Integration Protocol. Enable RTSP if it is off.',
                      main: 'rtsp://username:password@192.168.1.100:554/Streaming/Channels/101',
                      sub: 'rtsp://username:password@192.168.1.100:554/Streaming/Channels/102',
                      note: '101 = main (high quality), 102 = sub-stream (lower quality). Try the sub-stream if your computer struggles with 4K.',
                    },
                    {
                      brand: 'Dahua / Amcrest',
                      where: 'Camera web page → Setup → Network → Connection, or the Dahua / Amcrest mobile app under Device Info.',
                      main: 'rtsp://username:password@192.168.1.100:554/cam/realmonitor?channel=1&subtype=0',
                      sub: 'rtsp://username:password@192.168.1.100:554/cam/realmonitor?channel=1&subtype=1',
                      note: 'subtype=0 is main stream, subtype=1 is sub-stream. Channel 1 is the first camera on a recorder; use channel 2, 3, etc. for additional cameras.',
                    },
                    {
                      brand: 'Reolink',
                      where: 'Reolink app → Device Settings → Network → Advanced, or the camera\'s web interface. RTSP must be enabled.',
                      main: 'rtsp://username:password@192.168.1.100:554/h264Preview_01_main',
                      sub: 'rtsp://username:password@192.168.1.100:554/h264Preview_01_sub',
                      note: 'Older Reolink models may use Preview_01_main instead of h264Preview_01_main.',
                    },
                    {
                      brand: 'CP Plus / DVR-NVR',
                      where: 'DVR/NVR menu → Network → RTSP, or the CP Plus mobile app. Many CP Plus devices use Dahua-style paths.',
                      main: 'rtsp://username:password@192.168.1.100:554/cam/realmonitor?channel=1&subtype=0',
                      sub: 'rtsp://username:password@192.168.1.100:554/cam/realmonitor?channel=1&subtype=1',
                      note: 'For a standalone CP Plus IP camera, channel is usually 1. On a DVR, each camera input has its own channel number.',
                    },
                    {
                      brand: 'TP-Link Tapo',
                      where: 'Tapo app → Camera Settings → Advanced Settings → Camera Account. Create a camera username and password — the Tapo cloud login will not work for RTSP.',
                      main: 'rtsp://camera_username:camera_password@192.168.1.100:554/stream1',
                      sub: 'rtsp://camera_username:camera_password@192.168.1.100:554/stream2',
                      note: 'stream1 = HD, stream2 = SD. RTSP must be turned on in the Tapo app first.',
                    },
                    {
                      brand: 'Axis',
                      where: 'Camera web page → System → Plain Config → Network → RTSP, or check the Axis support site for your model.',
                      main: 'rtsp://root:password@192.168.1.100/axis-media/media.amp',
                      sub: null,
                      note: 'Default username is often root. Some models use a different path — check the sticker on the camera or Axis documentation.',
                    },
                    {
                      brand: 'Ubiquiti UniFi Protect',
                      where: 'UniFi Protect console → Cameras → select camera → Settings → Advanced. Copy the RTSP URL shown there.',
                      main: 'rtsp://username:password@192.168.1.100:7447/s0PpHk8xYzQ',
                      sub: null,
                      note: 'UniFi generates a unique path per camera. Enable RTSP in Protect settings and copy the full URL — do not guess the path.',
                    },
                  ].map((item) => (
                    <div key={item.brand} className="glass-panel p-4 border border-white/5 rounded-xl flex flex-col gap-2.5">
                      <h3 className="text-[0.9rem] font-bold text-white">{item.brand}</h3>
                      <p className="text-[0.78rem] text-text-muted leading-relaxed">
                        <strong className="text-text-secondary">Where to find it:</strong> {item.where}
                      </p>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[0.62rem] font-black uppercase text-cyan-400 tracking-wider">
                          {item.sub ? 'Main stream' : 'Example link'}
                        </span>
                        <code className="text-[0.72rem] font-mono text-cyan-300 break-all leading-relaxed">
                          {item.main}
                        </code>
                        {item.sub && (
                          <>
                            <span className="text-[0.62rem] font-black uppercase text-cyan-400 tracking-wider mt-1">
                              Sub-stream
                            </span>
                            <code className="text-[0.72rem] font-mono text-cyan-300 break-all leading-relaxed">
                              {item.sub}
                            </code>
                          </>
                        )}
                      </div>
                      <p className="text-[0.76rem] text-text-muted leading-relaxed">{item.note}</p>
                    </div>
                  ))}
                </div>
                <Callout>
                  <p>
                    <strong className="text-white">Don&apos;t see your brand?</strong> Search online for{' '}
                    <em>&ldquo;[your camera model] RTSP URL&rdquo;</em> or check the manual. Your CCTV installer
                    almost always has these links on file.
                  </p>
                </Callout>
              </section>

              <section id="verify-rtsp-vlc" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">Test your link with VLC</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-4">
                  Before adding a camera to Aura Watch, you can check whether the RTSP link works using{' '}
                  <strong className="text-white font-semibold">VLC media player</strong> — a free app available on
                  Windows, Mac, and Linux. If VLC can play the stream, Aura Watch should be able to connect too.
                </p>
                <ol className="text-[0.86rem] text-text-secondary flex flex-col gap-3 list-decimal pl-5 mb-4">
                  <li>
                    Download and install VLC from{' '}
                    <a
                      href="https://www.videolan.org/vlc/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--color-secondary)] font-semibold hover:underline"
                    >
                      videolan.org
                    </a>
                    .
                  </li>
                  <li>
                    Open VLC. On the menu bar, click{' '}
                    <strong className="text-white font-semibold">Media</strong> →{' '}
                    <strong className="text-white font-semibold">Open Network Stream…</strong> (on Mac:{' '}
                    <strong className="text-white font-semibold">File</strong> →{' '}
                    <strong className="text-white font-semibold">Open Network…</strong>).
                  </li>
                  <li>
                    Paste your full RTSP link into the URL field — e.g.{' '}
                    <code className="text-cyan-400 text-[0.8rem]">{sampleRtsp}</code>
                  </li>
                  <li>
                    Click <strong className="text-white font-semibold">Play</strong>. Wait a few seconds.
                  </li>
                  <li>
                    <strong className="text-emerald-400 font-semibold">Working:</strong> live video appears in the
                    VLC window. The link is valid — copy the same URL into Aura Watch.
                  </li>
                  <li>
                    <strong className="text-rose-400 font-semibold">Not working:</strong> VLC shows an error, stays
                    black, or spins forever. See the checklist below.
                  </li>
                </ol>
                <div className="rounded-xl border border-white/5 bg-gradient-to-br from-[#0c121e] to-[#04060b] p-5 flex flex-col gap-3">
                  <h3 className="text-[0.88rem] font-bold text-white">If VLC cannot play the stream</h3>
                  <ul className="text-[0.82rem] text-text-secondary flex flex-col gap-2 list-disc pl-5">
                    <li>
                      Run VLC on a computer on the <strong className="text-white font-semibold">same network</strong>{' '}
                      as the camera — RTSP usually does not work over the public internet unless your installer set
                      that up.
                    </li>
                    <li>Double-check username and password. Special characters in passwords sometimes need URL-encoding (e.g. <code className="text-cyan-400 text-[0.76rem]">@</code> becomes <code className="text-cyan-400 text-[0.76rem]">%40</code>).</li>
                    <li>Confirm RTSP is enabled in the camera&apos;s settings — some brands ship with it turned off.</li>
                    <li>Try the sub-stream URL instead of the main stream — it uses less bandwidth and is easier to connect.</li>
                    <li>Verify the camera&apos;s IP address hasn&apos;t changed (check your router&apos;s device list or the camera app).</li>
                  </ul>
                </div>
              </section>

              <section id="auto-discovery" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">Let us find them (easiest way)</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-3">
                  If your computer and cameras are on the same network, Aura Watch can scan and list them for you:
                </p>
                <ol className="text-[0.86rem] text-text-secondary flex flex-col gap-2.5 list-decimal pl-5">
                  <li>
                    Sign in and open <strong className="text-white font-semibold">Streaming Devices</strong>.
                  </li>
                  <li>
                    Find your connected computer and click{' '}
                    <strong className="text-white font-semibold">Discover streams</strong>.
                  </li>
                  <li>Wait a few seconds — a list of found cameras should appear.</li>
                  <li>
                    Click <strong className="text-emerald-400 font-semibold">Import</strong> next to each camera you
                    want to add. That&apos;s it!
                  </li>
                </ol>
                <Screenshot
                  src={TUTORIAL_IMAGES.dashboard}
                  alt="Dashboard showing Discover streams button on a device card and a list of IP cameras"
                  caption="On your device card, click Discover streams to scan for cameras. Added cameras appear in the IP Cameras table below with a green Live badge."
                />
              </section>

              <section id="manual-add" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">Add one yourself</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-3">
                  Use this if auto-discovery didn&apos;t find your camera, or you only want to add one at a time.
                  In the same dashboard screen shown above, scroll to the{' '}
                  <strong className="text-white font-semibold">IP Cameras</strong> section:
                </p>
                <ol className="text-[0.86rem] text-text-secondary flex flex-col gap-2.5 list-decimal pl-5">
                  <li>
                    Click <strong className="text-white font-semibold">+ Add IP camera</strong> in the top-right of
                    that section.
                  </li>
                  <li>Fill in the form that appears — see the screenshot below for each field.</li>
                  <li>
                    Click the purple <strong className="text-white font-semibold">Add IP camera</strong> button to save.
                  </li>
                </ol>
                <Screenshot
                  src={TUTORIAL_IMAGES.addCamera}
                  alt="Add IP camera form with fields for camera name, streaming device, RTSP URL, and zone label"
                  caption="Camera name — a label you'll recognise (e.g. Main Gate). Streaming device — which computer handles this camera. RTSP URL — paste your camera link here. Zone / area label — where the camera is located (e.g. Forecourt)."
                />
              </section>

              <section id="troubleshoot-streams" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">Something wrong?</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-4">
                  If a camera shows <strong className="text-rose-400 font-semibold">Offline</strong> or{' '}
                  <strong className="text-rose-400 font-semibold">Error</strong>, try these in order:
                </p>
                <ul className="text-[0.86rem] text-text-secondary flex flex-col gap-2 list-disc pl-5">
                  <li>Is the camera turned on and connected to the same Wi‑Fi or network as your local computer?</li>
                  <li>Double-check the username and password in the camera link — a typo is the most common issue.</li>
                  <li>Test the RTSP link in VLC first (see the section above). If VLC cannot play it, fix the link before adding it to Aura Watch.</li>
                  <li>Ask your IT person to confirm the camera and computer can &ldquo;see&rdquo; each other on the network.</li>
                  <li>If the video quality is very high, try adding the lower-quality stream instead — some small computers struggle with 4K.</li>
                </ul>
              </section>
            </article>
          )}

          {topicId === 'live-monitoring' && (
            <article className="flex flex-col gap-8">
              <section id="live-overview" className="scroll-mt-28">
                <h1 className="text-[2.1rem] font-extrabold text-white tracking-tight mb-3 leading-tight">
                  Watch Cameras Live
                </h1>
                <p className="text-text-secondary text-[0.95rem] leading-relaxed mb-4">
                  This is the main live viewing screen. It shows camera feeds as they are happening right now, so your
                  team can keep an eye on entrances, parking areas, warehouses, and other important places.
                </p>
                <Screenshot
                  src={TUTORIAL_IMAGES.liveMonitoring}
                  alt="Live Monitoring page showing two camera tiles and a camera settings panel"
                  caption="The Live Monitoring screen shows your camera tiles on the left and details for the selected camera on the right."
                />
              </section>

              <section id="live-wall" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">Live wall</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-3">
                  Each tile is one camera. Use this area to quickly check what is happening across your site.
                </p>
                <ul className="text-[0.86rem] text-text-secondary flex flex-col gap-2 list-disc pl-5">
                  <li>The camera name or number appears on each tile.</li>
                  <li>Use the zone buttons at the top to filter cameras by area.</li>
                  <li>If a camera is working, you should see a live picture updating in the tile.</li>
                  <li>You can click a camera tile to focus on it and view more details.</li>
                </ul>
              </section>

              <section id="camera-panel" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">Camera settings panel</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-3">
                  The panel on the right changes when you click a camera. It is where you can inspect that camera and
                  adjust AI-related options for it.
                </p>
                <Callout>
                  <p>
                    If the panel says <strong className="text-white">No camera selected</strong>, simply click one of
                    the camera tiles on the left.
                  </p>
                </Callout>
              </section>
            </article>
          )}

          {topicId === 'event-archive' && (
            <article className="flex flex-col gap-8">
              <section id="archive-overview" className="scroll-mt-28">
                <h1 className="text-[2.1rem] font-extrabold text-white tracking-tight mb-3 leading-tight">
                  Review Past Events
                </h1>
                <p className="text-text-secondary text-[0.95rem] leading-relaxed mb-4">
                  Use the Event Archive when you want to look back at something that already happened. It stores clips,
                  lets you play them back, and shows an AI-written summary of what was seen.
                </p>
                <Screenshot
                  src={TUTORIAL_IMAGES.eventArchive}
                  alt="Event Archive page showing a clip list, video preview, AI summary, and detected objects"
                  caption="The Event Archive helps you review saved clips, read a plain-language summary, and inspect detected objects."
                />
              </section>

              <section id="clip-list" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">Clip list</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-3">
                  The left side shows a list of saved events. Pick any row to open that clip.
                </p>
                <ul className="text-[0.86rem] text-text-secondary flex flex-col gap-2 list-disc pl-5">
                  <li>Each item shows the camera, time, and a quick summary.</li>
                  <li>You can scroll down to view older events.</li>
                  <li>Use filters at the top if you want to narrow the list.</li>
                </ul>
              </section>

              <section id="clip-details" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">Clip details</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-3">
                  The large panel on the right is the selected clip. This is where you review what happened.
                </p>
                <ul className="text-[0.86rem] text-text-secondary flex flex-col gap-2 list-disc pl-5">
                  <li>The video player shows the saved moment.</li>
                  <li>The AI summary explains the clip in simple language.</li>
                  <li>The detected objects section lists people, cars, and other things found in the scene.</li>
                </ul>
              </section>
            </article>
          )}

          {topicId === 'ask-camera-ai' && (
            <article className="flex flex-col gap-8">
              <section id="ask-overview" className="scroll-mt-28">
                <h1 className="text-[2.1rem] font-extrabold text-white tracking-tight mb-3 leading-tight">
                  Ask Camera AI
                </h1>
                <p className="text-text-secondary text-[0.95rem] leading-relaxed mb-4">
                  This page lets you search your footage using normal sentences instead of manually scrubbing through
                  videos. You type what you are looking for, and Aura Watch searches across your camera clips.
                </p>
                <Screenshot
                  src={TUTORIAL_IMAGES.askCameraAi}
                  alt="Ask Camera AI page with a large search box and suggested questions"
                  caption="Type your question into the search box, then let Aura Watch look through your footage for matching moments."
                />
              </section>

              <section id="search-box" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">Search box</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-3">
                  The big search bar is the main part of this page. Type what you want to find, such as:
                </p>
                <ul className="text-[0.86rem] text-text-secondary flex flex-col gap-2 list-disc pl-5">
                  <li>&ldquo;Show people entering after 10 PM&rdquo;</li>
                  <li>&ldquo;Find a white car near the gate&rdquo;</li>
                  <li>&ldquo;Did anyone leave a bag in the lobby today?&rdquo;</li>
                </ul>
              </section>

              <section id="question-ideas" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">Question ideas</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-3">
                  The right side includes example questions. These are useful when you are not sure how to phrase your
                  search yet.
                </p>
                <Callout>
                  <p>
                    Start simple. Short, clear questions like <strong className="text-white">&ldquo;red shirt near loading dock&rdquo;</strong> often work better than long paragraphs.
                  </p>
                </Callout>
              </section>
            </article>
          )}

          {topicId === 'manage-alert-rules' && (
            <article className="flex flex-col gap-8">
              <section id="rules-overview" className="scroll-mt-28">
                <h1 className="text-[2.1rem] font-extrabold text-white tracking-tight mb-3 leading-tight">
                  Create Alert Rules
                </h1>
                <p className="text-text-secondary text-[0.95rem] leading-relaxed mb-4">
                  Alert rules tell Aura Watch when to notify your team. For example, you might want an alert when a
                  car appears after hours or when movement is detected in a restricted zone.
                </p>
                <Screenshot
                  src={TUTORIAL_IMAGES.manageNotifications}
                  alt="Manage Notifications page showing an alert rule form"
                  caption="Use this page to create rules, choose which cameras they apply to, and decide who receives the alert."
                />
              </section>

              <section id="rule-fields" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">Fill in the rule</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-3">
                  Start by naming the rule and writing what should trigger it.
                </p>
                <ul className="text-[0.86rem] text-text-secondary flex flex-col gap-2 list-disc pl-5">
                  <li><strong className="text-white">Rule Name</strong>: a label your team will recognise.</li>
                  <li><strong className="text-white">AI Alert Criteria</strong>: describe what you want to be alerted about.</li>
                  <li><strong className="text-white">Applies to Streams</strong>: choose all cameras or only selected ones.</li>
                </ul>
              </section>

              <section id="rule-channels" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">Where alerts are sent</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-3">
                  Near the bottom, you choose how people are notified.
                </p>
                <ul className="text-[0.86rem] text-text-secondary flex flex-col gap-2 list-disc pl-5">
                  <li>Notification Center sends alerts inside the app.</li>
                  <li>Send Email Alert can email people when supported.</li>
                  <li>Trigger Webhook sends alerts to another system.</li>
                </ul>
              </section>
            </article>
          )}

          {topicId === 'notification-center' && (
            <article className="flex flex-col gap-8">
              <section id="feed-overview" className="scroll-mt-28">
                <h1 className="text-[2.1rem] font-extrabold text-white tracking-tight mb-3 leading-tight">
                  Check Notifications
                </h1>
                <p className="text-text-secondary text-[0.95rem] leading-relaxed mb-4">
                  The Notification Center is your inbox for alerts and system messages. It helps you see what needs
                  attention without jumping between different pages.
                </p>
                <Screenshot
                  src={TUTORIAL_IMAGES.notificationCenter}
                  alt="Notification Center page with filters on the left and an empty feed state"
                  caption="Use the Notification Center to review alerts, narrow them by camera or rule, and clear the feed when needed."
                />
              </section>

              <section id="feed-filters" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">Use filters</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-3">
                  The filter panel on the left helps you quickly narrow down the feed.
                </p>
                <ul className="text-[0.86rem] text-text-secondary flex flex-col gap-2 list-disc pl-5">
                  <li>Filter by category to separate AI alerts from system logs.</li>
                  <li>Filter by camera to focus on one location.</li>
                  <li>Filter by alert rule to review one type of alert at a time.</li>
                </ul>
              </section>

              <section id="empty-feed" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">If nothing appears</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed">
                  If the page says there are no notifications, that can simply mean nothing has been triggered yet or
                  your current filters are too narrow. Try switching the filters back to “All” first.
                </p>
              </section>
            </article>
          )}

          {topicId === 'organization-settings' && (
            <article className="flex flex-col gap-8">
              <section id="settings-overview" className="scroll-mt-28">
                <h1 className="text-[2.1rem] font-extrabold text-white tracking-tight mb-3 leading-tight">
                  Organization Settings
                </h1>
                <p className="text-text-secondary text-[0.95rem] leading-relaxed mb-4">
                  This page controls major features for your whole organization. Changes here affect how video
                  processing, AI search, and notifications behave for your team.
                </p>
                <Screenshot
                  src={TUTORIAL_IMAGES.orgSettings}
                  alt="Organization Settings page with toggles for video summary, Ask Camera AI, and notifications"
                  caption="Organization Settings lets admins turn key features on or off for the entire workspace."
                />
              </section>

              <section id="video-ai-settings" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">Video and AI options</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-3">
                  The upper half of the page controls what Aura Watch does with your clips.
                </p>
                <ul className="text-[0.86rem] text-text-secondary flex flex-col gap-2 list-disc pl-5">
                  <li>Video summary creates plain-language summaries for clips.</li>
                  <li>ReID processing helps track people or objects across clips.</li>
                  <li>Semantic search indexing and Ask Camera AI power natural-language search.</li>
                </ul>
              </section>

              <section id="notification-settings" className="scroll-mt-28">
                <h2 className="text-[1.4rem] font-bold text-white mb-3">Notification options</h2>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed mb-3">
                  Lower down, you can control how notifications behave.
                </p>
                <ul className="text-[0.86rem] text-text-secondary flex flex-col gap-2 list-disc pl-5">
                  <li>Enable or disable notifications for the whole organization.</li>
                  <li>Set the minimum alert severity you want to receive.</li>
                  <li>Add a webhook URL if another system should receive alerts automatically.</li>
                </ul>
              </section>
            </article>
          )}

          {/* Prev / Next navigation */}
          <nav className="mt-14 pt-8 border-t border-white/6 flex items-center justify-between gap-4">
            {prevTopic ? (
              <Link
                to={`/tutorials/${prevTopic.id}`}
                className="group flex flex-col gap-1 text-left hover:opacity-90 transition-opacity"
              >
                <span className="text-[0.7rem] font-semibold text-text-muted flex items-center gap-1">
                  <ChevronLeft size={12} /> Previous
                </span>
                <span className="text-[0.88rem] font-bold text-[var(--color-secondary)] group-hover:underline">
                  {prevTopic.title}
                </span>
              </Link>
            ) : (
              <span />
            )}
            {nextTopic ? (
              <Link
                to={`/tutorials/${nextTopic.id}`}
                className="group flex flex-col gap-1 text-right hover:opacity-90 transition-opacity"
              >
                <span className="text-[0.7rem] font-semibold text-text-muted flex items-center gap-1 justify-end">
                  Next <ChevronRight size={12} />
                </span>
                <span className="text-[0.88rem] font-bold text-[var(--color-secondary)] group-hover:underline">
                  {nextTopic.title}
                </span>
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </main>

        {/* Right sidebar spacer */}
        <div className="hidden xl:block w-52 shrink-0" aria-hidden="true" />

        {/* Right sidebar — table of contents */}
        <aside className="hidden xl:block fixed top-24 right-[max(1.5rem,calc((100vw-1400px)/2+1.5rem))] bottom-6 w-52 overflow-y-auto pl-4 border-l border-white/5 text-left select-none">
          <p className="text-[0.68rem] font-black tracking-wider text-text-muted uppercase mb-3">On this page</p>
          <nav className="flex flex-col gap-2.5" aria-label="Table of contents">
            {activeTopic.subheadings.map((sub) => (
              <button
                key={sub.id}
                type="button"
                onClick={() => scrollToSection(sub.id)}
                className={`text-left text-[0.78rem] font-medium transition-colors leading-relaxed ${
                  (activeSubheadingId || activeTopic.subheadings[0]?.id) === sub.id
                    ? 'text-[var(--color-secondary)] font-bold'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {sub.label}
              </button>
            ))}
          </nav>
        </aside>
      </div>

      <Footer />
    </div>
  );
}

function SidebarNav({
  activeTopicId,
  onTopicClick,
}: {
  activeTopicId: string;
  onTopicClick: (topicId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      {DOCUMENTATION.map((sec) => (
        <div key={sec.title} className="flex flex-col gap-1.5">
          <h2 className="text-[0.65rem] font-bold tracking-wider text-text-muted uppercase px-3">
            {sec.title}
          </h2>
          <ul className="flex flex-col gap-0.5">
            {sec.topics.map((topic) => {
              const isActive = activeTopicId === topic.id;
              return (
                <li key={topic.id}>
                  <button
                    type="button"
                    onClick={() => onTopicClick(topic.id)}
                    className={`w-full text-left py-1.5 px-3 rounded-lg text-[0.82rem] font-semibold transition-all ${
                      isActive
                        ? 'bg-[rgba(6,182,212,0.1)] text-[var(--color-secondary)]'
                        : 'text-text-secondary hover:text-white hover:bg-white/2'
                    }`}
                  >
                    {topic.title}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
