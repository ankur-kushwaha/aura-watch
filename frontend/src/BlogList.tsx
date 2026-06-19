import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Calendar, ArrowRight } from 'lucide-react';
import Header from './components/Header';
import Footer from './components/Footer';
import { BLOG_POSTS } from './blogData';

export default function BlogList() {
  useEffect(() => {
    document.title = 'Aura Watch AI Blog — AI Video Surveillance Insights';
    
    // Update description meta tag
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.setAttribute('name', 'description');
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute('content', 'Deep dives into multi-camera tracking, edge AI, computer vision, and the future of smart video surveillance.');

    // Update keywords meta tag
    let metaKey = document.querySelector('meta[name="keywords"]');
    if (!metaKey) {
      metaKey = document.createElement('meta');
      metaKey.setAttribute('name', 'keywords');
      document.head.appendChild(metaKey);
    }
    metaKey.setAttribute('content', 'multi-camera tracking, person re-identification, computer vision blog, Ask Camera AI, Edge AI security');

    // Update canonical link
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', 'https://aura-watch.adboardtools.com/blog');

    // Inject structured data
    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'Blog',
      'name': 'Aura Watch AI Blog',
      'url': 'https://aura-watch.adboardtools.com/blog',
      'description': 'Deep dives into multi-camera tracking, edge AI, computer vision, and the future of smart video surveillance.',
      'publisher': {
        '@type': 'Organization',
        'name': 'Aura Watch AI',
        'logo': {
          '@type': 'ImageObject',
          'url': 'https://aura-watch.adboardtools.com/favicon.svg'
        }
      }
    };
    
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.seo = 'blog-list';
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
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="text-center mb-16 max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/4 text-[0.8rem] text-text-secondary mb-6 landing-fade-in">
              <Sparkles size={14} className="text-secondary" />
              Latest Articles & Insights
            </div>
            <h1 className="text-[2.5rem] md:text-[3.5rem] font-extrabold leading-tight mb-6">
              <span className="text-gradient">Aura Watch AI Blog</span>
            </h1>
            <p className="text-text-secondary text-[1.05rem] md:text-[1.15rem] leading-relaxed">
              Deep dives into multi-camera person tracking, computer vision advancements, local edge compute optimization, and the future of automated spatial security.
            </p>
          </div>

          {/* Blogs Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {BLOG_POSTS.map((post, index) => (
              <article 
                key={post.slug} 
                className="glass-panel interactive p-6 flex flex-col gap-4 landing-fade-in"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[0.65rem] bg-secondary/10 text-secondary border border-secondary/25 px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                    {post.category}
                  </span>
                  <span className="text-[0.72rem] text-text-muted">{post.readTime}</span>
                </div>

                <div className="flex flex-col gap-2">
                  <h2 className="text-[1.2rem] font-bold text-text-primary line-clamp-2 hover:text-secondary transition-colors">
                    <Link to={`/blog/${post.slug}`}>{post.title}</Link>
                  </h2>
                  <p className="text-text-secondary text-[0.85rem] leading-relaxed line-clamp-3">
                    {post.excerpt}
                  </p>
                </div>

                <div className="mt-auto pt-4 border-t border-white/6 flex items-center justify-between text-[0.75rem]">
                  <div className="flex items-center gap-2 text-text-muted">
                    <Calendar size={12} />
                    <span>{post.date}</span>
                  </div>
                  <Link to={`/blog/${post.slug}`} className="flex items-center gap-1 text-primary hover:text-secondary font-semibold transition-colors">
                    Read Article
                    <ArrowRight size={12} />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
