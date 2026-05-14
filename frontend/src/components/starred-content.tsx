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
    Download,
    ExternalLink,
    FileText,
    Folder,
    ImageIcon,
    Loader2,
    MoreVertical,
    Music,
    Search,
    Star,
    StarOff,
    Trash2,
    Video,
} from "lucide-react"
import { cn, formatApiDate } from "@/lib/utils"
import { useDriveStatus } from "@/contexts/drive-status-context"
import {
    deleteFile,
    downloadFile,
    getStarredFiles,
    toggleStar,
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
    return formatApiDate(dateString)
}

export function StarredContent() {
    const navigate = useNavigate()
    const { isFileAccessible } = useDriveStatus()
    const [files, setFiles] = useState<FileItem[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [status, setStatus] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState("")
    const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null)
    const [isDeleting, setIsDeleting] = useState(false)

    useEffect(() => {
        loadStarred()
    }, [])

    async function loadStarred() {
        setIsLoading(true)
        setError(null)
        try {
            const data = await getStarredFiles()
            setFiles(data.files)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load starred files")
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

    async function handleDownload(file: FileItem) {
        setError(null)
        try {
            await downloadFile(file.id, file.type === "folder" ? `${file.name}.zip` : file.name)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Download failed")
        }
    }

    async function handleUnstar(file: FileItem) {
        setError(null)
        try {
            await toggleStar(file.id)
            setFiles((current) => current.filter((item) => item.id !== file.id))
            setStatus(`Removed "${file.name}" from Starred`)
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

    const filteredFiles = files.filter((file) => {
        const needle = searchQuery.toLowerCase()
        return file.name.toLowerCase().includes(needle) || (file.location || "").toLowerCase().includes(needle)
    })
    const folderCount = files.filter((file) => file.type === "folder").length
    const fileCount = files.length - folderCount
    const totalBytes = files.reduce((sum, file) => sum + (file.type === "folder" ? 0 : Number(file.size) || 0), 0)

    function renderStarredContextMenuItems(file: FileItem) {
        const accessible = isFileAccessible(file)

        return (
            <>
                <ContextMenuItem onClick={() => locateInFiles(file)}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Locate in Files
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleDownload(file)} disabled={!accessible}>
                    <Download className="mr-2 h-4 w-4" />
                    {file.type === "folder" ? "Download ZIP" : "Download"}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleUnstar(file)}>
                    <StarOff className="mr-2 h-4 w-4" />
                    Remove from starred
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
                        <Star className="h-5 w-5 fill-yellow-400 text-yellow-400 sm:h-6 sm:w-6" />
                        Starred
                    </h1>
                    <p className="text-xs text-muted-foreground sm:text-sm">
                        Quick access to files and folders you marked important
                    </p>
                </div>
                {files.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">{files.length} total</Badge>
                        <Badge variant="outline">{folderCount} folder{folderCount === 1 ? "" : "s"}</Badge>
                        <Badge variant="outline">{fileCount} file{fileCount === 1 ? "" : "s"}</Badge>
                        <Badge variant="outline">{formatFileSize(totalBytes)}</Badge>
                    </div>
                )}
            </div>

            {files.length > 0 && (
                <div className="relative max-w-xl">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Search starred items..."
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        className="pl-9"
                    />
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
                        <Star className="mb-4 h-16 w-16 text-muted-foreground" />
                        <h3 className="text-lg font-medium">No starred items</h3>
                        <p className="mt-1 text-muted-foreground">
                            Star files or folders to find them here quickly
                        </p>
                    </CardContent>
                </Card>
            )}

            {files.length > 0 && filteredFiles.length === 0 && (
                <Card className="py-12">
                    <CardContent className="flex flex-col items-center justify-center text-center">
                        <Search className="mb-4 h-12 w-12 text-muted-foreground" />
                        <h3 className="text-lg font-medium">No matching starred items</h3>
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
                            <div className="col-span-5">Name</div>
                            <div className="col-span-3 hidden md:block">Location</div>
                            <div className="col-span-2 hidden sm:block">Modified</div>
                            <div className="col-span-2" />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {filteredFiles.map((file) => {
                            const Icon = getFileIcon(file.type)
                            const accessible = isFileAccessible(file)
                            return (
                                <ContextMenu key={file.id}>
                                    <ContextMenuTrigger asChild>
                                        <div
                                            className={cn(
                                                "flex items-center gap-2 border-b border-border px-4 py-3 last:border-0 hover:bg-secondary sm:grid sm:grid-cols-12 sm:gap-4 sm:px-6",
                                                !accessible && "opacity-50"
                                            )}
                                        >
                                    <button
                                        type="button"
                                        className="flex min-w-0 flex-1 items-center gap-3 text-left sm:col-span-5"
                                        onClick={() => locateInFiles(file)}
                                        title={!accessible ? "Drive disconnected - file temporarily unavailable" : file.name}
                                    >
                                        <Icon className={cn("h-5 w-5 flex-shrink-0", getFileColor(file.type))} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex min-w-0 items-center gap-2">
                                                <span className="truncate text-sm font-medium text-card-foreground">
                                                    {file.name}
                                                </span>
                                                <Star className="h-4 w-4 flex-shrink-0 fill-yellow-400 text-yellow-400" />
                                            </div>
                                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:hidden">
                                                <span>{file.location || "My Files"}</span>
                                                <span>{file.type === "folder" ? "Folder" : formatFileSize(file.size)}</span>
                                            </div>
                                        </div>
                                    </button>
                                    <div className="hidden min-w-0 md:col-span-3 md:block">
                                        <p className="truncate text-sm text-muted-foreground">{file.location || "My Files"}</p>
                                    </div>
                                    <div className="hidden text-sm text-muted-foreground sm:col-span-2 sm:block">
                                        {formatDate(file.modified_at)}
                                    </div>
                                    <div className="flex flex-shrink-0 justify-end gap-1 sm:col-span-2">
                                        {file.type !== "folder" && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                disabled={!accessible}
                                                onClick={() => locateInFiles(file)}
                                                title="Locate in Files"
                                            >
                                                <ExternalLink className="h-4 w-4" />
                                            </Button>
                                        )}
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <MoreVertical className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => locateInFiles(file)}>
                                                    <ExternalLink className="mr-2 h-4 w-4" />
                                                    Locate in Files
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleDownload(file)} disabled={!accessible}>
                                                    <Download className="mr-2 h-4 w-4" />
                                                    {file.type === "folder" ? "Download ZIP" : "Download"}
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleUnstar(file)}>
                                                    <StarOff className="mr-2 h-4 w-4" />
                                                    Remove from starred
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(file)}>
                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                    Move to trash
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                        </div>
                                    </ContextMenuTrigger>
                                    <ContextMenuContent className="w-52">
                                        {renderStarredContextMenuItems(file)}
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
