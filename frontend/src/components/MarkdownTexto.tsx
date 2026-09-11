import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function textoSimples(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function MarkdownTexto({ texto }: { texto: string }) {
  return (
    <div className="text-[13.5px] leading-relaxed text-muted">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h2 className="mb-2 mt-5 text-[15px] font-extrabold text-fg first:mt-0">{children}</h2>
          ),
          h2: ({ children }) => (
            <h3 className="mb-1.5 mt-4 text-[13.5px] font-extrabold text-fg first:mt-0">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="mb-1 mt-3 text-[13px] font-bold text-fg first:mt-0">{children}</h4>
          ),
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-bold text-fg">{children}</strong>,
          ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          hr: () => <hr className="my-4 border-border" />,
          code: ({ children }) => (
            <code className="rounded bg-black/5 px-1 py-0.5 text-[12.5px]">{children}</code>
          ),
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-accent underline">
              {children}
            </a>
          ),
        }}
      >
        {texto}
      </ReactMarkdown>
    </div>
  );
}
