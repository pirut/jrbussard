import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/* Its own chunk: the markdown stack only loads when someone opens a note. */
export default function Markdown({ children }) {
    return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>;
}
