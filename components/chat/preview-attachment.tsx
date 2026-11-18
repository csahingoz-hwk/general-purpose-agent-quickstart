import Image from "next/image";
import type { Attachment } from "@/lib/types";
import { Spinner } from "../ui/spinner";
import { CrossSmallIcon } from "./icons";

function badgeLabelForType(contentType?: string, name?: string): string {
  if (
    contentType === "application/pdf" ||
    name?.toLowerCase().endsWith(".pdf")
  ) {
    return "PDF";
  }
  if (contentType === "text/csv" || name?.toLowerCase().endsWith(".csv")) {
    return "CSV";
  }
  return "FILE";
}

export const PreviewAttachment = ({
  attachment,
  isUploading = false,
  onRemove,
}: {
  attachment: Attachment;
  isUploading?: boolean;
  onRemove?: () => void;
}) => {
  const { name, url, contentType } = attachment;
  const isPrivateProxy = url.includes("/api/files/");

  return (
    <div
      className="group relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-border/40 bg-muted"
      data-testid="input-attachment-preview"
    >
      {contentType?.startsWith("image") && url ? (
        <Image
          alt={name ?? "attachment"}
          className="size-full object-cover"
          height={96}
          src={url}
          unoptimized={isPrivateProxy}
          width={96}
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center">
          <span className="rounded bg-foreground/10 px-1.5 py-0.5 font-semibold text-[10px] text-foreground tracking-wide">
            {badgeLabelForType(contentType, name)}
          </span>
          <span className="line-clamp-2 w-full break-all text-[11px] text-muted-foreground leading-tight">
            {name || "File"}
          </span>
        </div>
      )}

      {isUploading && (
        <div
          className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 backdrop-blur-sm"
          data-testid="input-attachment-loader"
        >
          <Spinner className="size-5" />
        </div>
      )}

      {onRemove && !isUploading && (
        <button
          aria-label="Remove attachment"
          className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-black/60 text-white opacity-100 backdrop-blur-sm transition-opacity hover:bg-black/80 md:opacity-0 md:group-hover:opacity-100"
          onClick={onRemove}
          type="button"
        >
          <CrossSmallIcon size={10} />
        </button>
      )}
    </div>
  );
};
