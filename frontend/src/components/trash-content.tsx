"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
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
    Folder,
    FileText,
    ImageIcon,
    Video,
    Music,
    Archive,
    MoreVertical,
    Trash2,
    RotateCcw,
    Loader2,
    AlertTriangle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
    getTrash,
    restoreFile,
    permanentDeleteFile,
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
    }
    return colors[type] || "text-gray-400"
}

function formatFileSize(bytes: number): string {
    if (bytes === 0) return "—"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

function formatDate(dateString: string): string {
    const date = new Date(dateString)
    return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function TrashContent() {
    const [files, setFiles] = useState<FileItem[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Dialogs
    const [showDeleteDialog, setShowDeleteDialog] = useState(false)
    const [showEmptyDialog, setShowEmptyDialog] = useState(false)
    const [selectedItem, setSelectedItem] = useState<FileItem | null>(null)
    const [isProcessing, setIsProcessing] = useState(false)

    useEffect(() => {
        loadTrash()
    }, [])

    async function loadTrash() {
        setIsLoading(true)
        setError(null)
        try {
            const data = await getTrash()
            setFiles(data.files)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load trash")
        } finally {
            setIsLoading(false)
        }
    }

    async function handleRestore(file: FileItem) {
        setIsProcessing(true)
        try {
            await restoreFile(file.id)
            loadTrash()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Restore failed")
        } finally {
            setIsProcessing(false)
        }
    }

    function openDeleteDialog(file: FileItem) {
        setSelectedItem(file)
        setShowDeleteDialog(true)
    }

    async function handlePermanentDelete() {
        if (!selectedItem) return
        setIsProcessing(true)
        try {
            await permanentDeleteFile(selectedItem.id)
            setShowDeleteDialog(false)
            loadTrash()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Delete failed")
        } finally {
            setIsProcessing(false)
        }
    }

    async function handleEmptyTrash() {
        setIsProcessing(true)
        try {
            for (const file of files) {
                await permanentDeleteFile(file.id)
            }
            setShowEmptyDialog(false)
            loadTrash()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to empty trash")
        } finally {
            setIsProcessing(false)
        }
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold">Trash</h1>
                    <p className="text-muted-foreground text-xs sm:text-sm">
                        Items in trash will be permanently deleted after 30 days
                    </p>
                </div>
                {files.length > 0 && (
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setShowEmptyDialog(true)}
                        disabled={isProcessing}
                        className="w-full sm:w-auto"
                    >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Empty Trash
                    </Button>
                )}
            </div>

            {/* Error Message */}
            {error && (
                <Card className="bg-destructive/10 border-destructive">
                    <CardContent className="py-3">
                        <p className="text-sm text-destructive">{error}</p>
                    </CardContent>
                </Card>
            )}

            {/* Empty State */}
            {files.length === 0 && !isLoading && (
                <Card className="py-12">
                    <CardContent className="flex flex-col items-center justify-center text-center">
                        <Trash2 className="h-16 w-16 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-medium">Trash is empty</h3>
                        <p className="text-muted-foreground mt-1">
                            No files or folders in trash
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* Trash List */}
            {files.length > 0 && (
                <Card className="bg-card border-border overflow-hidden">
                    <CardHeader className="border-b border-border py-3 hidden sm:block">
                        <div className="grid grid-cols-12 gap-4 text-xs font-medium text-muted-foreground">
                            <div className="col-span-6 sm:col-span-5">Name</div>
                            <div className="col-span-2 hidden sm:block">Size</div>
                            <div className="col-span-3 hidden md:block">Deleted</div>
                            <div className="col-span-2" />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {files.map((file) => {
                            const Icon = getFileIcon(file.type)
                            return (
                                <div
                                    key={file.id}
                                    className="flex sm:grid sm:grid-cols-12 gap-2 sm:gap-4 items-center px-4 sm:px-6 py-3 border-b border-border last:border-0 hover:bg-secondary"
                                >
                                    <div className="flex-1 sm:col-span-6 md:col-span-5 flex items-center gap-2 sm:gap-3 min-w-0">
                                        <Icon className={cn("h-5 w-5 flex-shrink-0 opacity-50", getFileColor(file.type))} />
                                        <div className="min-w-0 flex-1">
                                            <span className="text-xs sm:text-sm font-medium text-card-foreground line-clamp-1 opacity-75" title={file.name}>
                                                {file.name}
                                            </span>
                                            <span className="text-xs text-muted-foreground sm:hidden">
                                                {formatFileSize(file.size)}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="hidden sm:block sm:col-span-2 text-sm text-muted-foreground">
                                        {formatFileSize(file.size)}
                                    </div>
                                    <div className="hidden md:block md:col-span-3 text-sm text-muted-foreground">
                                        {file.trashed_at ? formatDate(file.trashed_at) : "—"}
                                    </div>
                                    <div className="sm:col-span-2 flex justify-end gap-1 flex-shrink-0">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleRestore(file)}
                                            disabled={isProcessing}
                                        >
                                            <RotateCcw className="h-4 w-4 mr-1" />
                                            <span className="hidden sm:inline">Restore</span>
                                        </Button>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <MoreVertical className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => handleRestore(file)}>
                                                    <RotateCcw className="h-4 w-4 mr-2" />
                                                    Restore
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    className="text-destructive"
                                                    onClick={() => openDeleteDialog(file)}
                                                >
                                                    <Trash2 className="h-4 w-4 mr-2" />
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

            {/* Permanent Delete Confirmation */}
            <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-destructive" />
                            Delete permanently?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            "{selectedItem?.name}" will be permanently deleted. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isProcessing}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handlePermanentDelete}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={isProcessing}
                        >
                            {isProcessing ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : null}
                            Delete permanently
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Empty Trash Confirmation */}
            <AlertDialog open={showEmptyDialog} onOpenChange={setShowEmptyDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-destructive" />
                            Empty trash?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            All {files.length} item(s) in trash will be permanently deleted. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isProcessing}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleEmptyTrash}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={isProcessing}
                        >
                            {isProcessing ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : null}
                            Empty trash
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
