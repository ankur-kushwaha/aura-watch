import { Link } from 'react-router-dom';
import { Cpu, ArrowRight } from 'lucide-react';
import { CONTACT } from '../constants';

export default function Footer() {
  return (
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
                <Link to="/#tracking" className="hover:text-text-primary transition-colors">
                  Person Tracking
                </Link>
              </li>
              <li>
                <Link to="/#monitoring" className="hover:text-text-primary transition-colors">
                  Active monitoring using AI
                </Link>
              </li>
              <li>
                <Link to="/#ask-ai" className="hover:text-text-primary transition-colors">
                  Ask Camera AI
                </Link>
              </li>
              <li>
                <Link to="/blog" className="hover:text-text-primary transition-colors">
                  Blog Articles
                </Link>
              </li>
              <li>
                <Link to="/tutorials" className="hover:text-text-primary transition-colors">
                  Tutorials
                </Link>
              </li>
              <li>
                <Link to="/about" className="hover:text-text-primary transition-colors">
                  About Us
                </Link>
              </li>
              <li>
                <Link to="/pricing" className="hover:text-text-primary transition-colors">
                  Pricing
                </Link>
              </li>
              <li>
                <Link to="/#faq" className="hover:text-text-primary transition-colors">
                  FAQ
                </Link>
              </li>
              <li>
                <Link to="/contact" className="hover:text-text-primary transition-colors">
                  Contact Us
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="hover:text-text-primary transition-colors">
                  Privacy Policy
                </Link>
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
                {CONTACT.email}
              </a>
              <a
                href={`tel:+91${CONTACT.phone}`}
                className="flex items-center gap-2 text-text-muted hover:text-secondary transition-colors"
              >
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
            <Link to="/login" className="btn btn-primary text-[0.85rem] py-2 px-4">
              Sign In
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>

        <div className="pt-8 border-t border-white/6 flex flex-col sm:flex-row items-center justify-between gap-3 text-[0.8rem] text-text-muted">
          <span>&copy; {new Date().getFullYear()} Aura Watch AI. All rights reserved.</span>
          <span>Built by {CONTACT.name}</span>
        </div>
      </div>
    </footer>
  );
}
