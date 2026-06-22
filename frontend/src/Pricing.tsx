import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BellRing,
  Camera,
  Check,
  MessageSquare,
  Sparkles,
  Users,
} from 'lucide-react';
import Header from './components/Header';
import Footer from './components/Footer';

const INCLUDED_FEATURES = [
  {
    icon: Camera,
    title: 'On-device detection',
    description: 'Person and vehicle detection with motion-triggered clip recording on every camera.',
  },
  {
    icon: Users,
    title: 'Cross-camera tracking',
    description: 'Follow movement across feeds and trace paths through your site.',
  },
  {
    icon: BellRing,
    title: 'Proactive alerts',
    description: 'Get notified when activity matches your rules—no constant watching required.',
  },
  {
    icon: MessageSquare,
    title: 'Ask Camera AI',
    description: 'Query your footage in plain English and get cited answers from your archive.',
  },
];

const PRICING_BULLETS = [
  'First camera is free for trial',
  'Billed per camera with active AI processing',
  'No hidden tiers or per-seat fees',
  'Scale up or down as you add or remove cameras',
  'Edge processing keeps video local—only insights leave the device',
];

export default function Pricing() {
  useEffect(() => {
    document.title = 'Pricing — Aura Watch AI';

    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.setAttribute('name', 'description');
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute(
      'content',
      'Simple pricing for Aura Watch AI: first camera free for trial, then $20 per camera for AI processing. Person tracking, live monitoring, alerts, and Ask Camera AI included.',
    );

    let metaKey = document.querySelector('meta[name="keywords"]');
    if (!metaKey) {
      metaKey = document.createElement('meta');
      metaKey.setAttribute('name', 'keywords');
      document.head.appendChild(metaKey);
    }
    metaKey.setAttribute(
      'content',
      'aura watch pricing, camera AI cost, surveillance AI pricing, per camera billing, edge AI surveillance',
    );

    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', 'https://aura-watch.adboardtools.com/pricing');

    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Aura Watch AI Pricing',
      description: 'First camera free for trial, then $20 per camera for AI processing.',
      url: 'https://aura-watch.adboardtools.com/pricing',
      mainEntity: {
        '@type': 'Product',
        name: 'Aura Watch AI Processing',
        description: 'AI-powered surveillance processing per camera',
        offers: {
          '@type': 'Offer',
          price: '20',
          priceCurrency: 'USD',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: '20',
            priceCurrency: 'USD',
            unitText: 'camera',
          },
        },
      },
    };

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.seo = 'pricing-page';
    script.textContent = JSON.stringify(structuredData);
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);

  return (
    <div className="relative">
      <Header />

      <main className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14 max-w-2xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/4 text-[0.8rem] text-text-secondary mb-6 landing-fade-in">
              <Sparkles size={14} className="text-secondary" />
              Simple, transparent pricing
            </div>
            <h1 className="text-[2.5rem] md:text-[3.25rem] font-extrabold leading-tight mb-4">
              <span className="text-gradient">One camera free for trial.</span>
              <br />
              <span className="text-gradient-purple">Then $20 per camera.</span>
            </h1>
            <p className="text-text-secondary text-[1.05rem] leading-relaxed">
              Start with one free trial camera, then pay a flat rate for each additional camera with AI
              processing enabled. No complicated plans or surprise add-ons.
            </p>
          </div>

          <div className="glass-panel active p-8 md:p-12 mb-12 text-center border border-primary/20 shadow-[0_0_50px_rgba(124,58,237,0.12)]">
            <p className="text-[0.8rem] uppercase tracking-widest text-secondary font-semibold mb-4">
              AI processing
            </p>
            <p className="text-[0.9rem] text-secondary font-medium mb-3">1 camera free for trial</p>
            <div className="flex items-baseline justify-center gap-2 mb-3">
              <span className="text-[3.5rem] md:text-[4rem] font-extrabold text-text-primary leading-none">$20</span>
              <span className="text-text-secondary text-[1.1rem]">/ camera</span>
            </div>
            <p className="text-text-secondary text-[0.95rem] mb-8 max-w-md mx-auto">
              After your free trial camera, each additional camera with active AI processing includes
              detection, tracking, alerts, and Ask Camera AI.
            </p>
            <ul className="text-left max-w-sm mx-auto flex flex-col gap-3 mb-8">
              {PRICING_BULLETS.map((bullet) => (
                <li key={bullet} className="flex items-start gap-3 text-[0.875rem] text-text-secondary">
                  <Check size={16} className="text-secondary shrink-0 mt-0.5" />
                  {bullet}
                </li>
              ))}
            </ul>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/register" className="btn btn-primary text-[0.95rem] px-8 py-3">
                Get started
                <ArrowRight size={16} />
              </Link>
              <Link to="/contact" className="btn text-[0.95rem] px-8 py-3 border border-white/10 hover:border-white/20">
                Talk to sales
              </Link>
            </div>
          </div>

          <div className="mb-12">
            <h2 className="text-[1.35rem] font-bold text-center mb-8">What&apos;s included</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {INCLUDED_FEATURES.map(({ icon: Icon, title, description }) => (
                <div key={title} className="glass-panel p-6 flex flex-col gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                    <Icon size={18} />
                  </div>
                  <h3 className="text-[1rem] font-bold">{title}</h3>
                  <p className="text-text-secondary text-[0.85rem] leading-relaxed">{description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel p-8 text-center">
            <h2 className="text-[1.25rem] font-bold mb-3">Need a larger deployment?</h2>
            <p className="text-text-secondary text-[0.9rem] mb-6 max-w-lg mx-auto">
              Running dozens of cameras across multiple sites? Reach out for onboarding help and volume
              arrangements.
            </p>
            <Link to="/contact" className="text-secondary hover:underline text-[0.9rem] font-medium">
              Contact us for enterprise pricing →
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
