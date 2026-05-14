"use client"

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Archive,
    Clock,
    Download,
    Eye,
    ExternalLink,
    FileBadge,
    FileBraces,
    FileCode,
    FileText,
    FileType,
    ImageIcon,
    Loader2,
    MoreVertical,
    Music,
    Search,
    SortAsc,
    SortDesc,
    Star,
    Trash2,
    Video,
    type LucideIcon,
} from "lucide-react"
import { cn, formatApiDate, formatApiDateTime, parseApiDate } from "@/lib/utils"
import { useDriveStatus } from "@/contexts/drive-status-context"
import {
    deleteFile,
    downloadFile,
    getRecentFiles,
    toggleStar,
    type FileItem,
} from "@/lib/api"

type RecentActionFilter = "all" | "viewed" | "uploaded" | "modified"
type RecentSortKey = "date" | "name" | "size"
type RecentSortDirection = "asc" | "desc"

const getFileIcon = (type: FileItem["type"]) => {
    const icons = {
        folder: FileText,
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

function getExtension(fileName: string) {
    const match = fileName.toLowerCase().match(/\.([^.]+)$/)
    return match?.[1] || ""
}

function getDocumentPresentation(file: FileItem): { icon: LucideIcon; color: string } {
    const ext = getExtension(file.name)
    const mime = (file.mime_type || "").toLowerCase()
    const codeExtensions = new Set([
        "js", "jsx", "ts", "tsx", "mjs", "cjs", "css", "scss", "html", "htm",
        "py", "rb", "php", "java", "c", "cpp", "h", "hpp", "cs", "go", "rs",
        "sh", "bash", "ps1", "sql", "xml", "toml", "ini",
    ])

    if (ext === "pdf" || mime.includes("pdf")) {
        return { icon: FileBadge, color: "text-red-400" }
    }
    if (ext === "md" || ext === "markdown") {
        return { icon: FileType, color: "text-indigo-400" }
    }
    if (ext === "json" || ext === "yml" || ext === "yaml") {
        return { icon: FileBraces, color: "text-cyan-400" }
    }
    if (codeExtensions.has(ext)) {
        return { icon: FileCode, color: "text-cyan-400" }
    }
    if (ext === "txt" || ext === "log" || mime === "text/plain") {
        return { icon: FileText, color: "text-slate-400" }
    }
    return { icon: FileText, color: "text-red-400" }
}

function getFilePresentation(file: FileItem): { icon: LucideIcon; color: string } {
    if (file.type === "document") return getDocumentPresentation(file)
    return { icon: getFileIcon(file.type), color: getFileColor(file.type) }
}

function formatFileSize(bytes: number): string {
    if (!bytes) return "-"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB", "TB"]
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatRelativeTime(dateString?: string | null): string {
    if (!dateString) return "-"
    const date = parseApiDate(dateString)
    if (!date) return "-"
    const now = new Date()
    const diffMs = Math.max(0, now.getTime() - date.getTime())
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return "Just now"
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return formatApiDate(dateString)
}

function recentActionLabel(action?: FileItem["recent_action"]) {
    if (action === "viewed") return "Viewed"
    if (action === "modified") return "Modified"
    return "Uploaded"
}

function recentActionValue(file: FileItem): Exclude<RecentActionFilter, "all"> {
    return file.recent_action === "viewed" || file.recent_action === "modified" ? file.recent_action : "uploaded"
}

function getRecentTimestampValue(file: FileItem) {
    const action = recentActionValue(file)
    if (action === "viewed") return file.accessed_at || file.recent_at || file.modified_at || file.created_at
    if (action === "modified") return file.modified_at || file.recent_at || file.accessed_at || file.created_at
    return file.created_at || file.recent_at || file.modified_at || file.accessed_at
}

function getRecentTimestamp(file: FileItem) {
    const date = parseApiDate(getRecentTimestampValue(file))
    return date ? date.getTime() : 0
}

function getRecentActionText(file: FileItem) {
    return `${recentActionLabel(file.recent_action)} ${formatRelativeTime(getRecentTimestampValue(file))}`
}

function getRecentActionTitle(file: FileItem) {
    const dateString = getRecentTimestampValue(file)
    const date = parseApiDate(dateString)
    if (!date) return recentActionLabel(file.recent_action)
    return `${recentActionLabel(file.recent_action)} ${formatApiDateTime(dateString)}`
}

function dedupeRecentFiles(items: FileItem[]) {
    const byId = new Map<number, FileItem>()
    for (const item of items) {
        const current = byId.get(item.id)
        if (!current || getRecentTimestamp(item) > getRecentTimestamp(current)) {
            byId.set(item.id, item)
        }
    }
    return Array.from(byId.values())
}

export function RecentContent() {
    const navigate = useNavigate()
    const { isFileAccessible } = useDriveStatus()
    const [files, setFiles] = useState<FileItem[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [status, setStatus] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState("")
    const [actionFilter, setActionFilter] = useState<RecentActionFilter>("all")
    const [sortKey, setSortKey] = useState<RecentSortKey>("date")
    const [sortDirection, setSortDirection] = useState<RecentSortDirection>("desc")
    const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null)
    const [isDeleting, setIsDeleting] = useState(false)

    useEffect(() => {
        loadRecent()
    }, [])

    async function loadRecent() {
        setIsLoading(true)
        setError(null)
        try {
            const data = await getRecentFiles()
            setFiles(data.files)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load recent files")
        } finally {
            setIsLoading(false)
        }
    }

    function locateInFiles(file: FileItem) {
        const params = new URLSearchParams()
        if (file.parent_id) params.set("folder", String(file.parent_id))
        params.set("highlight", String(file.id))
        navigate(`/files?${params.toString()}`)
    }

    function previewInFiles(file: FileItem) {
        const params = new URLSearchParams()
        if (file.parent_id) params.set("folder", String(file.parent_id))
        params.set("highlight", String(file.id))
        params.set("preview", String(file.id))
        navigate(`/files?${params.toString()}`)
    }

    async function handleDownload(file: FileItem) {
        setError(null)
        try {
            await downloadFile(file.id, file.name)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Download failed")
        }
    }

    async function handleToggleStar(file: FileItem) {
        setError(null)
        try {
            const result = await toggleStar(file.id)
            setFiles((current) => current.map((item) =>
                item.id === file.id ? { ...item, starred: result.starred ? 1 : 0 } : item
            ))
            setStatus(result.starred ? `Starred "${file.name}"` : `Removed "${file.name}" from Starred`)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update starred item")
        }
    }

    async function handleMoveToTrash() {
        if (!deleteTarget) return
        setIsDeleting(true)
        setError(null)
        try {
            await deleteFile(deleteTarget.id)
            setFiles((current) => current.filter((item) => item.id !== deleteTarget.id))
            setStatus(`Moved "${deleteTarget.name}" to Trash`)
            setDeleteTarget(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Delete failed")
        } finally {
            setIsDeleting(false)
        }
    }

    const dedupedFiles = dedupeRecentFiles(files)
    const filteredFiles = dedupedFiles.filter((file) => {
        const needle = searchQuery.toLowerCase()
        const matchesSearch = file.name.toLowerCase().includes(needle) ||
            (file.location || "").toLowerCase().includes(needle) ||
            file.type.toLowerCase().includes(needle) ||
            recentActionLabel(file.recent_action).toLowerCase().includes(needle)
        const matchesAction = actionFilter === "all" || recentActionValue(file) === actionFilter
        return matchesSearch && matchesAction
    }).sort((a, b) => {
        let comparison = 0
        if (sortKey === "name") {
            comparison = a.name.localeCompare(b.name)
        } else if (sortKey === "size") {
            comparison = (Number(a.size) || 0) - (Number(b.size) || 0)
        } else {
            comparison = getRecentTimestamp(a) - getRecentTimestamp(b)
        }
        return sortDirection === "asc" ? comparison : -comparison
    })
    const starredCount = dedupedFiles.filter((file) => file.starred === 1).length
    const totalBytes = dedupedFiles.reduce((sum, file) => sum + (Number(file.size) || 0), 0)
    const actionCounts = dedupedFiles.reduce<Record<RecentActionFilter, number>>((counts, file) => {
        counts.all += 1
        counts[recentActionValue(file)] += 1
        return counts
    }, { all: 0, viewed: 0, uploaded: 0, modified: 0 })

    function renderRecentContextMenuItems(file: FileItem) {
        const accessible = isFileAccessible(file)

        return (
            <>
                <ContextMenuItem onClick={() => previewInFiles(file)} disabled={!accessible}>
                    <Eye className="mr-2 h-4 w-4" />
                    Preview
                </ContextMenuItem>
                <ContextMenuItem onClick={() => locateInFiles(file)}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Locate in Files
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleDownload(file)} disabled={!accessible}>
                    <Download className="mr-2 h-4 w-4" />
                    Download
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleToggleStar(file)}>
                    <Star className="mr-2 h-4 w-4" />
                    {file.starred === 1 ? "Remove from starred" : "Add to starred"}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem className="text-destructive" onClick={() => setDeleteTarget(file)}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Move to trash
                </ContextMenuItem>
            </>
        )
    }

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
                        <Clock className="h-5 w-5 text-primary sm:h-6 sm:w-6" />
                        Recent
                    </h1>
                    <p className="text-xs text-muted-foreground sm:text-sm">
                        Recently viewed, uploaded, and modified files
                    </p>
                </div>
                {files.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">{files.length} recent</Badge>
                        <Badge variant="outline">{starredCount} starred</Badge>
                        <Badge variant="outline">{formatFileSize(totalBytes)}</Badge>
                    </div>
                )}
            </div>

            {files.length > 0 && (
                <div className="space-y-3">
                    <div className="overflow-x-auto pb-1">
                        <Tabs value={actionFilter} onValueChange={(value) => setActionFilter(value as RecentActionFilter)}>
                            <TabsList className="w-max">
                                {[
                                    { value: "all", label: "All" },
                                    { value: "viewed", label: "Viewed" },
                                    { value: "uploaded", label: "Uploaded" },
                                    { value: "modified", label: "Modified" },
                                ].map((item) => (
                                    <TabsTrigger key={item.value} value={item.value} className="gap-2">
                                        {item.label}
                                        <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                                            {actionCounts[item.value as RecentActionFilter]}
                                        </span>
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                        </Tabs>
                    </div>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="relative max-w-xl flex-1">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder="Search recent files..."
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                className="pl-9"
                            />
                        </div>
                        <div className="flex w-full gap-2 sm:w-auto">
                            <Select value={sortKey} onValueChange={(value) => setSortKey(value as RecentSortKey)}>
                                <SelectTrigger className="min-w-0 flex-1 sm:w-36">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="date">Date</SelectItem>
                                    <SelectItem value="name">Name</SelectItem>
                                    <SelectItem value="size">Size</SelectItem>
                                </SelectContent>
                            </Select>
                            <Button
                                variant="outline"
                                size="icon"
                                className="shrink-0"
                                onClick={() => setSortDirection((current) => current === "asc" ? "desc" : "asc")}
                                title={sortDirection === "asc" ? "Ascending" : "Descending"}
                            >
                                {sortDirection === "asc" ? <SortAsc className="h-4 w-4" /> : <SortDesc className="h-4 w-4" />}
                            </Button>
                        </div>
                    </div>
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
                        <Clock className="mb-4 h-16 w-16 text-muted-foreground" />
                        <h3 className="text-lg font-medium">No recent files</h3>
                        <p className="mt-1 text-muted-foreground">
                            Files you upload, edit, or preview will appear here
                        </p>
                    </CardContent>
                </Card>
            )}

            {files.length > 0 && filteredFiles.length === 0 && (
                <Card className="py-12">
                    <CardContent className="flex flex-col items-center justify-center text-center">
                        <Search className="mb-4 h-12 w-12 text-muted-foreground" />
                        <h3 className="text-lg font-medium">No matching recent files</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Try another activity filter, sort, or search term.
                        </p>
                        <Button
                            variant="outline"
                            className="mt-4"
                            onClick={() => {
                                setSearchQuery("")
                                setActionFilter("all")
                            }}
                        >
                            Clear filters
                        </Button>
                    </CardContent>
                </Card>
            )}

            {filteredFiles.length > 0 && (
                <Card className="overflow-hidden border-border bg-card">
                    <CardHeader className="hidden border-b border-border py-3 sm:block">
                        <div className="grid grid-cols-12 gap-4 text-xs font-medium text-muted-foreground">
                            <div className="col-span-5 lg:col-span-4">Name</div>
                            <div className="hidden lg:col-span-3 lg:block">Location</div>
                            <div className="hidden sm:col-span-2 sm:block">Size</div>
                            <div className="hidden sm:col-span-3 sm:block lg:col-span-2">Last Action</div>
                            <div className="col-span-2 lg:col-span-1" />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {filteredFiles.map((file) => {
                            const { icon: Icon, color } = getFilePresentation(file)
                            const accessible = isFileAccessible(file)
                            return (
                                <ContextMenu key={file.id}>
                                    <ContextMenuTrigger asChild>
                                        <div
                                            className={cn(
                                                "flex cursor-pointer items-center gap-2 border-b border-border px-4 py-3 last:border-0 hover:bg-secondary sm:grid sm:grid-cols-12 sm:gap-4 sm:px-6",
                                                !accessible && "opacity-50"
                                            )}
                                            onClick={() => locateInFiles(file)}
                                            title={!accessible ? "Drive disconnected - file temporarily unavailable" : file.name}
                                        >
                                    <div className="flex min-w-0 flex-1 items-center gap-3 sm:col-span-5 lg:col-span-4">
                                        <Icon className={cn("h-5 w-5 flex-shrink-0", color)} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex min-w-0 items-center gap-2">
                                                <span className="truncate text-sm font-medium text-card-foreground">
                                                    {file.name}
                                                </span>
                                                {file.starred === 1 && (
                                                    <Star className="h-4 w-4 flex-shrink-0 fill-yellow-400 text-yellow-400" />
                                                )}
                                            </div>
                                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:hidden">
                                                <span>{file.location || "My Files"}</span>
                                                <span>{formatFileSize(file.size)}</span>
                                                <span title={getRecentActionTitle(file)}>{getRecentActionText(file)}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="hidden min-w-0 lg:col-span-3 lg:block">
                                        <p className="truncate text-sm text-muted-foreground">{file.location || "My Files"}</p>
                                    </div>
                                    <div className="hidden text-sm text-muted-foreground sm:col-span-2 sm:block">
                                        {formatFileSize(file.size)}
                                    </div>
                                    <div className="hidden text-sm text-muted-foreground sm:col-span-3 sm:block lg:col-span-2">
                                        <span title={getRecentActionTitle(file)}>{getRecentActionText(file)}</span>
                                    </div>
                                    <div className="flex flex-shrink-0 justify-end gap-1 sm:col-span-2 lg:col-span-1">
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
                                                <DropdownMenuItem onClick={() => previewInFiles(file)} disabled={!accessible}>
                                                    <Eye className="mr-2 h-4 w-4" />
                                                    Preview
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => locateInFiles(file)}>
                                                    <ExternalLink className="mr-2 h-4 w-4" />
                                                    Locate in Files
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleDownload(file)} disabled={!accessible}>
                                                    <Download className="mr-2 h-4 w-4" />
                                                    Download
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleToggleStar(file)}>
                                                    <Star className="mr-2 h-4 w-4" />
                                                    {file.starred === 1 ? "Remove from starred" : "Add to starred"}
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem
                                                    className="text-destructive"
                                                    onClick={() => setDeleteTarget(file)}
                                                >
                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                    Move to trash
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                        </div>
                                    </ContextMenuTrigger>
                                    <ContextMenuContent className="w-52">
                                        {renderRecentContextMenuItems(file)}
                                    </ContextMenuContent>
                                </ContextMenu>
                            )
                        })}
                    </CardContent>
                </Card>
            )}

            <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => {
                if (!open && !isDeleting) setDeleteTarget(null)
            }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Move to Trash?</AlertDialogTitle>
                        <AlertDialogDescription>
                            "{deleteTarget?.name}" will be moved to Trash. You can restore it later from the Trash page.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(event) => {
                                event.preventDefault()
                                handleMoveToTrash()
                            }}
                            disabled={isDeleting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Move to Trash
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
