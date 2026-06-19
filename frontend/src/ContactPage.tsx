import { Mail, MapPin, Phone, Sparkles } from 'lucide-react';
import { useEffect } from 'react';
import Footer from './components/Footer';
import Header from './components/Header';
import { CONTACT } from './constants';


export default function ContactPage() {

  useEffect(() => {
    document.title = 'Contact Us — Aura Watch AI';

    // Update meta description
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.setAttribute('name', 'description');
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute('content', 'Get in touch with Aura Watch AI. Contact developer Ankur Kushwaha for support, integration queries, or commercial licenses.');

    // Update keywords
    let metaKey = document.querySelector('meta[name="keywords"]');
    if (!metaKey) {
      metaKey = document.createElement('meta');
      metaKey.setAttribute('name', 'keywords');
      document.head.appendChild(metaKey);
    }
    metaKey.setAttribute('content', 'contact aura watch, support, integrations, camera AI license, Ankur Kushwaha email');

    // Update canonical link
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', 'https://aura-watch.adboardtools.com/contact');

    // Inject structured data
    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'ContactPage',
      'name': 'Contact Aura Watch AI',
      'description': 'Get in touch with Aura Watch AI. Contact developer Ankur Kushwaha for support, integration queries, or commercial licenses.',
      'url': 'https://aura-watch.adboardtools.com/contact',
      'contactPoint': {
        '@type': 'ContactPoint',
        'contactType': 'customer support',
        'email': CONTACT.email,
        'telephone': `+91-${CONTACT.phone}`
      }
    };

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.seo = 'contact-page';
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
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="text-center mb-14 max-w-2xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/4 text-[0.8rem] text-text-secondary mb-6 landing-fade-in">
              <Sparkles size={14} className="text-secondary" />
              Contact Support & Sales
            </div>
            <h1 className="text-[2.5rem] md:text-[3.25rem] font-extrabold leading-tight mb-4">
              <span className="text-gradient">Get In Touch</span>
            </h1>
            <p className="text-text-secondary text-[1.05rem] leading-relaxed">
              Have questions about deploying edge agents, custom re-identification parameters, or commercial fleet licensing? We are here to help.
            </p>
          </div>

          <div className="grid md:grid-cols-1 gap-8 items-start">
            {/* Contact Info */}
            <div className="md:col-span-2 flex flex-col gap-5">
              <div className="glass-panel p-6 flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                  <Mail size={18} />
                </div>
                <div>
                  <h4 className="text-[0.95rem] font-bold mb-1">Email Us</h4>
                  <a href={`mailto:${CONTACT.email}`} className="text-text-secondary text-[0.85rem] hover:text-secondary transition-colors">
                    {CONTACT.email}
                  </a>
                  <p className="text-[0.72rem] text-text-muted mt-1">Average response: &lt; 12 hours</p>
                </div>
              </div>

              <div className="glass-panel p-6 flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center text-secondary shrink-0">
                  <Phone size={18} />
                </div>
                <div>
                  <h4 className="text-[0.95rem] font-bold mb-1">Call Us</h4>
                  <a href={`tel:+91${CONTACT.phone}`} className="text-text-secondary text-[0.85rem] hover:text-secondary transition-colors">
                    +91 {CONTACT.phone}
                  </a>
                  <p className="text-[0.72rem] text-text-muted mt-1">Mon-Fri: 9 AM - 6 PM IST</p>
                </div>
              </div>

              <div className="glass-panel p-6 flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                  <MapPin size={18} />
                </div>
                <div>
                  <h4 className="text-[0.95rem] font-bold mb-1">Location</h4>
                  <span className="text-text-secondary text-[0.85rem]">
                    Gurugram, India
                  </span>
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
