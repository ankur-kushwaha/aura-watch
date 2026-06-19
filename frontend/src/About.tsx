import { useEffect } from 'react';
import { Sparkles, Shield, Cpu as CpuIcon, Target } from 'lucide-react';
import Header from './components/Header';
import Footer from './components/Footer';
import { CONTACT } from './constants';

export default function About() {
  useEffect(() => {
    document.title = 'About Us — Aura Watch AI';

    // Update meta description
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.setAttribute('name', 'description');
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute('content', 'Learn about Aura Watch AI, our mission to build privacy-first edge AI camera surveillance, and the team behind it.');

    // Update keywords
    let metaKey = document.querySelector('meta[name="keywords"]');
    if (!metaKey) {
      metaKey = document.createElement('meta');
      metaKey.setAttribute('name', 'keywords');
      document.head.appendChild(metaKey);
    }
    metaKey.setAttribute('content', 'Aura Watch AI team, local edge surveillance mission, privacy-first computer vision, Ankur Kushwaha developer');

    // Update canonical link
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', 'https://aura-watch.adboardtools.com/about');

    // Inject structured data
    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'AboutPage',
      'name': 'About Aura Watch AI',
      'description': 'Learn about Aura Watch AI, our mission to build privacy-first edge AI camera surveillance, and the team behind it.',
      'url': 'https://aura-watch.adboardtools.com/about',
      'mainEntity': {
        '@type': 'Organization',
        'name': 'Aura Watch AI',
        'logo': 'https://aura-watch.adboardtools.com/favicon.svg',
        'founder': {
          '@type': 'Person',
          'name': 'Ankur Kushwaha'
        }
      }
    };

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.seo = 'about-page';
    script.textContent = JSON.stringify(structuredData);
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);

  return (
    <div className="relative">
      {/* Nav */}
      <Header />

      {/* Main content */}
      <main className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-16 max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/4 text-[0.8rem] text-text-secondary mb-6 landing-fade-in">
              <Sparkles size={14} className="text-secondary" />
              Our Mission & Journey
            </div>
            <h1 className="text-[2.5rem] md:text-[3.5rem] font-extrabold leading-tight mb-6">
              <span className="text-gradient">Redefining Spatial Security</span>
            </h1>
            <p className="text-text-secondary text-[1.05rem] md:text-[1.15rem] leading-relaxed">
              Aura Watch AI was born out of a simple conviction: physical space security shouldn&apos;t compromise user privacy or require expensive dedicated network lines. We build software that makes edge-based video analytics fast, secure, and semantic.
            </p>
          </div>

          {/* Pillars grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
            <div className="glass-panel p-6 flex flex-col gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Shield size={20} />
              </div>
              <h3 className="text-[1.15rem] font-bold">Privacy-First</h3>
              <p className="text-text-secondary text-[0.85rem] leading-relaxed">
                By processing feeds locally on your edge nodes, raw video never touches public clouds. Security is locally contained, satisfying strict data retention policies.
              </p>
            </div>

            <div className="glass-panel p-6 flex flex-col gap-4">
              <div className="w-10 h-10 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center text-secondary">
                <CpuIcon size={20} />
              </div>
              <h3 className="text-[1.15rem] font-bold">Local Edge Power</h3>
              <p className="text-text-secondary text-[0.85rem] leading-relaxed">
                Our lightweight YOLOv8 and ByteTrack containers compile directly on inexpensive hardware (Raspberry Pi/Jetson), converting raw video streams into semantic insights.
              </p>
            </div>

            <div className="glass-panel p-6 flex flex-col gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Target size={20} />
              </div>
              <h3 className="text-[1.15rem] font-bold">Semantic Search</h3>
              <p className="text-text-secondary text-[0.85rem] leading-relaxed">
                We align visual keyframe features with natural language models. Search your footage chronologically using conversational English and skip the scrubs.
              </p>
            </div>
          </div>

          {/* Creator Profile */}
          <div className="glass-panel p-8 md:p-10 mb-12">
            <h2 className="text-[1.5rem] md:text-[1.8rem] font-bold mb-6 text-gradient-purple">Meet the Founder</h2>
            <div className="flex flex-col md:flex-row gap-8 items-center">
              <div className="w-24 h-24 rounded-full bg-primary/25 border-2 border-primary/50 flex items-center justify-center shrink-0 text-text-primary text-[2.5rem] font-bold">
                AK
              </div>
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-[1.2rem] font-bold text-text-primary">{CONTACT.name}</h3>
                  <p className="text-[0.8rem] text-secondary font-medium">Lead Developer & Founder</p>
                </div>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed">
                  Ankur is a computer vision engineer specializing in edge AI, multi-camera re-identification models, and real-time deep learning pipeline optimizations. He created Aura Watch AI to provide commercial-grade visual indexing tools directly to edge devices, empowering space managers to secure physical premises without complex infrastructures.
                </p>
                <div className="flex flex-wrap gap-4 text-[0.8rem]">
                  <a href={`mailto:${CONTACT.email}`} className="text-secondary hover:underline">
                    {CONTACT.email}
                  </a>
                  <span className="text-text-muted">|</span>
                  <a href={`tel:+91${CONTACT.phone}`} className="text-secondary hover:underline">
                    +91 {CONTACT.phone}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
