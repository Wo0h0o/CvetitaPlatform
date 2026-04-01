"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const components: Components = {
  h2: ({ children }) => {
    const text = String(children);
    if (text.startsWith("▶") || text.startsWith("→")) {
      return <h2 className="font-bold text-[15px] text-accent mt-5 mb-2 flex items-center gap-2">{children}</h2>;
    }
    return <h2 className="font-bold text-[15px] text-text mt-5 mb-1.5 border-b border-border pb-1">{children}</h2>;
  },
  h3: ({ children }) => (
    <h3 className="font-semibold text-[14px] text-text mt-3 mb-1">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="font-semibold text-[13px] text-text mt-2 mb-1">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="py-0.5">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }) => (
    <em>{children}</em>
  ),
  ul: ({ children }) => (
    <ul className="space-y-0.5 pl-2">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="space-y-0.5 pl-2">{children}</ol>
  ),
  li: ({ children, ...props }) => {
    const isOrdered = (props as { node?: { parentNode?: { tagName?: string } } }).node?.parentNode?.tagName === "ol";
    return (
      <li className="flex gap-2 py-0.5">
        <span className={`mt-1 flex-shrink-0 text-[10px] ${isOrdered ? "text-accent font-bold text-[12px]" : "text-accent"}`}>
          {isOrdered ? "" : "●"}
        </span>
        <span className="flex-1">{children}</span>
      </li>
    );
  },
  hr: () => <div className="h-2" />,
  // Tables
  table: ({ children }) => (
    <div className="overflow-x-auto -mx-1 my-3">
      <table className="w-full text-[13px] border-collapse">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-surface-2">
      {children}
    </thead>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-border">
      {children}
    </tbody>
  ),
  tr: ({ children }) => (
    <tr className="hover:bg-surface-2/50 transition-colors">
      {children}
    </tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-3 border-b border-border">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-[13px] text-text border-b border-border/50">
      {children}
    </td>
  ),
  // Code blocks
  code: ({ children, className }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <div className="my-2 rounded-lg bg-surface-2 overflow-x-auto">
          <pre className="p-3 text-[12px] text-text-2 font-mono leading-relaxed">
            <code>{children}</code>
          </pre>
        </div>
      );
    }
    return (
      <code className="px-1.5 py-0.5 rounded bg-surface-2 text-[12px] font-mono text-accent">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>,
  // Links
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
      {children}
    </a>
  ),
  // Blockquotes
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-accent/30 pl-3 my-2 text-text-2 italic">
      {children}
    </blockquote>
  ),
};

export function Markdown({ text, accentColor }: { text: string; accentColor?: string }) {
  // Allow overriding accent color class in components via CSS variable
  return (
    <div className={`space-y-0.5 text-[14px] leading-relaxed text-text ${accentColor || ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
