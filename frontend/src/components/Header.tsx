import { Link, useLocation } from 'react-router-dom';
import { Shield } from 'lucide-react';

export default function Header() {
  const location = useLocation();
  const isAboutActive = location.pathname === '/about';
  const isContactActive = location.pathname === '/contact';
  const isPricingActive = location.pathname === '/pricing';
  const isTutorialsActive = location.pathname.startsWith('/tutorials');

  return (
    <header className="fixed top-0 inset-x-0 z-50 border-b border-white/6 bg-[rgba(10,14,26,0.72)] backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
          <div className="bg-primary/10 border border-primary/30 p-1.5 rounded-lg text-primary shadow-[0_0_15px_rgba(124,58,237,0.15)]">
            <Shield size={18} className="fill-primary/10" />
          </div>
          <div className="flex flex-col">
            <span className="font-heading font-extrabold text-[0.95rem] tracking-wider text-white leading-none">AURA-WATCH</span>
            <span className="text-[0.6rem] text-text-muted font-medium tracking-wider mt-0.5 uppercase">AI Surveillance Agent</span>
          </div>
        </Link>
 
        <nav className="hidden md:flex items-center gap-7 text-[0.85rem] font-medium text-text-secondary" aria-label="Primary">
          <Link to="/#capabilities" className="hover:text-text-primary transition-colors">
            Features
          </Link>
          <Link to="/#use-cases" className="hover:text-text-primary transition-colors">
            Use Cases
          </Link>
          <Link to="/#how-it-works" className="hover:text-text-primary transition-colors">
            How It Works
          </Link>
          <Link
            to="/pricing"
            className={`hover:text-text-primary transition-colors ${isPricingActive ? 'text-text-primary font-medium' : ''}`}
          >
            Pricing
          </Link>
          <Link
            to="/about"
            className={`hover:text-text-primary transition-colors ${isAboutActive ? 'text-text-primary font-medium' : ''}`}
          >
            About Us
          </Link>
          <Link
            to="/tutorials"
            className={`hover:text-text-primary transition-colors ${isTutorialsActive ? 'text-text-primary font-medium' : ''}`}
          >
            Tutorials
          </Link>
          <Link
            to="/contact"
            className={`hover:text-text-primary transition-colors ${isContactActive ? 'text-text-primary font-medium' : ''}`}
          >
            Contact
          </Link>
        </nav>
        <div>
          <Link to="/contact" className="btn btn-primary text-[0.825rem] py-1.5 px-4 font-semibold tracking-wide shadow-[0_0_15px_rgba(6,182,212,0.1)]">
            Request a Demo
          </Link>
          &nbsp;
          &nbsp;
          <Link to="/login" className="btn btn-primary text-[0.825rem] py-1.5 px-4 font-semibold tracking-wide shadow-[0_0_15px_rgba(6,182,212,0.1)]">
            Sign in
          </Link></div>
      </div>
    </header>
  );
}
