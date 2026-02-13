"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
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
    Clock,
    Search,
    Loader2,
    Download,
    Star,
    Trash2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
    getRecentFiles,
    downloadFile,
    toggleStar,
    deleteFile,
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

function formatRelativeTime(dateString: string): string {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return "Just now"
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
}

export function RecentContent() {
    const [files, setFiles] = useState<FileItem[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState("")

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

    async function handleDownload(file: FileItem) {
        try {
            await downloadFile(file.id, file.name)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Download failed")
        }
    }

    async function handleToggleStar(file: FileItem) {
        try {
            await toggleStar(file.id)
            loadRecent()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to toggle star")
        }
    }

    async function handleDelete(file: FileItem) {
        try {
            await deleteFile(file.id)
            loadRecent()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Delete failed")
        }
    }

    const filteredFiles = files.filter((f) =>
        f.name.toLowerCase().includes(searchQuery.toLowerCase())
    )

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
                    <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                        <Clock className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
                        Recent
                    </h1>
                    <p className="text-muted-foreground text-xs sm:text-sm">
                        Your recently modified files
                    </p>
                </div>
            </div>

            {/* Search */}
            {files.length > 0 && (
                <div className="relative max-w-md">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Search recent files..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                </div>
            )}

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
                        <Clock className="h-16 w-16 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-medium">No recent files</h3>
                        <p className="text-muted-foreground mt-1">
                            Files you upload or modify will appear here
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* Recent Files List */}
            {filteredFiles.length > 0 && (
                <Card className="bg-card border-border overflow-hidden">
                    <CardHeader className="border-b border-border py-3 hidden sm:block">
                        <div className="grid grid-cols-12 gap-4 text-xs font-medium text-muted-foreground">
                            <div className="col-span-5">Name</div>
                            <div className="col-span-2 hidden sm:block">Size</div>
                            <div className="col-span-3 hidden md:block">Modified</div>
                            <div className="col-span-2" />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {filteredFiles.map((file) => {
                            const Icon = getFileIcon(file.type)
                            return (
                                <div
                                    key={file.id}
                                    className="flex sm:grid sm:grid-cols-12 gap-2 sm:gap-4 items-center px-4 sm:px-6 py-3 border-b border-border last:border-0 hover:bg-secondary"
                                >
                                    <div className="flex-1 sm:col-span-5 flex items-center gap-2 sm:gap-3 min-w-0">
                                        <Icon className={cn("h-5 w-5 flex-shrink-0", getFileColor(file.type))} />
                                        <div className="min-w-0 flex-1">
                                            <span className="text-xs sm:text-sm font-medium text-card-foreground line-clamp-1" title={file.name}>
                                                {file.name}
                                            </span>
                                            <div className="flex items-center gap-2 sm:hidden">
                                                <span className="text-xs text-muted-foreground">
                                                    {formatFileSize(file.size)}
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                    · {file.modified_at ? formatRelativeTime(file.modified_at) : "—"}
                                                </span>
                                            </div>
                                        </div>
                                        {file.starred === 1 && (
                                            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400 flex-shrink-0" />
                                        )}
                                    </div>
                                    <div className="hidden sm:block sm:col-span-2 text-sm text-muted-foreground">
                                        {formatFileSize(file.size)}
                                    </div>
                                    <div className="hidden md:block md:col-span-3 text-sm text-muted-foreground">
                                        {file.modified_at ? formatRelativeTime(file.modified_at) : "—"}
                                    </div>
                                    <div className="sm:col-span-2 flex justify-end flex-shrink-0">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <MoreVertical className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => handleDownload(file)}>
                                                    <Download className="h-4 w-4 mr-2" />
                                                    Download
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleToggleStar(file)}>
                                                    <Star className="h-4 w-4 mr-2" />
                                                    {file.starred === 1 ? "Remove from starred" : "Add to starred"}
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem
                                                    className="text-destructive"
                                                    onClick={() => handleDelete(file)}
                                                >
                                                    <Trash2 className="h-4 w-4 mr-2" />
                                                    Move to trash
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
        </div>
    )
}
