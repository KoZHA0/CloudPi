"use client"

import { useState, useEffect, useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Folder,
    FileText,
    ImageIcon,
    Video,
    Music,
    Archive,
    Link2,
    Eye,
    Trash2,
    Loader2,
    ArrowUpRight,
    ArrowDownLeft,
    Download,
    ExternalLink,
    ChevronRight,
    ArrowLeft,
    FolderOpen,
    Search,
    SortAsc,
    SortDesc,
    Users2,
    UserX,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    getMyShares,
    getSharedWithMe,
    getShareAccess,
    revokeShare,
    revokeShareAccess,
    getSharedFolderFiles,
    downloadSharedFile,
    type ShareItem,
    type ShareAccessItem,
    type FileItem,
    type Breadcrumb,
} from "@/lib/api"

const API_BASE = "/api"

const getFileIcon = (type: string) => {
    const icons: Record<string, typeof FileText> = {
        folder: Folder,
        document: FileText,
        image: ImageIcon,
        video: Video,
        audio: Music,
        archive: Archive,
    }
    return icons[type] || FileText
}

const getFileColor = (type: string) => {
    const colors: Record<string, string> = {
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
    // SQLite CURRENT_TIMESTAMP is UTC but lacks 'Z' suffix
    const date = new Date(dateString.endsWith('Z') ? dateString : dateString + 'Z')
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

export function SharedContent() {
    const [tab, setTab] = useState<"my-shares" | "shared-with-me">("shared-with-me")
    const [myShares, setMyShares] = useState<ShareItem[]>([])
    const [sharedWithMe, setSharedWithMe] = useState<ShareItem[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [revokeTarget, setRevokeTarget] = useState<ShareItem | null>(null)
    const [manageAccessTarget, setManageAccessTarget] = useState<ShareItem | null>(null)
    const [accessList, setAccessList] = useState<ShareAccessItem[]>([])
    const [accessLoading, setAccessLoading] = useState(false)
    const [revokingUserId, setRevokingUserId] = useState<number | null>(null)

    // Search, sort, and group
    const [searchQuery, setSearchQuery] = useState("")
    const [sortKey, setSortKey] = useState<"name" | "date" | "size">("date")
    const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")
    const [groupBySender, setGroupBySender] = useState(false)

    // Shared folder browsing state
    const [browsingShare, setBrowsingShare] = useState<ShareItem | null>(null)
    const [browsingShareId, setBrowsingShareId] = useState<number | null>(null)
    const [folderFiles, setFolderFiles] = useState<FileItem[]>([])
    const [folderBreadcrumbs, setFolderBreadcrumbs] = useState<Breadcrumb[]>([])
    const [rootFolderId, setRootFolderId] = useState<number | null>(null)
    const [folderLoading, setFolderLoading] = useState(false)

    useEffect(() => {
        loadShares()
    }, [])

    async function loadShares() {
        setIsLoading(true)
        setError(null)
        try {
            const [myData, withMeData] = await Promise.all([
                getMyShares(),
                getSharedWithMe(),
            ])
            setMyShares(myData.shares)
            setSharedWithMe(withMeData.shares)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load shares")
        } finally {
            setIsLoading(false)
        }
    }

    async function handleRevoke() {
        if (!revokeTarget) return
        try {
            await revokeShare(revokeTarget.id)
            setRevokeTarget(null)
            loadShares()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to revoke share")
        }
    }

    async function openManageAccess(share: ShareItem) {
        setManageAccessTarget(share)
        setAccessList([])
        setAccessLoading(true)
        setError(null)
        try {
            const data = await getShareAccess(share.file_id)
            setAccessList(data.access)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load access list")
        } finally {
            setAccessLoading(false)
        }
    }

    async function handleRevokeAccess(userId: number) {
        if (!manageAccessTarget || revokingUserId !== null) return
        setRevokingUserId(userId)
        try {
            await revokeShareAccess(manageAccessTarget.file_id, userId)
            const data = await getShareAccess(manageAccessTarget.file_id)
            setAccessList(data.access)
            await loadShares()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to revoke access")
        } finally {
            setRevokingUserId(null)
        }
    }

    async function handleDownloadShared(share: ShareItem) {
        if (share.file_type === "folder") {
            // Download the whole shared folder as ZIP
            try {
                await downloadSharedFile(share.id, share.file_id, `${share.file_name}.zip`)
            } catch {
                window.open(`${API_BASE}/shares/public/${share.share_link}/download`, '_blank')
            }
        } else {
            window.open(`${API_BASE}/shares/public/${share.share_link}/download`, '_blank')
        }
    }

    // Open a shared folder for browsing
    async function openSharedFolder(share: ShareItem) {
        setBrowsingShare(share)
        setBrowsingShareId(share.id)
        setFolderLoading(true)
        setError(null)
        try {
            const data = await getSharedFolderFiles(share.id)
            setFolderFiles(data.files)
            setFolderBreadcrumbs(data.breadcrumbs)
            setRootFolderId(data.rootFolderId)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to open shared folder")
        } finally {
            setFolderLoading(false)
        }
    }

    // Navigate inside the shared folder
    async function navigateToSubfolder(folderId: number) {
        if (!browsingShareId) return
        setFolderLoading(true)
        try {
            const data = await getSharedFolderFiles(browsingShareId, folderId)
            setFolderFiles(data.files)
            setFolderBreadcrumbs(data.breadcrumbs)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load folder")
        } finally {
            setFolderLoading(false)
        }
    }

    // Navigate via breadcrumb (or root)
    async function navigateToBreadcrumb(folderId: number) {
        if (!browsingShareId) return
        if (folderId === rootFolderId) {
            setFolderLoading(true)
            try {
                const data = await getSharedFolderFiles(browsingShareId)
                setFolderFiles(data.files)
                setFolderBreadcrumbs(data.breadcrumbs)
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to load folder")
            } finally {
                setFolderLoading(false)
            }
        } else {
            navigateToSubfolder(folderId)
        }
    }

    // Download a file from inside the shared folder
    async function handleDownloadFolderFile(file: FileItem) {
        if (!browsingShareId) return
        try {
            const fileName = file.type === 'folder' ? `${file.name}.zip` : file.name
            await downloadSharedFile(browsingShareId, file.id, fileName)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Download failed")
        }
    }

    // Go back to share list
    function closeFolderBrowser() {
        setBrowsingShare(null)
        setBrowsingShareId(null)
        setFolderFiles([])
        setFolderBreadcrumbs([])
        setRootFolderId(null)
    }

    const rawList = tab === "my-shares" ? myShares : sharedWithMe

    const currentList = useMemo(() => {
        return rawList
            .filter(s => s.file_name.toLowerCase().includes(searchQuery.toLowerCase()))
            .sort((a, b) => {
                let cmp = 0
                switch (sortKey) {
                    case "name":
                        cmp = a.file_name.localeCompare(b.file_name)
                        break
                    case "date":
                        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                        break
                    case "size":
                        cmp = a.file_size - b.file_size
                        break
                }
                return sortDirection === "asc" ? cmp : -cmp
            })
    }, [rawList, searchQuery, sortKey, sortDirection])

    function handleShareSort(key: typeof sortKey) {
        if (sortKey === key) {
            setSortDirection(d => d === "asc" ? "desc" : "asc")
        } else {
            setSortKey(key)
            setSortDirection("asc")
        }
    }

    // Group shares by sender (for "shared-with-me") or recipient (for "my-shares")
    const groupedList = useMemo(() => {
        if (!groupBySender) return null
        const groups: Record<string, ShareItem[]> = {}
        for (const share of currentList) {
            const key = tab === "shared-with-me"
                ? (share.shared_by_name || "Unknown")
                : (share.shared_with_name || "Unknown")
            if (!groups[key]) groups[key] = []
            groups[key].push(share)
        }
        return groups
    }, [currentList, groupBySender, tab])

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    // ==========================================
    // SHARED FOLDER BROWSER VIEW
    // ==========================================
    if (browsingShare && browsingShareId) {
        return (
            <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={closeFolderBrowser}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                            <Folder className="h-6 w-6 text-blue-400" />
                            {browsingShare.file_name}
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            Shared by {browsingShare.shared_by_name}
                        </p>
                    </div>
                </div>

                {/* Breadcrumbs */}
                {folderBreadcrumbs.length > 0 && (
                    <div className="flex items-center gap-1 text-sm overflow-x-auto pb-2">
                        {folderBreadcrumbs.map((crumb, i) => (
                            <div key={crumb.id} className="flex items-center gap-1 flex-shrink-0">
                                {i > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => navigateToBreadcrumb(crumb.id)}
                                    className="truncate max-w-[150px]"
                                >
                                    {i === 0 ? <><FolderOpen className="h-4 w-4 mr-1" />{crumb.name}</> : crumb.name}
                                </Button>
                            </div>
                        ))}
                    </div>
                )}

                {error && (
                    <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg text-sm">
                        {error}
                    </div>
                )}

                {folderLoading ? (
                    <div className="flex items-center justify-center h-32">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                ) : folderFiles.length === 0 ? (
                    <Card className="bg-card border-border">
                        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                            <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
                            <h3 className="text-lg font-medium text-card-foreground">This folder is empty</h3>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-3">
                        {folderFiles.map((file) => {
                            const Icon = getFileIcon(file.type)
                            return (
                                <Card
                                    key={file.id}
                                    className={cn(
                                        "bg-card border-border cursor-pointer transition-colors hover:bg-secondary",
                                        file.type === "folder" && "hover:border-blue-500/30"
                                    )}
                                    onClick={() => {
                                        if (file.type === "folder") {
                                            navigateToSubfolder(file.id)
                                        }
                                    }}
                                >
                                    <CardContent className="p-4">
                                        <div className="flex items-center gap-3">
                                            <div className="rounded-lg bg-secondary p-2.5 shrink-0">
                                                <Icon className={cn("h-5 w-5", getFileColor(file.type))} />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="font-medium text-card-foreground truncate">
                                                    {file.name}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {formatFileSize(file.size)}
                                                    {file.modified_at && <> · {formatDate(file.modified_at)}</>}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {file.type !== "folder" && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="gap-1.5"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            handleDownloadFolderFile(file)
                                                        }}
                                                    >
                                                        <Download className="h-3.5 w-3.5" />
                                                        <span className="hidden sm:inline">Download</span>
                                                    </Button>
                                                )}
                                                {file.type === "folder" && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="gap-1.5"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            handleDownloadFolderFile(file)
                                                        }}
                                                    >
                                                        <Download className="h-3.5 w-3.5" />
                                                        <span className="hidden sm:inline">ZIP</span>
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            )
                        })}
                    </div>
                )}
            </div>
        )
    }

    // ==========================================
    // REUSABLE SHARE CARD RENDERER
    // ==========================================
    function renderShareCard(share: ShareItem) {
        const Icon = getFileIcon(share.file_type)
        return (
            <Card key={share.id} className="bg-card border-border">
                <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        {/* File info */}
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="rounded-lg bg-secondary p-2.5 shrink-0">
                                <Icon className={cn("h-5 w-5", getFileColor(share.file_type))} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="font-medium text-card-foreground truncate">
                                    {share.file_name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {formatFileSize(share.file_size)} · {formatDate(share.created_at)}
                                    {tab === "my-shares" && share.shared_with_name && (
                                        <> · Shared with <span className="font-medium text-card-foreground">{share.shared_with_name}</span></>
                                    )}
                                    {tab === "shared-with-me" && share.shared_by_name && !groupBySender && (
                                        <> · From <span className="font-medium text-card-foreground">{share.shared_by_name}</span></>
                                    )}
                                </p>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 ml-auto">
                            <Badge variant="secondary" className="bg-primary/10 text-primary border-0 shrink-0">
                                <Eye className="mr-1 h-3 w-3" />
                                {share.permission}
                            </Badge>

                            {tab === "shared-with-me" && (
                                <>
                                    {share.file_type === "folder" ? (
                                        <>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="gap-1.5"
                                                onClick={() => openSharedFolder(share)}
                                            >
                                                <FolderOpen className="h-3.5 w-3.5" />
                                                <span className="hidden sm:inline">Open</span>
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="gap-1.5"
                                                onClick={() => handleDownloadShared(share)}
                                            >
                                                <Download className="h-3.5 w-3.5" />
                                                <span className="hidden sm:inline">ZIP</span>
                                            </Button>
                                        </>
                                    ) : (
                                        <>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="gap-1.5"
                                                onClick={() => window.open(`${API_BASE}/shares/public/${share.share_link}/preview`, '_blank')}
                                            >
                                                <ExternalLink className="h-3.5 w-3.5" />
                                                <span className="hidden sm:inline">View</span>
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="gap-1.5"
                                                onClick={() => handleDownloadShared(share)}
                                            >
                                                <Download className="h-3.5 w-3.5" />
                                                <span className="hidden sm:inline">Download</span>
                                            </Button>
                                        </>
                                    )}
                                </>
                            )}

                            {tab === "my-shares" && (
                                <>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-1.5"
                                        onClick={() => openManageAccess(share)}
                                    >
                                        <Users2 className="h-3.5 w-3.5" />
                                        <span className="hidden sm:inline">Manage Access</span>
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-destructive hover:text-destructive"
                                        onClick={() => setRevokeTarget(share)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>
        )
    }

    // ==========================================
    // MAIN SHARES LIST VIEW
    // ==========================================
    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                        <Link2 className="h-6 w-6" />
                        Shared Files
                    </h1>
                    <p className="text-muted-foreground">Share files with other CloudPi users</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-secondary p-1 rounded-lg w-fit">
                <Button
                    variant={tab === "shared-with-me" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setTab("shared-with-me")}
                    className="gap-2"
                >
                    <ArrowDownLeft className="h-4 w-4" />
                    Shared with me
                    {sharedWithMe.length > 0 && (
                        <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                            {sharedWithMe.length}
                        </Badge>
                    )}
                </Button>
                <Button
                    variant={tab === "my-shares" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setTab("my-shares")}
                    className="gap-2"
                >
                    <ArrowUpRight className="h-4 w-4" />
                    My shares
                    {myShares.length > 0 && (
                        <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                            {myShares.length}
                        </Badge>
                    )}
                </Button>
            </div>

            {/* Search, Sort, and Group Controls */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Search shared files..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant={groupBySender ? "default" : "outline"}
                        size="sm"
                        className="gap-2"
                        onClick={() => setGroupBySender(!groupBySender)}
                    >
                        <Users2 className="h-4 w-4" />
                        <span className="hidden sm:inline">Group by {tab === "shared-with-me" ? "sender" : "recipient"}</span>
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon" title={`Sort by ${sortKey}`}>
                                {sortDirection === "asc" ? <SortAsc className="h-4 w-4" /> : <SortDesc className="h-4 w-4" />}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleShareSort("name")} className={cn(sortKey === "name" && "text-primary font-medium")}>
                                Name {sortKey === "name" && (sortDirection === "asc" ? "↑" : "↓")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleShareSort("date")} className={cn(sortKey === "date" && "text-primary font-medium")}>
                                Date shared {sortKey === "date" && (sortDirection === "asc" ? "↑" : "↓")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleShareSort("size")} className={cn(sortKey === "size" && "text-primary font-medium")}>
                                Size {sortKey === "size" && (sortDirection === "asc" ? "↑" : "↓")}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {error && (
                <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg text-sm">
                    {error}
                </div>
            )}

            {currentList.length === 0 && !error ? (
                <Card className="bg-card border-border">
                    <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                        <Link2 className="h-12 w-12 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-medium text-card-foreground">
                            {tab === "shared-with-me"
                                ? "No files shared with you"
                                : "You haven't shared any files"}
                        </h3>
                        <p className="text-muted-foreground mt-1 max-w-sm">
                            {tab === "shared-with-me"
                                ? searchQuery ? "No shared files match your search." : "When someone shares a file with you, it will appear here."
                                : searchQuery ? "No shared files match your search." : "Share a file from the Files page using the Share option in the file menu."}
                        </p>
                    </CardContent>
                </Card>
            ) : groupedList ? (
                /* Grouped view */
                <div className="space-y-6">
                    {Object.entries(groupedList).map(([groupName, shares]) => (
                        <div key={groupName}>
                            <div className="flex items-center gap-2 mb-3">
                                <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                                    {groupName.charAt(0).toUpperCase()}
                                </div>
                                <span className="text-sm font-semibold text-foreground">{groupName}</span>
                                <Badge variant="secondary" className="text-xs">{shares.length}</Badge>
                                <div className="flex-1 border-t border-border" />
                            </div>
                            <div className="grid gap-3">
                                {shares.map((share) => renderShareCard(share))}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                /* Flat list view */
                <div className="grid gap-3">
                    {currentList.map((share) => renderShareCard(share))}
                </div>
            )}

            {/* Manage Access Modal */}
            <Dialog
                open={!!manageAccessTarget}
                onOpenChange={(open) => {
                    if (!open) {
                        setManageAccessTarget(null)
                        setAccessList([])
                        setRevokingUserId(null)
                    }
                }}
            >
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Users2 className="h-5 w-5" />
                            Manage Access
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="text-sm text-muted-foreground">
                            File: <span className="text-foreground font-medium">"{manageAccessTarget?.file_name}"</span>
                        </div>

                        {accessLoading ? (
                            <div className="flex items-center justify-center py-10">
                                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                            </div>
                        ) : accessList.length === 0 ? (
                            <div className="rounded-lg border border-border p-8 text-center text-muted-foreground">
                                No users currently have access.
                            </div>
                        ) : (
                            <div className="space-y-2 max-h-72 overflow-y-auto">
                                {accessList.map((entry) => (
                                    <div key={entry.id} className="rounded-lg border border-border p-3 flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium truncate">{entry.shared_with_name || `User ${entry.shared_with}`}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {entry.permission} access · shared {formatDate(entry.created_at)}
                                            </p>
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="text-destructive hover:text-destructive"
                                            disabled={revokingUserId === entry.shared_with}
                                            onClick={() => handleRevokeAccess(entry.shared_with)}
                                        >
                                            {revokingUserId === entry.shared_with ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <>
                                                    <UserX className="h-4 w-4 mr-1.5" />
                                                    Revoke
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Revoke Confirmation */}
            <AlertDialog open={!!revokeTarget} onOpenChange={() => setRevokeTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Stop Sharing?</AlertDialogTitle>
                        <AlertDialogDescription>
                            "{revokeTarget?.file_name}" will no longer be shared with {revokeTarget?.shared_with_name || "this user"}.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleRevoke}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Stop Sharing
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
