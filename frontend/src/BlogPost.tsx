import { useEffect } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { ArrowLeft, Calendar, Clock, User } from 'lucide-react';
import Header from './components/Header';
import Footer from './components/Footer';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BLOG_POSTS } from './blogData';

export default function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const post = BLOG_POSTS.find((p) => p.slug === slug);

  useEffect(() => {
    if (!post) return;

    // Set page title
    document.title = `${post.seoTitle} — Aura Watch AI`;

    // Update meta description
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.setAttribute('name', 'description');
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute('content', post.seoDescription);

    // Update meta keywords
    let metaKey = document.querySelector('meta[name="keywords"]');
    if (!metaKey) {
      metaKey = document.createElement('meta');
      metaKey.setAttribute('name', 'keywords');
      document.head.appendChild(metaKey);
    }
    metaKey.setAttribute('content', post.keywords.join(', '));

    // Update canonical link
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', `https://aura-watch.adboardtools.com/blog/${post.slug}`);

    // Inject structured data
    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      'headline': post.title,
      'description': post.seoDescription,
      'datePublished': post.date,
      'author': {
        '@type': 'Person',
        'name': post.author,
      },
      'publisher': {
        '@type': 'Organization',
        'name': 'Aura Watch AI',
        'logo': {
          '@type': 'ImageObject',
          'url': 'https://aura-watch.adboardtools.com/favicon.svg',
        },
      },
      'mainEntityOfPage': {
        '@type': 'WebPage',
        '@id': `https://aura-watch.adboardtools.com/blog/${post.slug}`,
      },
    };

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.seo = `blog-post-${post.slug}`;
    script.textContent = JSON.stringify(structuredData);
    document.head.appendChild(script);

    // Scroll to top
    window.scrollTo(0, 0);

    return () => {
      script.remove();
    };
  }, [post]);

  if (!post) {
    return <Navigate to="/blog" replace />;
  }

  return (
    <div className="relative">
      {/* Nav */}
      <Header />

      {/* Main Container */}
      <main className="pt-32 pb-20 px-6">
        <article className="max-w-3xl mx-auto">
          {/* Back button */}
          <Link 
            to="/blog" 
            className="inline-flex items-center gap-2 text-[0.85rem] text-text-muted hover:text-secondary transition-colors mb-8"
          >
            <ArrowLeft size={14} />
            Back to Blog
          </Link>

          {/* Header Metadata */}
          <div className="flex items-center gap-3 mb-4">
            <span className="text-[0.65rem] bg-secondary/15 text-secondary border border-secondary/25 px-2.5 py-0.5 rounded font-bold uppercase tracking-wider">
              {post.category}
            </span>
            <span className="text-text-muted text-[0.8rem]">•</span>
            <span className="text-text-muted text-[0.8rem] flex items-center gap-1">
              <Clock size={12} />
              {post.readTime}
            </span>
          </div>

          <h1 className="text-[2.25rem] md:text-[3rem] font-extrabold leading-tight text-text-primary mb-6">
            {post.title}
          </h1>

          <div className="flex flex-wrap items-center gap-5 border-b border-white/6 pb-8 mb-8 text-[0.85rem] text-text-secondary">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-[0.7rem]">
                <User size={12} />
              </div>
              <span>{post.author}</span>
            </div>
            <span className="text-text-muted hidden sm:inline">|</span>
            <div className="flex items-center gap-2 text-text-muted">
              <Calendar size={13} />
              <span>{post.date}</span>
            </div>
          </div>

          {/* Markdown Content */}
          <div className="blog-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => <p className="mb-5 leading-relaxed text-text-secondary text-[1rem]">{children}</p>,
                strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
                em: ({ children }) => <em className="italic text-text-secondary">{children}</em>,
                ol: ({ children }) => <ol className="mb-5 list-decimal space-y-2 pl-5 text-text-secondary">{children}</ol>,
                ul: ({ children }) => <ul className="mb-5 list-disc space-y-2 pl-5 text-text-secondary">{children}</ul>,
                li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                h1: ({ children }) => <h2 className="text-[1.8rem] font-bold text-text-primary mt-10 mb-4 tracking-tight">{children}</h2>,
                h2: ({ children }) => <h3 className="text-[1.4rem] font-bold text-text-primary mt-8 mb-4 tracking-tight">{children}</h3>,
                h3: ({ children }) => <h4 className="text-[1.15rem] font-bold text-text-primary mt-6 mb-3 tracking-tight">{children}</h4>,
                code: ({ children }) => (
                  <code className="rounded bg-[rgba(255,255,255,0.06)] px-1.5 py-0.5 font-mono text-[0.85em] text-secondary border border-white/5">
                    {children}
                  </code>
                ),
                pre: ({ children }) => (
                  <pre className="mb-6 overflow-x-auto rounded-xl border border-white/8 bg-black/30 p-4 text-[0.85rem] font-mono text-text-primary leading-relaxed">
                    {children}
                  </pre>
                ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-secondary underline decoration-secondary/35 hover:text-[#67e8f9] transition-colors"
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {post.content}
            </ReactMarkdown>
          </div>
        </article>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
