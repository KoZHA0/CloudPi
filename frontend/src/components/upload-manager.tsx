"use client"

import { useUpload, type UploadEntry } from "@/contexts/upload-context"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
    AlertCircle,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    FileIcon,
    Loader2,
    RotateCcw,
    Trash2,
    X,
    XCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"

function formatSize(bytes: number): string {
    if (!bytes) return "0 B"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB", "TB"]
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatDuration(seconds?: number): string {
    if (!seconds || !Number.isFinite(seconds)) return ""
    if (seconds < 60) return `${Math.ceil(seconds)}s`
    const minutes = Math.floor(seconds / 60)
    const remainder = Math.ceil(seconds % 60)
    return `${minutes}m ${remainder}s`
}

function getStatusText(entry: UploadEntry) {
    if (entry.status === "done") return "Complete"
    if (entry.status === "cancelled") return "Cancelled"
    if (entry.status === "error") return entry.error || "Upload failed"
    if (entry.status === "pending") return "Waiting"

    const speed = entry.speedBps ? `${formatSize(entry.speedBps)}/s` : ""
    const eta = entry.etaSeconds ? `${formatDuration(entry.etaSeconds)} left` : ""
    return [speed, eta].filter(Boolean).join(" - ") || `${Math.round(entry.progress)}%`
}

function UploadRow({ entry }: { entry: UploadEntry }) {
    const { retryUpload, cancelUpload, removeUpload } = useUpload()
    const isActive = entry.status === "uploading" || entry.status === "pending"
    const isFinished = entry.status === "done" || entry.status === "error" || entry.status === "cancelled"

    return (
        <div className="flex items-start gap-3 border-b border-border px-3 py-3 last:border-0">
            <div className="mt-0.5 shrink-0">
                {entry.status === "uploading" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                {entry.status === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                {entry.status === "error" && <AlertCircle className="h-4 w-4 text-destructive" />}
                {entry.status === "cancelled" && <XCircle className="h-4 w-4 text-muted-foreground" />}
                {entry.status === "pending" && <FileIcon className="h-4 w-4 text-muted-foreground" />}
            </div>

            <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-card-foreground">{entry.fileName}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="text-[10px] text-muted-foreground">
                                {entry.status === "uploading" && entry.uploadedBytes > 0
                                    ? `${formatSize(entry.uploadedBytes)} of ${formatSize(entry.fileSize)}`
                                    : formatSize(entry.fileSize)}
                            </p>
                            <p className={cn(
                                "truncate text-[10px]",
                                entry.status === "error" ? "text-destructive" : "text-muted-foreground"
                            )}>
                                {getStatusText(entry)}
                            </p>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                        {entry.status === "error" || entry.status === "cancelled" ? (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => retryUpload(entry.id)}
                                title="Retry upload"
                            >
                                <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                        ) : null}
                        {isActive ? (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => cancelUpload(entry.id)}
                                title="Cancel upload"
                            >
                                <X className="h-3.5 w-3.5" />
                            </Button>
                        ) : null}
                        {isFinished ? (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => removeUpload(entry.id)}
                                title="Dismiss"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        ) : null}
                    </div>
                </div>

                {(entry.status === "uploading" || entry.status === "pending") && (
                    <Progress value={entry.progress} className="mt-2 h-1.5" />
                )}
            </div>
        </div>
    )
}

export function UploadManager() {
    const { uploads, isMinimized, setIsMinimized, clearCompleted, cancelAll, totalActive } = useUpload()

    if (uploads.length === 0) return null

    const completedCount = uploads.filter(u => u.status === "done").length
    const errorCount = uploads.filter(u => u.status === "error").length
    const cancelledCount = uploads.filter(u => u.status === "cancelled").length
    const finishedCount = completedCount + errorCount + cancelledCount
    const totalProgress = totalActive > 0
        ? uploads
            .filter(u => u.status === "pending" || u.status === "uploading")
            .reduce((sum, upload) => sum + upload.progress, 0) / totalActive
        : 100

    return (
        <div className={cn(
            "fixed bottom-3 left-3 right-3 z-50 sm:bottom-4 sm:left-auto sm:right-4 sm:w-[380px]",
            "rounded-xl border border-border bg-card shadow-2xl shadow-black/20",
            "max-h-[70vh] overflow-hidden transition-all duration-300",
        )}>
            <div
                className="cursor-pointer select-none border-b border-border px-3 py-2.5"
                onClick={() => setIsMinimized(!isMinimized)}
            >
                <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                        <div className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                            totalActive > 0 ? "bg-primary/15" : errorCount > 0 ? "bg-destructive/15" : "bg-emerald-500/15"
                        )}>
                            {totalActive > 0 ? (
                                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            ) : errorCount > 0 ? (
                                <AlertCircle className="h-4 w-4 text-destructive" />
                            ) : (
                                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                            )}
                        </div>
                        <div className="min-w-0">
                            <p className="truncate text-xs font-semibold leading-tight text-card-foreground">
                                {totalActive > 0
                                    ? `Uploading ${totalActive} batch${totalActive === 1 ? "" : "es"}`
                                    : errorCount > 0
                                        ? "Some uploads need attention"
                                        : "Uploads complete"}
                            </p>
                            <p className="truncate text-[10px] leading-tight text-muted-foreground">
                                {completedCount > 0 && `${completedCount} done`}
                                {errorCount > 0 && `${completedCount > 0 ? " - " : ""}${errorCount} failed`}
                                {cancelledCount > 0 && `${completedCount > 0 || errorCount > 0 ? " - " : ""}${cancelledCount} cancelled`}
                                {finishedCount === 0 && totalActive > 0 && `${Math.round(totalProgress)}% overall`}
                            </p>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                        {totalActive > 0 && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={(event) => {
                                    event.stopPropagation()
                                    cancelAll()
                                }}
                                title="Cancel all active uploads"
                            >
                                <X className="h-3.5 w-3.5" />
                            </Button>
                        )}
                        {finishedCount > 0 && totalActive === 0 && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={(event) => {
                                    event.stopPropagation()
                                    clearCompleted()
                                }}
                                title="Clear finished"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                            {isMinimized ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                    </div>
                </div>

                {totalActive > 0 && (
                    <Progress value={totalProgress} className="mt-2 h-1" />
                )}
            </div>

            {!isMinimized && (
                <div className="max-h-[52vh] overflow-y-auto">
                    {uploads.map(entry => (
                        <UploadRow key={entry.id} entry={entry} />
                    ))}
                </div>
            )}
        </div>
    )
}
