"use client"

import { useUpload, type UploadEntry } from "@/contexts/upload-context"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
    CheckCircle2,
    AlertCircle,
    ChevronDown,
    ChevronUp,
    Trash2,
    Loader2,
    FileIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

function formatSize(bytes: number): string {
    if (bytes === 0) return "0 B"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

function UploadRow({ entry }: { entry: UploadEntry }) {
    return (
        <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border last:border-0">
            {/* Status icon */}
            <div className="shrink-0">
                {entry.status === "uploading" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                {entry.status === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                {entry.status === "error" && <AlertCircle className="h-4 w-4 text-destructive" />}
                {entry.status === "pending" && <FileIcon className="h-4 w-4 text-muted-foreground" />}
            </div>

            {/* File info */}
            <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-card-foreground truncate">{entry.fileName}</p>
                <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-[10px] text-muted-foreground">{formatSize(entry.fileSize)}</p>
                    {entry.status === "error" && entry.error && (
                        <p className="text-[10px] text-destructive truncate">{entry.error}</p>
                    )}
                </div>
                {entry.status === "uploading" && (
                    <Progress value={entry.progress} className="h-1 mt-1" />
                )}
            </div>
        </div>
    )
}

export function UploadManager() {
    const { uploads, isMinimized, setIsMinimized, clearCompleted, totalActive } = useUpload()

    // Don't render if no uploads ever happened
    if (uploads.length === 0) return null

    const completedCount = uploads.filter(u => u.status === "done").length
    const errorCount = uploads.filter(u => u.status === "error").length

    return (
        <div className={cn(
            "fixed bottom-4 right-4 z-50 w-[340px] max-w-[calc(100vw-2rem)]",
            "bg-card border border-border rounded-xl shadow-2xl shadow-black/20",
            "transition-all duration-300",
        )}>
            {/* Header — always visible */}
            <div
                className="flex items-center justify-between px-3 py-2.5 cursor-pointer select-none border-b border-border"
                onClick={() => setIsMinimized(!isMinimized)}
            >
                <div className="flex items-center gap-2.5">
                    <div className={cn(
                        "h-7 w-7 rounded-lg flex items-center justify-center shrink-0",
                        totalActive > 0 ? "bg-primary/15" : "bg-emerald-500/15"
                    )}>
                        {totalActive > 0 ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                        )}
                    </div>
                    <div>
                        <p className="text-xs font-semibold text-card-foreground leading-tight">
                            {totalActive > 0
                                ? `Uploading ${totalActive} item${totalActive > 1 ? "s" : ""}...`
                                : "Uploads complete"
                            }
                        </p>
                        <p className="text-[10px] text-muted-foreground leading-tight">
                            {completedCount > 0 && `${completedCount} done`}
                            {errorCount > 0 && `${completedCount > 0 ? " · " : ""}${errorCount} failed`}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-1">
                    {totalActive === 0 && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={(e) => { e.stopPropagation(); clearCompleted() }}
                            title="Clear all"
                        >
                            <Trash2 className="h-3 w-3" />
                        </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-6 w-6">
                        {isMinimized ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </Button>
                </div>
            </div>

            {/* Upload list — collapsible */}
            {!isMinimized && (
                <div className="max-h-52 overflow-y-auto">
                    {uploads.map(entry => (
                        <UploadRow key={entry.id} entry={entry} />
                    ))}
                </div>
            )}
        </div>
    )
}
