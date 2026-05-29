"use client";

import type { SourceDocument } from "@/lib/graph/queries";
import { DocumentStatusCard } from "./document-status-card";

export function DocumentList({
  documents,
}: {
  documents: SourceDocument[];
}) {
  if (documents.length === 0) {
    return (
      <p className="text-xs text-neutral-500">
        No documents yet. Upload a .txt, .md, .pdf, or .docx file to add it
        to your graph.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {documents.map((doc) => (
        <li key={doc.id}>
          <DocumentStatusCard document={doc} />
        </li>
      ))}
    </ul>
  );
}
