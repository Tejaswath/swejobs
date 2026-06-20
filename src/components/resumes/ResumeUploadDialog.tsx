import { useRef, useState, type ChangeEvent } from "react";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/errors";
import { deriveResumeLabel, uploadResumeVersion } from "@/lib/resumes";

type ResumeUploadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  makeDefault: boolean;
  onUploaded: (resume: { id: string; label: string; parsed_text: string | null }) => void | Promise<void>;
};

export function ResumeUploadDialog({
  open,
  onOpenChange,
  userId,
  makeDefault,
  onUploaded,
}: ResumeUploadDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploading(true);
    try {
      const resume = await uploadResumeVersion({
        supabase,
        userId,
        file,
        label: deriveResumeLabel(file.name),
        isDefault: makeDefault,
      });
      await onUploaded(resume);
      toast({
        title: "Résumé ready",
        description: resume.parsed_text
          ? "Your fit summary now uses this résumé."
          : "The PDF was saved, but text extraction was limited.",
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not upload résumé",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a résumé</DialogTitle>
          <DialogDescription>
            Upload a PDF to calculate per-job skill matches without leaving Explore. PDF only, 3 MB maximum.
          </DialogDescription>
        </DialogHeader>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={handleFile}
        />
        <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 p-8 text-center">
          <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Choose your résumé PDF</p>
          <p className="mt-1 text-xs text-muted-foreground">
            SweJobs extracts text locally, stores the PDF securely, and uses the text for fit analysis.
          </p>
          <Button
            className="mt-4 gap-2"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
          >
            <Upload className="h-4 w-4" />
            {isUploading ? "Uploading and analyzing…" : "Choose PDF"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
