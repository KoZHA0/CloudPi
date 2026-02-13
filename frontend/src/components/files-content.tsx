"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
    Folder,
    FileText,
    ImageIcon,
    Video,
    Music,
    Archive,
    MoreVertical,
    Grid3X3,
    List,
    SortAsc,
    Upload,
    FolderPlus,
    Download,
    Trash2,
    Star,
    Search,
    ChevronRight,
    Home,
    Loader2,
    Pencil,
    FolderOpen,
    Link2,
    Users,
    Check,
    AlertCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
    getFiles,
    createFolder,
    uploadFiles,
    downloadFile,
    renameFile,
    toggleStar,
    deleteFile,
    getPreviewUrl,
    createShareLink,
    getShareUsers,
    type FileItem,
    type Breadcrumb,
    type ShareUser,
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
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return "Today"
    if (diffDays === 1) return "Yesterday"
    if (diffDays < 7) return `${diffDays} days ago`
    return date.toLocaleDateString()
}

export function FilesContent() {
    const [view, setView] = useState<"grid" | "list">("grid")
    const [files, setFiles] = useState<FileItem[]>([])
    const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([])
    const [currentFolderId, setCurrentFolderId] = useState<number | null>(null)
    const [selectedFiles, setSelectedFiles] = useState<number[]>([])
    const [searchQuery, setSearchQuery] = useState("")
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Dialogs
    const [showNewFolderDialog, setShowNewFolderDialog] = useState(false)
    const [showRenameDialog, setShowRenameDialog] = useState(false)
    const [showDeleteDialog, setShowDeleteDialog] = useState(false)
    const [newFolderName, setNewFolderName] = useState("")
    const [renameValue, setRenameValue] = useState("")
    const [selectedItem, setSelectedItem] = useState<FileItem | null>(null)

    // Image preview
    const [previewFile, setPreviewFile] = useState<FileItem | null>(null)

    // Upload
    const [isUploading, setIsUploading] = useState(false)
    const [uploadProgress, setUploadProgress] = useState(0)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Drag and drop
    const [isDragging, setIsDragging] = useState(false)
    const dragCounter = useRef(0)

    // Share dialog
    const [showShareDialog, setShowShareDialog] = useState(false)
    const [shareFile, setShareFile] = useState<FileItem | null>(null)
    const [shareUsers, setShareUsers] = useState<ShareUser[]>([])
    const [shareLoading, setShareLoading] = useState(false)
    const [selectedShareUsers, setSelectedShareUsers] = useState<number[]>([])
    const [shareStatus, setShareStatus] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null)
    const [isSharing, setIsSharing] = useState(false)

    // Load files
    useEffect(() => {
        loadFiles()
    }, [currentFolderId])

    async function loadFiles() {
        setIsLoading(true)
        setError(null)
        try {
            const data = await getFiles(currentFolderId)
            setFiles(data.files)
            setBreadcrumbs(data.breadcrumbs)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load files")
        } finally {
            setIsLoading(false)
        }
    }

    const filteredFiles = files.filter((file) =>
        file.name.toLowerCase().includes(searchQuery.toLowerCase())
    )

    // Navigation
    function navigateToFolder(folderId: number | null) {
        setCurrentFolderId(folderId)
        setSelectedFiles([])
    }

    function handleFileClick(file: FileItem) {
        if (file.type === "folder") {
            navigateToFolder(file.id)
        }
    }

    // Selection
    function toggleFileSelection(id: number) {
        setSelectedFiles((prev) =>
            prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
        )
    }

    // Create folder
    async function handleCreateFolder() {
        if (!newFolderName.trim()) return
        try {
            await createFolder(newFolderName.trim(), currentFolderId)
            setNewFolderName("")
            setShowNewFolderDialog(false)
            loadFiles()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create folder")
        }
    }

    // Upload
    async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const fileList = e.target.files
        if (!fileList || fileList.length === 0) return

        setIsUploading(true)
        setUploadProgress(0)

        try {
            const filesArray = Array.from(fileList)
            // Simulate progress
            const progressInterval = setInterval(() => {
                setUploadProgress((prev) => Math.min(prev + 10, 90))
            }, 200)

            await uploadFiles(filesArray, currentFolderId)

            clearInterval(progressInterval)
            setUploadProgress(100)

            setTimeout(() => {
                setIsUploading(false)
                setUploadProgress(0)
                loadFiles()
            }, 500)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Upload failed")
            setIsUploading(false)
        }

        // Reset input
        if (fileInputRef.current) {
            fileInputRef.current.value = ""
        }
    }

    // Drag and drop handlers
    function handleDragEnter(e: React.DragEvent) {
        e.preventDefault()
        e.stopPropagation()
        dragCounter.current++
        if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
            setIsDragging(true)
        }
    }

    function handleDragLeave(e: React.DragEvent) {
        e.preventDefault()
        e.stopPropagation()
        dragCounter.current--
        if (dragCounter.current === 0) {
            setIsDragging(false)
        }
    }

    function handleDragOver(e: React.DragEvent) {
        e.preventDefault()
        e.stopPropagation()
    }

    async function handleDrop(e: React.DragEvent) {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)
        dragCounter.current = 0

        const droppedFiles = e.dataTransfer.files
        if (!droppedFiles || droppedFiles.length === 0) return

        setIsUploading(true)
        setUploadProgress(0)

        try {
            const filesArray = Array.from(droppedFiles)
            const progressInterval = setInterval(() => {
                setUploadProgress((prev) => Math.min(prev + 10, 90))
            }, 200)

            await uploadFiles(filesArray, currentFolderId)

            clearInterval(progressInterval)
            setUploadProgress(100)

            setTimeout(() => {
                setIsUploading(false)
                setUploadProgress(0)
                loadFiles()
            }, 500)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Upload failed")
            setIsUploading(false)
        }
    }

    // Download
    async function handleDownload(file: FileItem) {
        try {
            await downloadFile(file.id, file.name)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Download failed")
        }
    }

    // Share
    async function handleShare(file: FileItem) {
        setShareFile(file)
        setShowShareDialog(true)
        setShareLoading(true)
        setSelectedShareUsers([])
        setShareStatus(null)
        try {
            const data = await getShareUsers()
            setShareUsers(data.users)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load users")
        } finally {
            setShareLoading(false)
        }
    }

    function toggleShareUser(userId: number) {
        setSelectedShareUsers(prev =>
            prev.includes(userId)
                ? prev.filter(id => id !== userId)
                : [...prev, userId]
        )
        setShareStatus(null)
    }

    async function handleShareWithSelected() {
        if (!shareFile || selectedShareUsers.length === 0) return
        setIsSharing(true)
        setShareStatus(null)

        const results: string[] = []
        const alreadyShared: string[] = []
        let hadError = false

        for (const userId of selectedShareUsers) {
            try {
                const result = await createShareLink(shareFile.id, userId)
                if (result.message.includes('Already')) {
                    const user = shareUsers.find(u => u.id === userId)
                    alreadyShared.push(user?.username || 'user')
                } else {
                    const user = shareUsers.find(u => u.id === userId)
                    results.push(user?.username || 'user')
                }
            } catch {
                hadError = true
            }
        }

        setIsSharing(false)
        setSelectedShareUsers([])

        if (results.length > 0 && alreadyShared.length > 0) {
            setShareStatus({
                type: 'warning',
                message: `Shared with ${results.join(', ')}. Already shared with ${alreadyShared.join(', ')}.`
            })
        } else if (results.length > 0) {
            setShareStatus({
                type: 'success',
                message: `Successfully shared with ${results.join(', ')}!`
            })
        } else if (alreadyShared.length > 0) {
            setShareStatus({
                type: 'warning',
                message: `Already shared with ${alreadyShared.join(', ')}.`
            })
        } else if (hadError) {
            setShareStatus({
                type: 'error',
                message: 'Failed to share. Please try again.'
            })
        }
    }

    // Rename
    function openRenameDialog(file: FileItem) {
        setSelectedItem(file)
        setRenameValue(file.name)
        setShowRenameDialog(true)
    }

    async function handleRename() {
        if (!selectedItem || !renameValue.trim()) return
        try {
            await renameFile(selectedItem.id, renameValue.trim())
            setShowRenameDialog(false)
            loadFiles()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Rename failed")
        }
    }

    // Star
    async function handleToggleStar(file: FileItem) {
        try {
            await toggleStar(file.id)
            loadFiles()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update star")
        }
    }

    // Delete
    function openDeleteDialog(file: FileItem) {
        setSelectedItem(file)
        setShowDeleteDialog(true)
    }

    async function handleDelete() {
        if (!selectedItem) return
        try {
            await deleteFile(selectedItem.id)
            setShowDeleteDialog(false)
            loadFiles()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Delete failed")
        }
    }

    // Bulk delete
    async function handleBulkDelete() {
        try {
            for (const id of selectedFiles) {
                await deleteFile(id)
            }
            setSelectedFiles([])
            loadFiles()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Delete failed")
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
        <div
            className="space-y-6 relative"
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {/* Drag & Drop Overlay */}
            {isDragging && (
                <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
                    <div className="border-2 border-dashed border-primary rounded-2xl p-16 text-center animate-pulse">
                        <Upload className="h-16 w-16 mx-auto mb-4 text-primary" />
                        <p className="text-xl font-semibold text-primary">Drop files here to upload</p>
                        <p className="text-sm text-muted-foreground mt-2">Files will be uploaded to the current folder</p>
                    </div>
                </div>
            )}
            {/* Breadcrumb Navigation */}
            <div className="flex items-center gap-1 sm:gap-2 text-sm overflow-x-auto pb-2">
                <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 sm:gap-2 flex-shrink-0"
                    onClick={() => navigateToFolder(null)}
                >
                    <Home className="h-4 w-4" />
                    <span className="hidden sm:inline">My Files</span>
                </Button>
                {breadcrumbs.map((crumb) => (
                    <div key={crumb.id} className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                        <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigateToFolder(crumb.id)}
                            className="truncate max-w-[100px] sm:max-w-none"
                        >
                            {crumb.name}
                        </Button>
                    </div>
                ))}
            </div>

            {/* Header Actions */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Search files..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setShowNewFolderDialog(true)}
                    >
                        <FolderPlus className="h-4 w-4" />
                    </Button>
                    <input
                        type="file"
                        multiple
                        ref={fileInputRef}
                        onChange={handleUpload}
                        className="hidden"
                    />
                    <Button
                        className="gap-2"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                    >
                        {isUploading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Upload className="h-4 w-4" />
                        )}
                        Upload
                    </Button>
                    <div className="flex items-center border border-border rounded-lg">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setView("grid")}
                            className={cn(view === "grid" && "bg-secondary")}
                        >
                            <Grid3X3 className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setView("list")}
                            className={cn(view === "list" && "bg-secondary")}
                        >
                            <List className="h-4 w-4" />
                        </Button>
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon">
                                <SortAsc className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem>Name</DropdownMenuItem>
                            <DropdownMenuItem>Date modified</DropdownMenuItem>
                            <DropdownMenuItem>Size</DropdownMenuItem>
                            <DropdownMenuItem>Type</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Upload Progress */}
            {isUploading && (
                <Card className="bg-secondary">
                    <CardContent className="py-4">
                        <div className="flex items-center gap-4">
                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                            <div className="flex-1">
                                <p className="text-sm font-medium">Uploading files...</p>
                                <Progress value={uploadProgress} className="mt-2" />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Error Message */}
            {error && (
                <Card className="bg-destructive/10 border-destructive">
                    <CardContent className="py-3">
                        <p className="text-sm text-destructive">{error}</p>
                    </CardContent>
                </Card>
            )}

            {/* Selected Actions */}
            {selectedFiles.length > 0 && (
                <Card className="bg-secondary border-border">
                    <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3">
                        <span className="text-sm text-secondary-foreground">
                            {selectedFiles.length} item(s) selected
                        </span>
                        <div className="flex items-center gap-2 flex-wrap">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="gap-2 text-destructive"
                                onClick={handleBulkDelete}
                            >
                                <Trash2 className="h-4 w-4" />
                                <span className="hidden xs:inline">Delete</span>
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Empty State */}
            {filteredFiles.length === 0 && !isLoading && (
                <Card className="py-12">
                    <CardContent className="flex flex-col items-center justify-center text-center">
                        <FolderOpen className="h-16 w-16 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-medium">No files yet</h3>
                        <p className="text-muted-foreground mt-1">
                            Upload files or create a folder to get started
                        </p>
                        <div className="flex gap-2 mt-4">
                            <Button
                                variant="outline"
                                onClick={() => setShowNewFolderDialog(true)}
                            >
                                <FolderPlus className="h-4 w-4 mr-2" />
                                New Folder
                            </Button>
                            <Button onClick={() => fileInputRef.current?.click()}>
                                <Upload className="h-4 w-4 mr-2" />
                                Upload Files
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Files Grid */}
            {view === "grid" && filteredFiles.length > 0 && (
                <div className="grid gap-3 grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {filteredFiles.map((file) => {
                        const Icon = getFileIcon(file.type)
                        return (
                            <Card
                                key={file.id}
                                className={cn(
                                    "group relative cursor-pointer transition-colors hover:bg-secondary",
                                    selectedFiles.includes(file.id) && "ring-2 ring-primary"
                                )}
                                onDoubleClick={() => handleFileClick(file)}
                            >
                                <CardContent className="p-4">
                                    <div className="absolute left-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Checkbox
                                            checked={selectedFiles.includes(file.id)}
                                            onCheckedChange={() => toggleFileSelection(file.id)}
                                        />
                                    </div>
                                    <div className="absolute right-2 top-2 flex items-center gap-1">
                                        {file.starred === 1 && (
                                            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                                        )}
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 sm:opacity-0 sm:group-hover:opacity-100"
                                                >
                                                    <MoreVertical className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                {file.type === "folder" ? (
                                                    <DropdownMenuItem onClick={() => handleFileClick(file)}>
                                                        Open
                                                    </DropdownMenuItem>
                                                ) : (
                                                    <DropdownMenuItem onClick={() => handleDownload(file)}>
                                                        <Download className="h-4 w-4 mr-2" />
                                                        Download
                                                    </DropdownMenuItem>
                                                )}
                                                <DropdownMenuItem onClick={() => openRenameDialog(file)}>
                                                    <Pencil className="h-4 w-4 mr-2" />
                                                    Rename
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleToggleStar(file)}>
                                                    <Star className="h-4 w-4 mr-2" />
                                                    {file.starred ? "Unstar" : "Star"}
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleShare(file)}>
                                                    <Link2 className="h-4 w-4 mr-2" />
                                                    Share
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem
                                                    className="text-destructive"
                                                    onClick={() => openDeleteDialog(file)}
                                                >
                                                    <Trash2 className="h-4 w-4 mr-2" />
                                                    Delete
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                    <div
                                        className="flex flex-col items-center pt-4"
                                        onClick={() => {
                                            if (file.type === "folder") handleFileClick(file)
                                            else if (file.type === "image") setPreviewFile(file)
                                        }}
                                    >
                                        {file.type === "image" ? (
                                            <div className="w-full h-20 sm:h-24 mb-2 sm:mb-3 rounded overflow-hidden bg-secondary flex items-center justify-center">
                                                <img
                                                    src={getPreviewUrl(file.id)}
                                                    alt={file.name}
                                                    className="w-full h-full object-cover"
                                                    loading="lazy"
                                                    onError={(e) => {
                                                        // If image fails to load, replace with icon
                                                        const target = e.target as HTMLImageElement
                                                        target.style.display = 'none'
                                                        const parent = target.parentElement
                                                        if (parent) {
                                                            parent.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-400"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>'
                                                        }
                                                    }}
                                                />
                                            </div>
                                        ) : (
                                            <Icon className={cn("h-10 w-10 sm:h-12 sm:w-12 mb-2 sm:mb-3", getFileColor(file.type))} />
                                        )}
                                        <p className="text-xs sm:text-sm font-medium text-card-foreground text-center line-clamp-2 w-full px-1" title={file.name}>
                                            {file.name}
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            {formatFileSize(file.size)}
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            )}

            {/* Files List */}
            {view === "list" && filteredFiles.length > 0 && (
                <Card className="bg-card border-border overflow-hidden">
                    <CardHeader className="border-b border-border py-3 hidden sm:block">
                        <div className="grid grid-cols-12 gap-4 text-xs font-medium text-muted-foreground">
                            <div className="col-span-1">
                                <Checkbox />
                            </div>
                            <div className="col-span-6 sm:col-span-5">Name</div>
                            <div className="col-span-2 hidden sm:block">Size</div>
                            <div className="col-span-3 hidden md:block">Modified</div>
                            <div className="col-span-1" />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {filteredFiles.map((file) => {
                            const Icon = getFileIcon(file.type)
                            return (
                                <div
                                    key={file.id}
                                    className={cn(
                                        "flex sm:grid sm:grid-cols-12 gap-2 sm:gap-4 items-center px-4 sm:px-6 py-3 border-b border-border last:border-0 hover:bg-secondary cursor-pointer",
                                        selectedFiles.includes(file.id) && "bg-secondary"
                                    )}
                                    onDoubleClick={() => handleFileClick(file)}
                                >
                                    <div className="sm:col-span-1 flex-shrink-0">
                                        <Checkbox
                                            checked={selectedFiles.includes(file.id)}
                                            onCheckedChange={() => toggleFileSelection(file.id)}
                                        />
                                    </div>
                                    <div
                                        className="flex-1 sm:col-span-6 md:col-span-5 flex items-center gap-3 min-w-0"
                                        onClick={() => file.type === "folder" && handleFileClick(file)}
                                    >
                                        <Icon className={cn("h-5 w-5 flex-shrink-0", getFileColor(file.type))} />
                                        <div className="min-w-0 flex-1">
                                            <span className="text-sm font-medium text-card-foreground truncate block">
                                                {file.name}
                                            </span>
                                            <span className="text-xs text-muted-foreground sm:hidden">
                                                {formatFileSize(file.size)}
                                            </span>
                                        </div>
                                        {file.starred === 1 && (
                                            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400 flex-shrink-0" />
                                        )}
                                    </div>
                                    <div className="hidden sm:block sm:col-span-2 text-sm text-muted-foreground">
                                        {formatFileSize(file.size)}
                                    </div>
                                    <div className="hidden md:block md:col-span-3 text-sm text-muted-foreground">
                                        {formatDate(file.modified_at)}
                                    </div>
                                    <div className="sm:col-span-1 flex justify-end flex-shrink-0">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <MoreVertical className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                {file.type === "folder" ? (
                                                    <DropdownMenuItem onClick={() => handleFileClick(file)}>
                                                        Open
                                                    </DropdownMenuItem>
                                                ) : (
                                                    <DropdownMenuItem onClick={() => handleDownload(file)}>
                                                        <Download className="h-4 w-4 mr-2" />
                                                        Download
                                                    </DropdownMenuItem>
                                                )}
                                                <DropdownMenuItem onClick={() => openRenameDialog(file)}>
                                                    <Pencil className="h-4 w-4 mr-2" />
                                                    Rename
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleToggleStar(file)}>
                                                    <Star className="h-4 w-4 mr-2" />
                                                    {file.starred ? "Unstar" : "Star"}
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleShare(file)}>
                                                    <Link2 className="h-4 w-4 mr-2" />
                                                    Share
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem
                                                    className="text-destructive"
                                                    onClick={() => openDeleteDialog(file)}
                                                >
                                                    <Trash2 className="h-4 w-4 mr-2" />
                                                    Delete
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

            {/* New Folder Dialog */}
            <Dialog open={showNewFolderDialog} onOpenChange={setShowNewFolderDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create New Folder</DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        <Label htmlFor="folderName">Folder name</Label>
                        <Input
                            id="folderName"
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            placeholder="Enter folder name"
                            className="mt-2"
                            onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowNewFolderDialog(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
                            Create
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Rename Dialog */}
            <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Rename {selectedItem?.type === "folder" ? "Folder" : "File"}</DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        <Label htmlFor="renameName">New name</Label>
                        <Input
                            id="renameName"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            className="mt-2"
                            onKeyDown={(e) => e.key === "Enter" && handleRename()}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowRenameDialog(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleRename} disabled={!renameValue.trim()}>
                            Rename
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Move to Trash?</AlertDialogTitle>
                        <AlertDialogDescription>
                            "{selectedItem?.name}" will be moved to trash. You can restore it later from the Trash page.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Image Preview Lightbox */}
            {previewFile && (
                <div
                    className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
                    onClick={() => setPreviewFile(null)}
                >
                    <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={(e) => {
                                e.stopPropagation()
                                handleDownload(previewFile)
                            }}
                        >
                            <Download className="h-4 w-4 mr-2" />
                            Download
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setPreviewFile(null)}
                        >
                            ✕
                        </Button>
                    </div>
                    <img
                        src={getPreviewUrl(previewFile.id)}
                        alt={previewFile.name}
                        className="max-w-full max-h-[90vh] object-contain rounded-lg"
                        onClick={(e) => e.stopPropagation()}
                    />
                    <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white text-sm bg-black/50 px-4 py-2 rounded-full">
                        {previewFile.name}
                    </p>
                </div>
            )}
            {/* Share Dialog */}
            <Dialog open={showShareDialog} onOpenChange={(open) => {
                setShowShareDialog(open)
                if (!open) {
                    setShareStatus(null)
                    setSelectedShareUsers([])
                }
            }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Users className="h-5 w-5" />
                            Share "{shareFile?.name}"
                        </DialogTitle>
                    </DialogHeader>

                    {/* Status message */}
                    {shareStatus && (
                        <div className={cn(
                            "flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm",
                            shareStatus.type === 'success' && "bg-green-500/10 text-green-500",
                            shareStatus.type === 'warning' && "bg-amber-500/10 text-amber-500",
                            shareStatus.type === 'error' && "bg-destructive/10 text-destructive",
                        )}>
                            {shareStatus.type === 'success' ? (
                                <Check className="h-4 w-4 shrink-0" />
                            ) : (
                                <AlertCircle className="h-4 w-4 shrink-0" />
                            )}
                            {shareStatus.message}
                        </div>
                    )}

                    {/* User list */}
                    <div className="space-y-1 max-h-60 overflow-y-auto">
                        {shareLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                            </div>
                        ) : shareUsers.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground">
                                <Users className="h-10 w-10 mx-auto mb-2 opacity-50" />
                                <p>No other users found</p>
                                <p className="text-xs mt-1">Create more users from the Admin panel</p>
                            </div>
                        ) : (
                            shareUsers.map((user) => (
                                <div
                                    key={user.id}
                                    className={cn(
                                        "flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors",
                                        selectedShareUsers.includes(user.id)
                                            ? "bg-primary/10 border border-primary/20"
                                            : "hover:bg-secondary"
                                    )}
                                    onClick={() => toggleShareUser(user.id)}
                                >
                                    <Checkbox
                                        checked={selectedShareUsers.includes(user.id)}
                                        onCheckedChange={() => toggleShareUser(user.id)}
                                        className="shrink-0"
                                    />
                                    <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-sm shrink-0">
                                        {user.username.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium">{user.username}</p>
                                        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Share button */}
                    {shareUsers.length > 0 && (
                        <DialogFooter>
                            <Button
                                onClick={handleShareWithSelected}
                                disabled={selectedShareUsers.length === 0 || isSharing}
                                className="w-full gap-2"
                            >
                                {isSharing ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Link2 className="h-4 w-4" />
                                )}
                                {isSharing
                                    ? "Sharing..."
                                    : selectedShareUsers.length === 0
                                        ? "Select users to share"
                                        : `Share with ${selectedShareUsers.length} user${selectedShareUsers.length > 1 ? 's' : ''}`
                                }
                            </Button>
                        </DialogFooter>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}
