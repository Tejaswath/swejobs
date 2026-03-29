import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables } from "@/integrations/supabase/types";
import { toDisplayError } from "@/lib/errors";

export const RESUME_BUCKET = "resume-files";
export const MAX_RESUME_FILE_BYTES = 3 * 1024 * 1024;
export const RESUME_ALLOWED_MIME_TYPES = ["application/pdf"];
export const MAX_RESUMES_PER_USER = 10;

export type ResumeVersionRow = Tables<"resume_versions">;

type UploadResumeParams = {
  supabase: SupabaseClient<Database>;
  userId: string;
  file: File;
  label?: string;
  targetRole?: string;
  notes?: string;
  isDefault: boolean;
  extractText?: boolean;
};

function cleanWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function deriveResumeLabel(fileName: string) {
  return cleanWhitespace(fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " "));
}

export function sanitizeResumeFileName(fileName: string) {
  const cleaned = fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "resume.pdf";
}

export function validateResumeFile(file: File) {
  const isPdfMime = file.type === "application/pdf";
  const looksLikePdf = file.name.toLowerCase().endsWith(".pdf");

  if (!isPdfMime && !looksLikePdf) {
    return "Only PDF resumes are supported.";
  }

  if (file.size > MAX_RESUME_FILE_BYTES) {
    return "Resume PDFs must be 3 MB or smaller.";
  }

  return null;
}

export function formatResumeFileSize(bytes: number | null | undefined) {
  if (!bytes || bytes <= 0) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function extractPdfText(file: File) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfWorker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker.default;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    pages.push(cleanWhitespace(pageText));
  }

  return cleanWhitespace(pages.join("\n"));
}

export async function uploadResumeVersion({
  supabase,
  userId,
  file,
  label,
  targetRole = "",
  notes = "",
  isDefault,
  extractText = true,
}: UploadResumeParams) {
  const validationError = validateResumeFile(file);
  if (validationError) {
    throw new Error(validationError);
  }

  const { count: resumeCount, error: countError } = await supabase
    .from("resume_versions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (countError) throw toDisplayError(countError, "Could not validate resume upload limit.");
  if ((resumeCount ?? 0) >= MAX_RESUMES_PER_USER) {
    throw new Error(`Resume limit reached (${MAX_RESUMES_PER_USER}). Delete an older resume before uploading a new one.`);
  }

  const resumeId = crypto.randomUUID();
  const normalizedFileName = sanitizeResumeFileName(file.name);
  const storagePath = `${userId}/${resumeId}-${normalizedFileName}`;

  let parsedText = "";
  if (extractText) {
    try {
      parsedText = await extractPdfText(file);
    } catch {
      parsedText = "";
    }
  }

  if (isDefault) {
    const { error: defaultError } = await supabase
      .from("resume_versions")
      .update({ is_default: false })
      .eq("user_id", userId)
      .eq("is_default", true);

    if (defaultError) throw toDisplayError(defaultError, "Could not update the default resume.");
  }

  const { error: uploadError } = await supabase.storage.from(RESUME_BUCKET).upload(storagePath, file, {
    cacheControl: "3600",
    contentType: "application/pdf",
    upsert: false,
  });

  if (uploadError) throw toDisplayError(uploadError, "Could not upload the PDF to storage.");

  const { data, error } = await supabase
    .from("resume_versions")
    .insert({
      id: resumeId,
      user_id: userId,
      label: cleanWhitespace(label || deriveResumeLabel(file.name)),
      target_role: targetRole.trim(),
      notes: notes.trim(),
      is_default: isDefault,
      storage_path: storagePath,
      file_name: file.name,
      file_size_bytes: file.size,
      mime_type: "application/pdf",
      parsed_text: parsedText || null,
      text_extracted_at: parsedText ? new Date().toISOString() : null,
    })
    .select(
      "id, user_id, label, target_role, notes, is_default, storage_path, file_name, file_size_bytes, mime_type, " +
        "text_extracted_at, created_at, updated_at",
    )
    .single();

  if (error) {
    await supabase.storage.from(RESUME_BUCKET).remove([storagePath]);
    throw toDisplayError(error, "Could not save resume metadata.");
  }

  return data;
}

export async function deleteResumeVersion(
  supabase: SupabaseClient<Database>,
  resumeVersion: ResumeVersionRow,
) {
  if (resumeVersion.storage_path) {
    const { error: storageError } = await supabase.storage.from(RESUME_BUCKET).remove([resumeVersion.storage_path]);
    if (storageError) throw toDisplayError(storageError, "Could not delete the stored PDF.");
  }

  const { error } = await supabase.from("resume_versions").delete().eq("id", resumeVersion.id);
  if (error) throw toDisplayError(error, "Could not delete the resume record.");
}

export async function openResumeDownload(
  supabase: SupabaseClient<Database>,
  resumeVersion: ResumeVersionRow,
) {
  if (!resumeVersion.storage_path) {
    throw new Error("This resume does not have an uploaded PDF yet.");
  }

  const { data, error } = await supabase.storage.from(RESUME_BUCKET).createSignedUrl(resumeVersion.storage_path, 60);
  if (error) throw toDisplayError(error, "Could not create a download link for this resume.");

  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}
