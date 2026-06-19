import React, { useState, useEffect } from 'react';
import { Sparkles, Mail, Phone, MapPin, CheckCircle, Send } from 'lucide-react';
import Header from './components/Header';
import Footer from './components/Footer';
import { CONTACT } from './constants';


export default function ContactPage() {
  const [formData, setFormData] = useState({ name: '', email: '', subject: '', message: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.message) return;

    setIsSubmitting(true);
    // Simulate API request delay
    setTimeout(() => {
      setIsSubmitting(false);
      setIsSubmitted(true);
      setFormData({ name: '', email: '', subject: '', message: '' });
    }, 1200);
  };

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

          <div className="grid md:grid-cols-5 gap-8 items-start">
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
                    New Delhi, India
                  </span>
                </div>
              </div>
            </div>

            {/* Contact Form */}
            <div className="md:col-span-3">
              <div className="glass-panel p-8">
                {isSubmitted ? (
                  <div className="text-center py-10 flex flex-col items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-success/15 border border-success/30 flex items-center justify-center text-success mb-2">
                      <CheckCircle size={32} />
                    </div>
                    <h3 className="text-[1.35rem] font-bold text-text-primary">Message Sent Successfully!</h3>
                    <p className="text-text-secondary text-[0.9rem] max-w-sm leading-relaxed">
                      Thank you for reaching out. Ankur will review your query and respond shortly.
                    </p>
                    <button 
                      onClick={() => setIsSubmitted(false)}
                      className="btn btn-secondary text-[0.85rem] mt-4 py-2 px-5"
                    >
                      Send Another Message
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                    <h3 className="text-[1.25rem] font-bold mb-2">Send Message</h3>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="name" className="text-[0.75rem] text-text-secondary font-semibold uppercase tracking-wider pl-1">Your Name *</label>
                        <input 
                          type="text" 
                          id="name"
                          name="name"
                          required
                          value={formData.name}
                          onChange={handleInputChange}
                          placeholder="Ankur Kushwaha"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="email" className="text-[0.75rem] text-text-secondary font-semibold uppercase tracking-wider pl-1">Email Address *</label>
                        <input 
                          type="email" 
                          id="email"
                          name="email"
                          required
                          value={formData.email}
                          onChange={handleInputChange}
                          placeholder="ankur.kus1@gmail.com"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="subject" className="text-[0.75rem] text-text-secondary font-semibold uppercase tracking-wider pl-1">Subject</label>
                      <input 
                        type="text" 
                        id="subject"
                        name="subject"
                        value={formData.subject}
                        onChange={handleInputChange}
                        placeholder="Licensing queries / General integration"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="message" className="text-[0.75rem] text-text-secondary font-semibold uppercase tracking-wider pl-1">Your Message *</label>
                      <textarea 
                        id="message"
                        name="message"
                        required
                        rows={5}
                        value={formData.message}
                        onChange={handleInputChange}
                        placeholder="Detail how we can help you configure your multi-camera setups..."
                        className="resize-none"
                      />
                    </div>

                    <button 
                      type="submit" 
                      disabled={isSubmitting}
                      className="btn btn-primary mt-2 py-3 w-full font-semibold"
                    >
                      {isSubmitting ? 'Sending Message...' : 'Send Message'}
                      <Send size={15} />
                    </button>
                  </form>
                )}
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
