"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    AlertTriangle,
    Archive,
    FileText,
    Folder,
    ImageIcon,
    Loader2,
    MoreVertical,
    Music,
    RotateCcw,
    Search,
    Trash2,
    Video,
} from "lucide-react"
import { cn, formatApiDateTime, parseApiDate } from "@/lib/utils"
import {
    emptyTrash,
    getTrash,
    permanentDeleteFile,
    restoreFile,
    type FileItem,
} from "@/lib/api"

const getFileIcon = (type: FileItem["type"]) => {
    const icons = {
        folder: Folder,
        document: FileText,
        image: ImageIcon,
        video: Video,
        audio: Music,
        archive: Archive,
        other: FileText,
    }
    return icons[type] || FileText
}

const getFileColor = (type: FileItem["type"]) => {
    const colors = {
        folder: "text-blue-400",
        document: "text-red-400",
        image: "text-green-400",
        video: "text-purple-400",
        audio: "text-yellow-400",
        archive: "text-orange-400",
        other: "text-gray-400",
    }
    return colors[type] || "text-gray-400"
}

function formatFileSize(bytes: number): string {
    if (!bytes) return "-"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB", "TB"]
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatDate(dateString?: string): string {
    return formatApiDateTime(dateString, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })
}

const DAY_MS = 24 * 60 * 60 * 1000

function getDaysUntilAutoDelete(dateString: string | undefined, retentionDays: number): number {
    if (!dateString) return retentionDays
    const deletedAt = parseApiDate(dateString)
    if (!deletedAt) return retentionDays
    return Math.max(0, Math.ceil((deletedAt.getTime() + retentionDays * DAY_MS - Date.now()) / DAY_MS))
}

function formatAutoDeleteLabel(daysLeft: number): string {
    if (daysLeft <= 0) return "Deletes today"
    if (daysLeft === 1) return "Deletes tomorrow"
    return `Deletes in ${daysLeft} days`
}

type ConfirmAction =
    | { type: "single-delete"; file: FileItem }
    | { type: "selected-delete" }
    | { type: "empty" }

