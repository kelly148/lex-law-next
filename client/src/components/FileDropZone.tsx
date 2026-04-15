import { useState, useRef, useCallback, useEffect } from "react";
import { FileText, CheckCircle2, X } from "lucide-react";

const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".doc", ".txt", ".rtf"];

const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "application/rtf",
  "text/rtf",
];

export interface ExistingFile {
  id: number;
  fileName: string;
  fileUrl: string;
  fileSize?: number;
}

interface FileDropZoneProps {
  onFilesChange: (files: File[]) => void;
  existingFiles?: ExistingFile[];
}

export default function FileDropZone({ onFilesChange, existingFiles = [] }: FileDropZoneProps) {
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isRejected, setIsRejected] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Notify parent of pending file changes
  useEffect(() => {
    onFilesChange(pendingFiles);
  }, [pendingFiles, onFilesChange]);

  const isValidFile = (file: File): boolean => {
    return (
      ACCEPTED_MIME_TYPES.includes(file.type) ||
      ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))
    );
  };

  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const files = Array.from(fileList);
    const valid = files.filter(isValidFile);
    const invalid = files.filter((f) => !isValidFile(f));

    if (invalid.length > 0) {
      setIsRejected(true);
      setTimeout(() => setIsRejected(false), 2000);
    }

    setPendingFiles((prev) => {
      const existingNames = new Set(prev.map((f) => f.name));
      const deduplicated = valid.filter((f) => !existingNames.has(f.name));
      return [...prev, ...deduplicated];
    });
  }, []);

  const removeFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Drag handlers with counter to prevent child-element flicker
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    setIsDragOver(true);
    setIsRejected(false);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragOver(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragOver(false);

    // Check if any dropped file is invalid
    const files = Array.from(e.dataTransfer.files);
    const hasInvalid = files.some((f) => !isValidFile(f));
    if (hasInvalid && files.every((f) => !isValidFile(f))) {
      setIsRejected(true);
      setTimeout(() => setIsRejected(false), 2000);
      return;
    }

    addFiles(e.dataTransfer.files);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  };

  const onClick = () => fileInputRef.current?.click();

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files);
    e.target.value = "";
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={onClick}
        onKeyDown={onKeyDown}
        className={[
          "border-2 border-dashed rounded-lg p-8 text-center",
          "cursor-pointer transition-all duration-200",
          "focus:outline-none focus:ring-2 focus:ring-[#2E75B6] focus:ring-offset-2",
          isRejected
            ? "border-red-500 bg-red-50"
            : isDragOver
            ? "border-[#2E75B6] bg-blue-50"
            : "border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100",
        ].join(" ")}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(",")}
          onChange={onFileSelect}
          className="hidden"
        />

        {isRejected ? (
          <div className="space-y-1">
            <p className="text-red-600 font-medium text-sm">File type not accepted</p>
            <p className="text-red-400 text-xs">Accepted: {ACCEPTED_EXTENSIONS.join(", ")}</p>
          </div>
        ) : isDragOver ? (
          <p className="text-[#2E75B6] font-medium text-sm">Drop files to upload</p>
        ) : (
          <div className="space-y-1">
            <FileText className="h-8 w-8 mx-auto text-gray-400 mb-2" />
            <p className="text-gray-600 text-sm font-medium">Drag and drop files here</p>
            <p className="text-gray-400 text-sm">or click to browse</p>
            <p className="text-gray-400 text-xs mt-2">
              Accepted: {ACCEPTED_EXTENSIONS.join(", ")}
            </p>
          </div>
        )}
      </div>

      {/* Selected files (pending — not yet uploaded) */}
      {pendingFiles.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-600">
            Selected files ({pendingFiles.length}):
          </p>
          <div className="space-y-1">
            {pendingFiles.map((file, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-sm bg-white border rounded px-3 py-1.5"
              >
                <FileText className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                <span className="flex-1 truncate">{file.name}</span>
                <span className="text-gray-400 text-xs flex-shrink-0">
                  {formatSize(file.size)}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(i);
                  }}
                  className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0 ml-1"
                  title="Remove from selection"
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Previously uploaded (already on server) */}
      {existingFiles.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-600">Previously uploaded:</p>
          <div className="space-y-1">
            {existingFiles.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-2 text-sm bg-green-50 border border-green-200 rounded px-3 py-1.5"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                <span className="flex-1 truncate text-green-800">{file.fileName}</span>
                {file.fileSize != null && (
                  <span className="text-green-600 text-xs flex-shrink-0">
                    {formatSize(file.fileSize)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
