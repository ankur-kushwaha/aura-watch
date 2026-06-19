import { useEffect } from 'react';
import { Shield, Eye, Lock, RefreshCw } from 'lucide-react';
import Header from './components/Header';
import Footer from './components/Footer';
import { CONTACT } from './constants';


export default function Privacy() {
  useEffect(() => {
    document.title = 'Privacy Policy — Aura Watch AI';

    // Update meta description
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.setAttribute('name', 'description');
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute('content', 'Privacy Policy for Aura Watch AI. Read how we protect your security footage by prioritizing local processing and edge AI analytics.');

    // Update keywords
    let metaKey = document.querySelector('meta[name="keywords"]');
    if (!metaKey) {
      metaKey = document.createElement('meta');
      metaKey.setAttribute('name', 'keywords');
      document.head.appendChild(metaKey);
    }
    metaKey.setAttribute('content', 'privacy policy, camera security privacy, local video storage, encrypted uploads, Re-ID profile security');

    // Update canonical link
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', 'https://aura-watch.adboardtools.com/privacy');

    // Inject structured data
    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      'name': 'Privacy Policy — Aura Watch AI',
      'description': 'Privacy Policy for Aura Watch AI. Read how we protect your security footage by prioritizing local processing and edge AI analytics.',
      'url': 'https://aura-watch.adboardtools.com/privacy'
    };

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.seo = 'privacy-page';
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

      {/* Main Container */}
      <main className="pt-32 pb-20 px-6">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <div className="text-center mb-14 max-w-2xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/4 text-[0.8rem] text-text-secondary mb-6 landing-fade-in">
              <Shield size={14} className="text-secondary" />
              Privacy Policy
            </div>
            <h1 className="text-[2.5rem] md:text-[3.25rem] font-extrabold leading-tight mb-4">
              <span className="text-gradient">Data Protection Policy</span>
            </h1>
            <p className="text-text-secondary text-[1.05rem] leading-relaxed">
              We design software around local execution and privacy boundaries. Read how we protect your visual logs.
            </p>
          </div>

          {/* Privacy Blocks */}
          <div className="flex flex-col gap-6 mb-12">
            <div className="glass-panel p-6 flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                <Eye size={18} />
              </div>
              <div>
                <h3 className="text-[1.1rem] font-bold mb-2">1. Local Video Execution (On-Device)</h3>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed">
                  Aura Watch AI edge daemons decode RTSP feeds and execute object detection models (YOLO + ByteTrack) locally on your physical server or gateway hardware. Raw feeds are never transmitted to our clouds, preventing external storage liabilities.
                </p>
              </div>
            </div>

            <div className="glass-panel p-6 flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center text-secondary shrink-0">
                <Lock size={18} />
              </div>
              <div>
                <h3 className="text-[1.1rem] font-bold mb-2">2. Encrypted Event Uploads</h3>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed">
                  When a verified event clip or re-identification (Re-ID) metric matches, the edge compiler compresses the segment and transmits it to your secure dashboard. All data transitions occur over TLS/HTTPS tunnels. Transmitted data is encrypted at rest using AES-256 protocols.
                </p>
              </div>
            </div>

            <div className="glass-panel p-6 flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                <RefreshCw size={18} />
              </div>
              <div>
                <h3 className="text-[1.1rem] font-bold mb-2">3. User Controls & Purging</h3>
                <p className="text-text-secondary text-[0.9rem] leading-relaxed">
                  You retain complete ownership of your data parameters. At any time via your organization panel, you can delete person profile vectors, purge historical event feeds, or toggle active tracking off. Local disk buffers utilize standard circular logs, automatically overwriting old directories after 7 days.
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-white/6 pt-8 text-[0.85rem] text-text-secondary leading-relaxed">
            <h4 className="font-bold text-text-primary mb-3">Questions & Contact</h4>
            <p className="mb-4">
              If you have any questions regarding data encryption thresholds or local storage matrices, please reach out to:
            </p>
            <div className="flex flex-col gap-2 font-medium">
              <span>{CONTACT.name}</span>
              <a href={`mailto:${CONTACT.email}`} className="text-secondary hover:underline">{CONTACT.email}</a>
              <a href={`tel:+91${CONTACT.phone}`} className="text-secondary hover:underline">+91 {CONTACT.phone}</a>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