export function TrashContent() {
    const [files, setFiles] = useState<FileItem[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [status, setStatus] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState("")
    const [selectedIds, setSelectedIds] = useState<number[]>([])
    const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
    const [isProcessing, setIsProcessing] = useState(false)
    const [retentionDays, setRetentionDays] = useState(30)

    useEffect(() => {
        loadTrash()
    }, [])

    async function loadTrash() {
        setIsLoading(true)
        setError(null)
        try {
            const data = await getTrash()
            setRetentionDays(data.retentionDays || 30)
            setFiles(data.files)
            setSelectedIds((current) => current.filter((id) => data.files.some((file) => file.id === id)))
            if (data.purged && data.purged.deletedItems > 0) {
                setStatus(`Auto-deleted ${data.purged.deletedItems} expired trash item${data.purged.deletedItems === 1 ? "" : "s"} and freed ${formatFileSize(data.purged.freedBytes)}`)
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load trash")
        } finally {
            setIsLoading(false)
        }
    }

    async function restoreItems(items: FileItem[]) {
        if (items.length === 0) return
        setIsProcessing(true)
        setError(null)
        try {
            for (const item of items) {
                await restoreFile(item.id)
            }
            setStatus(items.length === 1 ? `Restored "${items[0].name}"` : `Restored ${items.length} items`)
            setSelectedIds([])
            await loadTrash()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Restore failed")
        } finally {
            setIsProcessing(false)
        }
    }

    async function handleConfirmAction() {
        if (!confirmAction) return
        setIsProcessing(true)
        setError(null)
        try {
            if (confirmAction.type === "single-delete") {
                await permanentDeleteFile(confirmAction.file.id)
                setStatus(`Deleted "${confirmAction.file.name}" permanently`)
            } else if (confirmAction.type === "selected-delete") {
                for (const item of selectedItems) {
                    await permanentDeleteFile(item.id)
                }
                setStatus(`Deleted ${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"} permanently`)
                setSelectedIds([])
            } else {
                const result = await emptyTrash()
                setStatus(result.deletedItems > 0
                    ? `Emptied Trash and freed ${formatFileSize(result.freedBytes)}`
                    : "Trash is already empty")
                setSelectedIds([])
            }
            setConfirmAction(null)
            await loadTrash()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Trash action failed")
        } finally {
            setIsProcessing(false)
        }
    }

    function toggleSelection(id: number) {
        setSelectedIds((current) =>
            current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id]
        )
    }

    const filteredFiles = files.filter((file) => {
        const needle = searchQuery.toLowerCase()
        return file.name.toLowerCase().includes(needle) || (file.location || "").toLowerCase().includes(needle)
    })
    const selectedItems = files.filter((file) => selectedIds.includes(file.id))
    const visibleSelectedCount = filteredFiles.filter((file) => selectedIds.includes(file.id)).length
    const allVisibleSelected = filteredFiles.length > 0 && visibleSelectedCount === filteredFiles.length
    const folderCount = files.filter((file) => file.type === "folder").length
    const fileCount = files.length - folderCount
    const totalBytes = files.reduce((sum, file) => sum + (file.type === "folder" ? 0 : Number(file.size) || 0), 0)

    if (isLoading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
                        <Trash2 className="h-5 w-5 text-destructive sm:h-6 sm:w-6" />
                        Trash
                    </h1>
                    <p className="text-xs text-muted-foreground sm:text-sm">
                        Restore items or permanently remove them from storage. Items auto-delete after {retentionDays} days.
                    </p>
                </div>
                {files.length > 0 && (
                    <div className="flex w-full min-w-0 flex-col gap-2 lg:w-auto sm:flex-row sm:items-center">
                        <div className="flex flex-wrap gap-2">
                            <Badge variant="secondary">{files.length} total</Badge>
                            <Badge variant="outline">{folderCount} folder{folderCount === 1 ? "" : "s"}</Badge>
                            <Badge variant="outline">{fileCount} file{fileCount === 1 ? "" : "s"}</Badge>
                            <Badge variant="outline">{formatFileSize(totalBytes)}</Badge>
                            <Badge variant="outline">{retentionDays}-day cleanup</Badge>
                        </div>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setConfirmAction({ type: "empty" })}
                            disabled={isProcessing}
                            className="w-full sm:w-auto"
                        >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Empty Trash
                        </Button>
                    </div>
                )}
            </div>

            {files.length > 0 && (
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="relative max-w-xl flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder="Search trash..."
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            className="pl-9"
                        />
                    </div>
                    {selectedItems.length > 0 && (
                        <div className="grid w-full grid-cols-2 gap-2 rounded-lg border border-border bg-secondary/60 p-2 min-[420px]:flex min-[420px]:flex-wrap md:w-auto">
                            <span className="col-span-2 flex items-center px-2 text-sm text-secondary-foreground min-[420px]:col-span-1">
                                {selectedItems.length} selected
                            </span>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="gap-2"
                                disabled={isProcessing}
                                onClick={() => restoreItems(selectedItems)}
                            >
                                <RotateCcw className="h-4 w-4" />
                                Restore
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="gap-2 text-destructive"
                                disabled={isProcessing}
                                onClick={() => setConfirmAction({ type: "selected-delete" })}
                            >
                                <Trash2 className="h-4 w-4" />
                                Delete
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
                                Clear
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {status && (
                <Card className="border-emerald-500/30 bg-emerald-500/10">
                    <CardContent className="py-3">
                        <p className="text-sm text-emerald-500">{status}</p>
                    </CardContent>
                </Card>
            )}

            {error && (
                <Card className="border-destructive bg-destructive/10">
                    <CardContent className="py-3">
                        <p className="text-sm text-destructive">{error}</p>
                    </CardContent>
                </Card>
            )}

            {files.length === 0 && (
                <Card className="py-12">
                    <CardContent className="flex flex-col items-center justify-center text-center">
                        <Trash2 className="mb-4 h-16 w-16 text-muted-foreground" />
                        <h3 className="text-lg font-medium">Trash is empty</h3>
                        <p className="mt-1 text-muted-foreground">
                            Deleted files and folders will appear here
                        </p>
                    </CardContent>
                </Card>
            )}

            {files.length > 0 && filteredFiles.length === 0 && (
                <Card className="py-12">
                    <CardContent className="flex flex-col items-center justify-center text-center">
                        <Search className="mb-4 h-12 w-12 text-muted-foreground" />
                        <h3 className="text-lg font-medium">No matching trash items</h3>
                        <Button variant="outline" className="mt-4" onClick={() => setSearchQuery("")}>
                            Clear search
                        </Button>
                    </CardContent>
                </Card>
            )}

            {filteredFiles.length > 0 && (
                <Card className="overflow-hidden border-border bg-card">
                    <CardHeader className="hidden border-b border-border py-3 sm:block">
                        <div className="grid grid-cols-12 gap-4 text-xs font-medium text-muted-foreground">
                            <div className="col-span-5 flex items-center gap-3">
                                <Checkbox
                                    checked={allVisibleSelected}
                                    onCheckedChange={() => {
                                        if (allVisibleSelected) {
                                            setSelectedIds((current) => current.filter((id) => !filteredFiles.some((file) => file.id === id)))
                                        } else {
                                            setSelectedIds((current) => Array.from(new Set([...current, ...filteredFiles.map((file) => file.id)])))
                                        }
                                    }}
                                    aria-label="Select all visible trash items"
                                />
                                Name
                            </div>
                            <div className="col-span-3 hidden md:block">Original location</div>
                            <div className="col-span-2 hidden sm:block">Deleted</div>
                            <div className="col-span-2" />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {filteredFiles.map((file) => {
                            const Icon = getFileIcon(file.type)
                            const selected = selectedIds.includes(file.id)
                            const daysLeft = getDaysUntilAutoDelete(file.trashed_at, retentionDays)
                            return (
                                <div
                                    key={file.id}
                                    tabIndex={0}
                                    onClick={() => toggleSelection(file.id)}
                                    onKeyDown={(event) => {
                                        if (event.target !== event.currentTarget) return
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault()
                                            toggleSelection(file.id)
                                        }
                                    }}
                                    className={cn(
                                        "flex cursor-pointer select-none flex-col items-stretch gap-3 border-b border-border px-4 py-3 outline-none last:border-0 hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset sm:grid sm:grid-cols-12 sm:items-center sm:gap-4 sm:px-6",
                                        selected && "bg-primary/10 hover:bg-primary/15"
                                    )}
                                >
                                    <div className="flex min-w-0 flex-1 items-center gap-3 sm:col-span-5">
                                        <Checkbox
                                            checked={selected}
                                            onCheckedChange={() => toggleSelection(file.id)}
                                            onClick={(event) => event.stopPropagation()}
                                            aria-label={`Select ${file.name}`}
                                        />
                                        <Icon className={cn("h-5 w-5 flex-shrink-0 opacity-60", getFileColor(file.type))} />
                                        <div className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium text-card-foreground opacity-80" title={file.name}>
                                                {file.name}
                                            </span>
                                            <div className="mt-1 flex">
                                                <Badge
                                                    variant="outline"
                                                    className={cn(
                                                        "max-w-full truncate px-1.5 py-0 text-[11px] font-normal",
                                                        daysLeft <= 7 && "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300"
                                                    )}
                                                >
                                                    {formatAutoDeleteLabel(daysLeft)}
                                                </Badge>
                                            </div>
                                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:hidden">
                                                <span>{file.location || "My Files"}</span>
                                                <span>{file.type === "folder" ? "Folder" : formatFileSize(file.size)}</span>
                                                <span>{formatDate(file.trashed_at)}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="hidden min-w-0 md:col-span-3 md:block">
                                        <p className="truncate text-sm text-muted-foreground">{file.location || "My Files"}</p>
                                    </div>
                                    <div className="hidden text-sm text-muted-foreground sm:col-span-2 sm:block">
                                        {formatDate(file.trashed_at)}
                                    </div>
                                    <div className="flex w-full flex-shrink-0 justify-end gap-1 sm:col-span-2 sm:w-auto">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="flex-1 gap-2 sm:flex-none"
                                            onClick={(event) => {
                                                event.stopPropagation()
                                                restoreItems([file])
                                            }}
                                            disabled={isProcessing}
                                        >
                                            <RotateCcw className="h-4 w-4" />
                                            <span className="hidden md:inline">Restore</span>
                                        </Button>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8"
                                                    onClick={(event) => event.stopPropagation()}
                                                >
                                                    <MoreVertical className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => restoreItems([file])}>
                                                    <RotateCcw className="mr-2 h-4 w-4" />
                                                    Restore
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    className="text-destructive"
                                                    onClick={() => setConfirmAction({ type: "single-delete", file })}
                                                >
                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                    Delete permanently
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </div>
                            )
                        })}
                    </CardContent>
                </Card>
            )}

            <AlertDialog open={Boolean(confirmAction)} onOpenChange={(open) => {
                if (!open && !isProcessing) setConfirmAction(null)
            }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-destructive" />
                            {confirmAction?.type === "empty"
                                ? "Empty Trash?"
                                : confirmAction?.type === "selected-delete"
                                    ? "Delete selected items permanently?"
                                    : "Delete permanently?"}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmAction?.type === "empty"
                                ? `All ${files.length} trash item${files.length === 1 ? "" : "s"} will be permanently deleted.`
                                : confirmAction?.type === "selected-delete"
                                    ? `${selectedItems.length} selected item${selectedItems.length === 1 ? "" : "s"} will be permanently deleted.`
                                    : `"${confirmAction?.file.name}" will be permanently deleted.`}
                            {" "}This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isProcessing}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(event) => {
                                event.preventDefault()
                                handleConfirmAction()
                            }}
                            disabled={isProcessing}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Delete permanently
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
