import { cn } from "@/lib/utils";
import { formatDescriptionParagraphs, parseJobDescriptionSections } from "@/lib/jobDescription";

export function JobDescriptionPanel({
  description,
  className,
}: {
  description: string | null | undefined;
  className?: string;
}) {
  const sections = parseJobDescriptionSections(description);
  if (sections.length === 0) {
    return <p className="text-sm text-muted-foreground">No description available.</p>;
  }

  return (
    <div className={cn("space-y-5 break-words text-sm leading-7 text-foreground/90", className)}>
      {sections.map((section, index) => (
        <section key={`${section.title ?? "intro"}-${index}`} className="space-y-2">
          {section.title ? (
            <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-200/90">{section.title}</h4>
          ) : null}
          <div className="space-y-3">
            {formatDescriptionParagraphs(section.body).map((paragraph) => (
              <p
                key={`${index}-${paragraph.slice(0, 48)}`}
                className={cn(
                  paragraph.startsWith("•") && "border-l-2 border-border/60 pl-3 text-foreground/85",
                )}
              >
                {paragraph}
              </p>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
