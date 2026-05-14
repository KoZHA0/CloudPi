"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
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
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"
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
    FolderPlus,
    Search,
    Users2,
    UserX,
    Activity,
    MoreHorizontal,
    ShieldCheck,
    CalendarClock,
    RefreshCw,
    X,
} from "lucide-react"
import { cn, formatApiDate, formatApiDateTime, parseApiDate } from "@/lib/utils"
import {
    getMyShares,
    getSharedWithMe,
    revokeShare,
    getSharedFolderFiles,
    downloadSharedFile,
    downloadIncomingShare,
    getIncomingSharePreviewUrl,
    getShareActivity,
    updateShare,
    bulkShareAction,
    leaveShare,
    addShareShortcut,
    removeShareShortcut,
    type ShareItem,
    type ShareActivityItem,
    type FileItem,
    type Breadcrumb,
    type SharePermission,
} from "@/lib/api"

type SharesTab = "outgoing" | "incoming"
type SortKey = "date" | "expiry" | "name" | "accessed"
type ConfirmAction = "revoke" | "leave"

const getFileIcon = (type: string) => {
    const icons: Record<string, typeof FileText> = {
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

const getFileColor = (type: string) => {
    const colors: Record<string, string> = {
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
    const sizes = ["B", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

function parseDate(dateString?: string | null) {
    return parseApiDate(dateString)
}

function formatDate(dateString?: string | null): string {
    return formatApiDate(dateString, { month: "short", day: "numeric", year: "numeric" })
}

function formatDateTime(dateString?: string | null): string {
    return formatApiDateTime(dateString)
}

function isExpired(share: ShareItem) {
    if (share.is_expired) return true
    const expiry = parseDate(share.expires_at)
    return expiry ? expiry.getTime() <= Date.now() : false
}

function isExpiringSoon(share: ShareItem) {
    const expiry = parseDate(share.expires_at)
    if (!expiry || isExpired(share)) return false
    const days = (expiry.getTime() - Date.now()) / 86400000
    return days <= 7
}

function permissionLabel(permission: SharePermission | string) {
    const labels: Record<string, string> = {
        view: "View only",
        comment: "Can comment",
        edit: "Can edit/download",
        upload: "Upload only",
    }
    return labels[permission] || permission
}

export function SharedContent() {
    const location = useLocation()
    const navigate = useNavigate()
    const { shareId } = useParams<{ shareId?: string }>()

    const [tab, setTab] = useState<SharesTab>(location.pathname.includes("/incoming") ? "incoming" : "outgoing")
    const [myShares, setMyShares] = useState<ShareItem[]>([])
    const [sharedWithMe, setSharedWithMe] = useState<ShareItem[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [searchQuery, setSearchQuery] = useState("")
    const [shareTypeFilter, setShareTypeFilter] = useState("all")
    const [permissionFilter, setPermissionFilter] = useState("all")
    const [statusFilter, setStatusFilter] = useState("all")
    const [fileTypeFilter, setFileTypeFilter] = useState("all")
    const [sortKey, setSortKey] = useState<SortKey>("date")

    const [selectedShares, setSelectedShares] = useState<number[]>([])
    const [bulkPermission, setBulkPermission] = useState<SharePermission>("view")
    const [busy, setBusy] = useState(false)

    const [confirmTarget, setConfirmTarget] = useState<{ share: ShareItem; action: ConfirmAction } | null>(null)
    const [activityTarget, setActivityTarget] = useState<ShareItem | null>(null)
    const [activityLogs, setActivityLogs] = useState<ShareActivityItem[]>([])
    const [activityLoading, setActivityLoading] = useState(false)

    const [browsingShare, setBrowsingShare] = useState<ShareItem | null>(null)
    const [folderFiles, setFolderFiles] = useState<FileItem[]>([])
    const [folderBreadcrumbs, setFolderBreadcrumbs] = useState<Breadcrumb[]>([])
    const [rootFolderId, setRootFolderId] = useState<number | null>(null)
    const [folderLoading, setFolderLoading] = useState(false)
    const [previewShare, setPreviewShare] = useState<ShareItem | null>(null)
    const [previewTextContent, setPreviewTextContent] = useState<string | null>(null)
    const [previewLoading, setPreviewLoading] = useState(false)
    const [previewError, setPreviewError] = useState<string | null>(null)

    useEffect(() => {
        setTab(location.pathname.includes("/incoming") ? "incoming" : "outgoing")
    }, [location.pathname])

    useEffect(() => {
        loadShares()
    }, [])

    useEffect(() => {
        if (!shareId || myShares.length === 0) return
        const target = myShares.find((share) => String(share.id) === shareId)
        if (target && activityTarget?.id !== target.id) {
            openActivity(target)
        }
    }, [shareId, myShares, activityTarget?.id])

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

    function switchTab(next: SharesTab) {
        setSelectedShares([])
        setTab(next)
        navigate(next === "outgoing" ? "/shares/outgoing" : "/shares/incoming")
    }

    const stats = useMemo(() => {
        const active = myShares.filter((share) => !isExpired(share)).length
        const expired = myShares.length - active
        const links = myShares.filter((share) => share.share_type === "link").length
        const protectedLinks = myShares.filter((share) => share.password_protected).length
        return { active, expired, links, protectedLinks }
    }, [myShares])

    const currentList = useMemo(() => {
        const source = tab === "outgoing" ? myShares : sharedWithMe
        return source
            .filter((share) => share.file_name.toLowerCase().includes(searchQuery.toLowerCase()))
            .filter((share) => shareTypeFilter === "all" || share.share_type === shareTypeFilter)
            .filter((share) => permissionFilter === "all" || share.permission === permissionFilter)
            .filter((share) => statusFilter === "all" || (statusFilter === "expired" ? isExpired(share) : !isExpired(share)))
            .filter((share) => fileTypeFilter === "all" || share.file_type === fileTypeFilter)
            .sort((a, b) => {
                if (sortKey === "name") return a.file_name.localeCompare(b.file_name)
                if (sortKey === "expiry") {
                    const aTime = parseDate(a.expires_at)?.getTime() ?? Number.MAX_SAFE_INTEGER
                    const bTime = parseDate(b.expires_at)?.getTime() ?? Number.MAX_SAFE_INTEGER
                    return aTime - bTime
                }
                if (sortKey === "accessed") return (b.access_count || 0) - (a.access_count || 0)
                return (parseDate(b.created_at)?.getTime() || 0) - (parseDate(a.created_at)?.getTime() || 0)
            })
    }, [tab, myShares, sharedWithMe, searchQuery, shareTypeFilter, permissionFilter, statusFilter, fileTypeFilter, sortKey])

    function toggleSelected(shareIdValue: number) {
        setSelectedShares((current) =>
            current.includes(shareIdValue)
                ? current.filter((id) => id !== shareIdValue)
                : [...current, shareIdValue]
        )
    }

    async function handleConfirmAction() {
        if (!confirmTarget) return
        setBusy(true)
        setError(null)
        try {
            if (confirmTarget.action === "revoke") {
                await revokeShare(confirmTarget.share.id)
            } else {
                await leaveShare(confirmTarget.share.id)
            }
            setConfirmTarget(null)
            await loadShares()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Action failed")
        } finally {
            setBusy(false)
        }
    }

    async function handlePermissionChange(share: ShareItem, permission: SharePermission) {
        setBusy(true)
        try {
            await updateShare(share.id, { permission })
            await loadShares()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update share")
        } finally {
            setBusy(false)
        }
    }

    async function handleDownloadToggle(share: ShareItem, allowDownload: boolean) {
        setBusy(true)
        try {
            await updateShare(share.id, { allowDownload })
            await loadShares()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update share")
        } finally {
            setBusy(false)
        }
    }

    async function extendShare(share: ShareItem, days = 7) {
        const expiry = new Date(Date.now() + days * 86400000).toISOString()
        setBusy(true)
        try {
            await updateShare(share.id, { expiresAt: expiry })
            await loadShares()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to extend share")
        } finally {
            setBusy(false)
        }
    }

    async function handleBulkRevoke() {
        if (selectedShares.length === 0) return
        setBusy(true)
        try {
            await bulkShareAction(selectedShares, "revoke")
            setSelectedShares([])
            await loadShares()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to revoke shares")
        } finally {
            setBusy(false)
        }
    }

    async function handleBulkPermission() {
        if (selectedShares.length === 0) return
        const userShareIds = selectedShares.filter((id) => myShares.find((share) => share.id === id)?.share_type !== "link")
        if (userShareIds.length === 0) {
            setError("Legacy link shares can only be revoked.")
            return
        }
        setBusy(true)
        try {
            await bulkShareAction(userShareIds, "update", { permission: bulkPermission })
            setSelectedShares([])
            await loadShares()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update shares")
        } finally {
            setBusy(false)
        }
    }

    async function handleBulkExtend() {
        if (selectedShares.length === 0) return
        const userShareIds = selectedShares.filter((id) => myShares.find((share) => share.id === id)?.share_type !== "link")
        if (userShareIds.length === 0) {
            setError("Legacy link shares can only be revoked.")
            return
        }
        setBusy(true)
        try {
            await bulkShareAction(userShareIds, "update", {
                expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
            })
            setSelectedShares([])
            await loadShares()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to extend shares")
        } finally {
            setBusy(false)
        }
    }

    async function openActivity(share: ShareItem) {
        setActivityTarget(share)
        setActivityLogs([])
        setActivityLoading(true)
        try {
            const data = await getShareActivity(share.id)
            setActivityLogs(data.logs)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load activity")
        } finally {
            setActivityLoading(false)
        }
    }

    function closeActivity() {
        setActivityTarget(null)
        setActivityLogs([])
        if (shareId) navigate("/shares/outgoing")
    }

    async function openSharedFolder(share: ShareItem) {
        setBrowsingShare(share)
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

    async function navigateToSharedFolder(folderId?: number) {
        if (!browsingShare) return
        setFolderLoading(true)
        try {
            const data = await getSharedFolderFiles(browsingShare.id, folderId)
            setFolderFiles(data.files)
            setFolderBreadcrumbs(data.breadcrumbs)
            setRootFolderId(data.rootFolderId)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load folder")
        } finally {
            setFolderLoading(false)
        }
    }

    async function downloadIncoming(share: ShareItem) {
        const name = share.file_type === "folder" ? `${share.file_name}.zip` : share.file_name
        try {
            await downloadIncomingShare(share.id, name)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Download failed")
        }
    }

    async function toggleMyFilesShortcut(share: ShareItem) {
        setBusy(true)
        setError(null)
        try {
            if (share.shortcut_id) {
                await removeShareShortcut(share.id)
            } else {
                await addShareShortcut(share.id)
            }
            await loadShares()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update shortcut")
        } finally {
            setBusy(false)
        }
    }

    async function openIncomingPreview(share: ShareItem) {
        if (share.file_type === "folder" || share.permission === "upload") return
        setPreviewShare(share)
        setPreviewTextContent(null)
        setPreviewError(null)

        if (share.file_type === "document" && !share.mime_type?.includes("pdf")) {
            setPreviewLoading(true)
            try {
                const response = await fetch(getIncomingSharePreviewUrl(share.id))
                if (!response.ok) throw new Error("Failed to load preview")
                setPreviewTextContent(await response.text())
            } catch (err) {
                setPreviewError(err instanceof Error ? err.message : "Failed to load preview")
            } finally {
                setPreviewLoading(false)
            }
        }
    }

    function closeIncomingPreview() {
        setPreviewShare(null)
        setPreviewTextContent(null)
        setPreviewError(null)
        setPreviewLoading(false)
    }

    async function downloadFolderFile(file: FileItem) {
        if (!browsingShare) return
        try {
            const name = file.type === "folder" ? `${file.name}.zip` : file.name
            await downloadSharedFile(browsingShare.id, file.id, name)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Download failed")
        }
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    if (browsingShare) {
        return (
            <div className="space-y-6">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={() => setBrowsingShare(null)}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                            <Folder className="h-6 w-6 text-blue-400" />
                            {browsingShare.file_name}
                        </h1>
                        <p className="text-sm text-muted-foreground">Shared by {browsingShare.shared_by_name}</p>
                    </div>
                </div>

                {folderBreadcrumbs.length > 0 && (
                    <div className="flex items-center gap-1 overflow-x-auto pb-2 text-sm">
                        {folderBreadcrumbs.map((crumb, index) => (
                            <div key={crumb.id} className="flex items-center gap-1 shrink-0">
                                {index > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => navigateToSharedFolder(crumb.id === rootFolderId ? undefined : crumb.id)}
                                    className="max-w-[180px] truncate"
                                >
                                    {index === 0 && <FolderOpen className="mr-1 h-4 w-4" />}
                                    {crumb.name}
                                </Button>
                            </div>
                        ))}
                    </div>
                )}

                {error && <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

                {folderLoading ? (
                    <div className="flex h-32 items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                ) : folderFiles.length === 0 ? (
                    <div className="rounded-lg border border-border py-16 text-center">
                        <FolderOpen className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                        <h3 className="text-lg font-medium">This folder is empty</h3>
                    </div>
                ) : (
                    <div className="grid gap-3">
                        {folderFiles.map((file) => {
                            const Icon = getFileIcon(file.type)
                            return (
                                <div
                                    key={file.id}
                                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-4 transition-colors hover:bg-secondary"
                                    onClick={() => file.type === "folder" && navigateToSharedFolder(file.id)}
                                >
                                    <div className="rounded-lg bg-secondary p-2.5">
                                        <Icon className={cn("h-5 w-5", getFileColor(file.type))} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate font-medium">{file.name}</p>
                                        <p className="text-xs text-muted-foreground">{formatFileSize(file.size)} - {formatDate(file.modified_at)}</p>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-2"
                                        onClick={(event) => {
                                            event.stopPropagation()
                                            downloadFolderFile(file)
                                        }}
                                    >
                                        <Download className="h-3.5 w-3.5" />
                                        {file.type === "folder" ? "ZIP" : "Download"}
                                    </Button>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        )
    }

    function renderShareCard(share: ShareItem) {
        const Icon = getFileIcon(share.file_type)
        const expired = isExpired(share)
        const linkShare = share.share_type === "link"
        const canDownload = share.allow_download !== 0

        return (
            <div key={share.id} className={cn("rounded-lg border border-border p-4", expired && "bg-secondary/40 opacity-75")}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                        {tab === "outgoing" && (
                            <Checkbox
                                checked={selectedShares.includes(share.id)}
                                onCheckedChange={() => toggleSelected(share.id)}
                                className="mt-2"
                            />
                        )}
                        <div className="rounded-lg bg-secondary p-2.5">
                            <Icon className={cn("h-5 w-5", getFileColor(share.file_type))} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate font-semibold text-foreground">{share.file_name}</p>
                                <Badge variant={linkShare ? "outline" : "secondary"} className="gap-1">
                                    {linkShare ? <Link2 className="h-3 w-3" /> : <Users2 className="h-3 w-3" />}
                                    {linkShare ? "Legacy link" : "User"}
                                </Badge>
                                {expired && <Badge variant="destructive">Expired</Badge>}
                                {!expired && isExpiringSoon(share) && (
                                    <Badge variant="outline" className="border-amber-500/40 text-amber-500">
                                        Expiring soon
                                    </Badge>
                                )}
                                {share.password_protected ? (
                                    <Badge variant="outline" className="gap-1">
                                        <ShieldCheck className="h-3 w-3" />
                                        Password
                                    </Badge>
                                ) : null}
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {formatFileSize(share.file_size)} - shared {formatDate(share.created_at)}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                                <span>{tab === "outgoing" ? "To" : "From"}: <span className="text-foreground">{linkShare ? "Legacy public link" : (tab === "outgoing" ? share.shared_with_name : share.shared_by_name) || "Unknown"}</span></span>
                                <span>Expires: <span className="text-foreground">{share.expires_at ? formatDate(share.expires_at) : "Never"}</span></span>
                                <span>Accesses: <span className="text-foreground">{share.access_count || 0}</span></span>
                                <span>Last: <span className="text-foreground">{formatDate(share.last_accessed_at)}</span></span>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                        {tab === "outgoing" ? (
                            linkShare ? (
                                <>
                                    <Button variant="outline" size="sm" className="gap-2" onClick={() => openActivity(share)}>
                                        <Activity className="h-3.5 w-3.5" />
                                        Activity
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-2 text-destructive hover:text-destructive"
                                        onClick={() => setConfirmTarget({ share, action: "revoke" })}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        Revoke
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <Select
                                        value={share.permission}
                                        onValueChange={(value) => handlePermissionChange(share, value as SharePermission)}
                                        disabled={busy}
                                    >
                                        <SelectTrigger size="sm" className="w-[150px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="view">View only</SelectItem>
                                            <SelectItem value="comment">Can comment</SelectItem>
                                            <SelectItem value="edit">Can edit/download</SelectItem>
                                            {share.file_type === "folder" && <SelectItem value="upload">Upload only</SelectItem>}
                                        </SelectContent>
                                    </Select>
                                    <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
                                        <Download className="h-3.5 w-3.5 text-muted-foreground" />
                                        <Switch
                                            checked={canDownload}
                                            onCheckedChange={(checked) => handleDownloadToggle(share, checked)}
                                            disabled={busy}
                                        />
                                    </div>
                                    <Button variant="outline" size="sm" className="gap-2" onClick={() => openActivity(share)}>
                                        <Activity className="h-3.5 w-3.5" />
                                        Activity
                                    </Button>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon">
                                                <MoreHorizontal className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onClick={() => extendShare(share)}>
                                                <CalendarClock className="mr-2 h-4 w-4" />
                                                Extend 7 days
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => navigate(`/shares/${share.id}`)}>
                                                <ExternalLink className="mr-2 h-4 w-4" />
                                                Detail route
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                className="text-destructive"
                                                onClick={() => setConfirmTarget({ share, action: "revoke" })}
                                            >
                                                <Trash2 className="mr-2 h-4 w-4" />
                                                Revoke
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </>
                            )
                        ) : (
                            <>
                                <Badge variant="secondary">{permissionLabel(share.permission)}</Badge>
                                <Button
                                    variant={share.shortcut_id ? "secondary" : "outline"}
                                    size="sm"
                                    className="gap-2"
                                    disabled={expired || share.permission === "upload" || busy}
                                    onClick={() => toggleMyFilesShortcut(share)}
                                >
                                    <FolderPlus className="h-3.5 w-3.5" />
                                    {share.shortcut_id ? "In My Files" : "Add to My Files"}
                                </Button>
                                {share.file_type === "folder" ? (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-2"
                                        disabled={expired || share.permission === "upload"}
                                        onClick={() => openSharedFolder(share)}
                                    >
                                        <FolderOpen className="h-3.5 w-3.5" />
                                        Open
                                    </Button>
                                ) : (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-2"
                                        disabled={expired || share.permission === "upload"}
                                        onClick={() => openIncomingPreview(share)}
                                    >
                                        <Eye className="h-3.5 w-3.5" />
                                        View
                                    </Button>
                                )}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-2"
                                    disabled={expired || !canDownload}
                                    onClick={() => downloadIncoming(share)}
                                >
                                    <Download className="h-3.5 w-3.5" />
                                    {share.file_type === "folder" ? "ZIP" : "Download"}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="gap-2 text-destructive hover:text-destructive"
                                    onClick={() => setConfirmTarget({ share, action: "leave" })}
                                >
                                    <UserX className="h-3.5 w-3.5" />
                                    Leave
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
                        <Link2 className="h-6 w-6" />
                        Shares
                    </h1>
                    <p className="text-muted-foreground">Manage private user access and files shared with you.</p>
                </div>
                <Button variant="outline" size="sm" className="gap-2" onClick={loadShares}>
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-border px-4 py-3">
                    <p className="text-xs text-muted-foreground">Active shares</p>
                    <p className="text-2xl font-bold">{stats.active}</p>
                </div>
                <div className="rounded-lg border border-border px-4 py-3">
                    <p className="text-xs text-muted-foreground">Expired shares</p>
                    <p className="text-2xl font-bold">{stats.expired}</p>
                </div>
                <div className="rounded-lg border border-border px-4 py-3">
                    <p className="text-xs text-muted-foreground">Legacy links</p>
                    <p className="text-2xl font-bold">{stats.links}</p>
                </div>
                <div className="rounded-lg border border-border px-4 py-3">
                    <p className="text-xs text-muted-foreground">Legacy protected</p>
                    <p className="text-2xl font-bold">{stats.protectedLinks}</p>
                </div>
            </div>

            <div className="flex w-full gap-1 overflow-x-auto rounded-lg bg-secondary p-1 sm:w-fit">
                <Button
                    variant={tab === "outgoing" ? "default" : "ghost"}
                    size="sm"
                    className="flex-1 gap-2 sm:flex-none"
                    onClick={() => switchTab("outgoing")}
                >
                    <ArrowUpRight className="h-4 w-4" />
                    Shared by Me
                    <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{myShares.length}</Badge>
                </Button>
                <Button
                    variant={tab === "incoming" ? "default" : "ghost"}
                    size="sm"
                    className="flex-1 gap-2 sm:flex-none"
                    onClick={() => switchTab("incoming")}
                >
                    <ArrowDownLeft className="h-4 w-4" />
                    Shared with Me
                    <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{sharedWithMe.length}</Badge>
                </Button>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_repeat(5,max-content)] lg:items-center">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Search shared files"
                        className="pl-9"
                    />
                </div>
                <Select value={shareTypeFilter} onValueChange={setShareTypeFilter}>
                    <SelectTrigger className="w-full lg:w-[130px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All shares</SelectItem>
                        <SelectItem value="link">Legacy links</SelectItem>
                        <SelectItem value="user">Users</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={permissionFilter} onValueChange={setPermissionFilter}>
                    <SelectTrigger className="w-full lg:w-[150px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Any permission</SelectItem>
                        <SelectItem value="view">View only</SelectItem>
                        <SelectItem value="comment">Can comment</SelectItem>
                        <SelectItem value="edit">Can edit</SelectItem>
                        <SelectItem value="upload">Upload only</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full lg:w-[130px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Any status</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="expired">Expired</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={fileTypeFilter} onValueChange={setFileTypeFilter}>
                    <SelectTrigger className="w-full lg:w-[130px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All files</SelectItem>
                        <SelectItem value="folder">Folders</SelectItem>
                        <SelectItem value="document">Documents</SelectItem>
                        <SelectItem value="image">Images</SelectItem>
                        <SelectItem value="video">Videos</SelectItem>
                        <SelectItem value="audio">Audio</SelectItem>
                        <SelectItem value="archive">Archives</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={sortKey} onValueChange={(value) => setSortKey(value as SortKey)}>
                    <SelectTrigger className="w-full lg:w-[150px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="date">Recently shared</SelectItem>
                        <SelectItem value="expiry">Expiry soonest</SelectItem>
                        <SelectItem value="name">File name</SelectItem>
                        <SelectItem value="accessed">Most accessed</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {selectedShares.length > 0 && tab === "outgoing" && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
                    <span className="text-sm text-muted-foreground">{selectedShares.length} selected</span>
                    <Select value={bulkPermission} onValueChange={(value) => setBulkPermission(value as SharePermission)}>
                        <SelectTrigger size="sm" className="w-[150px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="view">View only</SelectItem>
                            <SelectItem value="comment">Can comment</SelectItem>
                            <SelectItem value="edit">Can edit</SelectItem>
                            <SelectItem value="upload">Upload only</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" onClick={handleBulkPermission} disabled={busy}>Apply permission</Button>
                    <Button variant="outline" size="sm" onClick={handleBulkExtend} disabled={busy}>Extend 7 days</Button>
                    <Button variant="outline" size="sm" className="text-destructive" onClick={handleBulkRevoke} disabled={busy}>
                        Revoke
                    </Button>
                </div>
            )}

            {error && (
                <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {error}
                </div>
            )}

            {currentList.length === 0 ? (
                <div className="rounded-lg border border-border py-16 text-center">
                    <Link2 className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                    <h3 className="text-lg font-medium">
                        {tab === "outgoing" ? "No outgoing shares" : "No incoming shares"}
                    </h3>
                    <p className="mt-1 text-muted-foreground">
                        {tab === "outgoing"
                            ? "Share a file from the Files page to see it here."
                            : "Files shared with you will appear here."}
                    </p>
                </div>
            ) : (
                <div className="grid gap-3">
                    {currentList.map(renderShareCard)}
                </div>
            )}

            {previewShare && (() => {
                const previewUrl = getIncomingSharePreviewUrl(previewShare.id)
                const canDownload = previewShare.allow_download !== 0
                const isPdf = previewShare.mime_type?.includes("pdf")
                const isTextDocument = previewShare.file_type === "document" && !isPdf
                const unsupported = !["image", "video", "audio"].includes(previewShare.file_type) && !isPdf && !isTextDocument

                return (
                    <div
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3 sm:p-4"
                        onClick={closeIncomingPreview}
                        onKeyDown={(event) => event.key === "Escape" && closeIncomingPreview()}
                    >
                        <div
                            className="relative flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-card shadow-xl"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className="flex items-center justify-between gap-3 border-b border-border p-3 sm:p-4">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-card-foreground">{previewShare.file_name}</p>
                                    <p className="text-xs text-muted-foreground">{formatFileSize(previewShare.file_size)}</p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    {canDownload && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="gap-2"
                                            onClick={() => downloadIncoming(previewShare)}
                                        >
                                            <Download className="h-3.5 w-3.5" />
                                            <span className="hidden sm:inline">Download</span>
                                        </Button>
                                    )}
                                    <Button variant="ghost" size="icon" onClick={closeIncomingPreview}>
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>

                            <div className="flex min-h-[280px] flex-1 items-center justify-center overflow-auto bg-background p-3 sm:p-4">
                                {previewShare.file_type === "image" && (
                                    <img
                                        src={previewUrl}
                                        alt={previewShare.file_name}
                                        className="max-h-[72vh] max-w-full object-contain"
                                    />
                                )}
                                {previewShare.file_type === "video" && (
                                    <div className="flex w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-card">
                                        <video
                                            src={previewUrl}
                                            controls
                                            preload="metadata"
                                            className="max-h-[68vh] w-full bg-black"
                                            ref={(element) => {
                                                if (element) element.volume = 0.5
                                            }}
                                        />
                                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                                            <span>Ready to play</span>
                                            <span>Volume starts at 50%</span>
                                        </div>
                                    </div>
                                )}
                                {previewShare.file_type === "audio" && (
                                    <div className="flex w-full max-w-md flex-col items-center gap-5 rounded-lg border border-border bg-card p-6 text-center">
                                        <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-primary/10">
                                            <Music className="h-12 w-12 text-primary" />
                                        </div>
                                        <div>
                                            <p className="break-all text-sm font-medium">{previewShare.file_name}</p>
                                            <p className="mt-1 text-xs text-muted-foreground">Press play when you are ready · Volume 50%</p>
                                        </div>
                                        <audio
                                            src={previewUrl}
                                            controls
                                            preload="metadata"
                                            className="w-full"
                                            ref={(element) => {
                                                if (element) element.volume = 0.5
                                            }}
                                        />
                                    </div>
                                )}
                                {isPdf && (
                                    <embed
                                        src={`${previewUrl}#toolbar=1&navpanes=0`}
                                        type="application/pdf"
                                        className="h-[72vh] w-full rounded"
                                    />
                                )}
                                {isTextDocument && (
                                    <div className="max-h-[72vh] w-full max-w-4xl overflow-auto rounded-lg bg-card p-4">
                                        {previewLoading ? (
                                            <div className="flex h-40 items-center justify-center">
                                                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                                            </div>
                                        ) : previewError ? (
                                            <p className="text-sm text-destructive">{previewError}</p>
                                        ) : (
                                            <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-card-foreground">
                                                {previewTextContent || ""}
                                            </pre>
                                        )}
                                    </div>
                                )}
                                {unsupported && (
                                    <div className="flex max-w-sm flex-col items-center gap-4 text-center">
                                        <Archive className="h-14 w-14 text-muted-foreground" />
                                        <div>
                                            <p className="font-medium text-foreground">Preview unavailable</p>
                                            <p className="mt-1 text-sm text-muted-foreground">
                                                This file type cannot be previewed in the browser.
                                            </p>
                                        </div>
                                        {canDownload && (
                                            <Button className="gap-2" onClick={() => downloadIncoming(previewShare)}>
                                                <Download className="h-4 w-4" />
                                                Download
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )
            })()}

            <Sheet
                open={!!activityTarget}
                onOpenChange={(open) => {
                    if (!open) closeActivity()
                }}
            >
                <SheetContent className="w-full sm:max-w-xl">
                    <SheetHeader>
                        <SheetTitle className="flex items-center gap-2">
                            <Activity className="h-5 w-5" />
                            Share Activity
                        </SheetTitle>
                        <SheetDescription>
                            {activityTarget?.file_name}
                        </SheetDescription>
                    </SheetHeader>
                    <div className="flex-1 overflow-y-auto px-4 pb-4">
                        {activityLoading ? (
                            <div className="flex h-32 items-center justify-center">
                                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                            </div>
                        ) : activityLogs.length === 0 ? (
                            <div className="rounded-lg border border-border p-8 text-center text-muted-foreground">
                                No activity recorded yet.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {activityLogs.map((log) => (
                                    <div key={log.id} className="rounded-lg border border-border p-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <Badge variant="secondary">{log.action}</Badge>
                                            <span className="text-xs text-muted-foreground">{formatDateTime(log.created_at)}</span>
                                        </div>
                                        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                                            <p>Actor: <span className="text-foreground">{log.accessed_by_name || "Public visitor"}</span></p>
                                            <p>IP: <span className="text-foreground">{log.ip_address || "-"}</span></p>
                                            <p className="break-all">Agent: <span className="text-foreground">{log.user_agent || "-"}</span></p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </SheetContent>
            </Sheet>

            <AlertDialog open={!!confirmTarget} onOpenChange={(open) => !open && setConfirmTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {confirmTarget?.action === "revoke" ? "Revoke share?" : "Leave share?"}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmTarget?.action === "revoke"
                                ? `"${confirmTarget.share.file_name}" will stop being accessible through this share.`
                                : `"${confirmTarget?.share.file_name}" will be removed from your incoming shares.`}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={busy}
                            onClick={(event) => {
                                event.preventDefault()
                                handleConfirmAction()
                            }}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Confirm
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
