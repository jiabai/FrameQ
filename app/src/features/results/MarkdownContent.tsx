import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { safeArticleUrl } from "../../articleExtraction/safeUrl";

type MarkdownContentProps = {
  markdown: string;
  emptyText: string;
};

export function MarkdownContent({ markdown, emptyText }: MarkdownContentProps) {
  const content = markdown.trim();

  if (!content) {
    return <p className="markdown-empty">{emptyText}</p>;
  }

  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        skipHtml
        components={{
          img: ({ alt }) => <span>{alt ?? ""}</span>,
          a: ({ href, children }) => {
            let safe: string | null = null;
            try { if (href) safe = safeArticleUrl(href); } catch { safe = null; }
            return safe ? <a href={safe} onClick={(event) => { event.preventDefault(); void openUrl(safe!); }}>{children}</a> : <span>{children}</span>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
