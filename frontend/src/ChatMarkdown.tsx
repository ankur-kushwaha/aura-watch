import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
          em: ({ children }) => <em className="italic text-text-secondary">{children}</em>,
          ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>,
          ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>,
          li: ({ children }) => <li className="leading-[1.5]">{children}</li>,
          h1: ({ children }) => <h3 className="mb-1.5 text-[0.95rem] font-semibold text-text-primary">{children}</h3>,
          h2: ({ children }) => <h4 className="mb-1.5 text-[0.9rem] font-semibold text-text-primary">{children}</h4>,
          h3: ({ children }) => <h5 className="mb-1 text-[0.85rem] font-semibold text-text-primary">{children}</h5>,
          code: ({ children }) => (
            <code className="rounded bg-[rgba(255,255,255,0.08)] px-1 py-0.5 font-mono text-[0.8em] text-secondary">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="mb-2 overflow-x-auto rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.25)] p-2.5 text-[0.8rem]">
              {children}
            </pre>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-secondary underline decoration-secondary/40 underline-offset-2 hover:text-[#67e8f9]"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
