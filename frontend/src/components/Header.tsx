import { Link, useLocation } from 'react-router-dom';
import { Cpu, ArrowRight } from 'lucide-react';

export default function Header() {
  const location = useLocation();
  const isBlogActive = location.pathname.startsWith('/blog');
  const isAboutActive = location.pathname === '/about';
  const isContactActive = location.pathname === '/contact';

  return (
    <header className="fixed top-0 inset-x-0 z-50 border-b border-white/6 bg-[rgba(10,14,26,0.72)] backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
          <div className="bg-primary p-2 rounded-lg shadow-[0_0_15px_rgba(124,58,237,0.25)]">
            <Cpu size={20} color="white" />
          </div>
          <span className="font-heading font-bold text-[1.05rem] tracking-tight">AURA WATCH AI</span>
        </Link>

        <nav className="hidden md:flex items-center gap-7 text-[0.875rem] text-text-secondary" aria-label="Primary">
          <Link to="/#tracking" className="hover:text-text-primary transition-colors">
            Tracking
          </Link>
          <Link to="/#monitoring" className="hover:text-text-primary transition-colors">
            Monitoring
          </Link>
          <Link to="/#ask-ai" className="hover:text-text-primary transition-colors">
            Ask Camera AI
          </Link>
          <Link 
            to="/blog" 
            className={`hover:text-text-primary transition-colors ${isBlogActive ? 'text-text-primary font-medium' : ''}`}
          >
            Blog
          </Link>
          <Link 
            to="/about" 
            className={`hover:text-text-primary transition-colors ${isAboutActive ? 'text-text-primary font-medium' : ''}`}
          >
            About
          </Link>
          <Link 
            to="/contact" 
            className={`hover:text-text-primary transition-colors ${isContactActive ? 'text-text-primary font-medium' : ''}`}
          >
            Contact
          </Link>
        </nav>

        <Link to="/login" className="btn btn-primary text-[0.875rem] py-2 px-4">
          Sign In
          <ArrowRight size={15} />
        </Link>
      </div>
    </header>
  );
}
