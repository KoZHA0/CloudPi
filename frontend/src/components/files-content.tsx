"use client"

import { useState, useEffect, useRef } from "react"
import { useSearchParams } from "react-router-dom"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu"
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
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
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
    Columns3,
    SortAsc,
    SortDesc,
    Upload,
    FolderPlus,
    Download,
    Filter,
    Trash2,
    Star,
    Search,
    ChevronLeft,
    ChevronRight,
    Home,
    Loader2,
    Pencil,
    FolderOpen,
    Link2,
    Users,
    Check,
    CheckSquare,
    AlertCircle,
    Eye,
    X,
    FileIcon,
    Maximize2,
    Info,
    Calendar,
    Clock,
    Scissors,
    Copy,
    ArrowLeft,
    Lock,
    ShieldAlert,
    KeyRound,
    RefreshCw,
    History,
    RotateCcw,
    RotateCw,
    ZoomIn,
    ZoomOut,
    Keyboard,
    HardDrive,
} from "lucide-react"
import { cn, formatApiDate, formatApiDateTime, parseApiDate } from "@/lib/utils"
import {
    getFiles,
    createFolder,
    createSecureVault,
    createVaultFolder,
    downloadFile,
    fetchVaultChunk,
    getVaultMetadata,
    changeVaultPin,
    initFileUpload,
    uploadFileChunk,
    completeFileUpload,
    abortFileUpload,
    initVaultUpload,
    uploadVaultChunk,
    completeVaultUpload,
    abortVaultUpload,
    renameVaultItem,
    renameFile,
    toggleStar,
    moveFile,
    copyFile,
    deleteFile,
    getPreviewUrl,
    getThumbnailUrl,
    downloadFilesZip,
    createShareLink,
    getShareUsers,
    getSharedFolderFiles,
    getSharedFilePreviewUrl,
    downloadSharedFile,
    downloadIncomingShare,
    getIncomingSharePreviewUrl,
    removeShareShortcut,
    getFileVersions,
    restoreFileVersion as restoreArchivedFileVersion,
    deleteFileVersion as deleteArchivedFileVersion,
    type FileItem,
    type Breadcrumb,
    type ShareUser,
    type SharePermission,
    type FileVersion,
    type FileVersionsResponse,
} from "@/lib/api"
import { useUpload } from "@/contexts/upload-context"
import { useDriveStatus } from "@/contexts/drive-status-context"
import { useVaults } from "@/contexts/vault-context"
import { OPEN_FILE_UPLOAD_PICKER_EVENT, REFRESH_FILES_EVENT } from "@/lib/upload-events"
import {
    CHUNK_SIZE_BYTES,
    createFileIv,
    createStorageId,
    createVaultEnvelope,
    decryptChunk,
    decryptMetadata,
    encryptChunk,
    encryptMetadata,
    rewrapVaultDek,
    unwrapVaultDek,
} from "@/lib/vault-crypto"

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

type FilesViewMode = "grid" | "list" | "columns"
type FilesSortKey = "name" | "modified" | "size" | "type"
type CloudPiUploadFile = File & { cloudpiRelativePath?: string; webkitRelativePath?: string }
interface FilesColumn {
    folderId: number | null
    title: string
    files: FileItem[]
}

const FILES_VIEW_KEY = "cloudpi.files.view"
const FILES_SORT_KEY = "cloudpi.files.sortKey"
const FILES_SORT_DIRECTION_KEY = "cloudpi.files.sortDirection"
const FILE_DRAG_TYPE = "application/x-cloudpi-file-ids"
const KNOWN_FILE_FILTER_TYPES = ["document", "image", "video", "audio", "archive"] as const
const FILE_FILTER_TYPES = [...KNOWN_FILE_FILTER_TYPES, "other", "starred"] as const
const CODE_PREVIEW_EXTENSIONS = new Set([
    "js", "jsx", "ts", "tsx", "mjs", "cjs", "css", "scss", "html", "htm",
    "py", "rb", "php", "java", "c", "cpp", "h", "hpp", "cs", "go", "rs",
    "sh", "bash", "ps1", "sql", "xml", "toml", "ini", "env",
])
const TEXT_PREVIEW_EXTENSIONS = new Set([
    ...CODE_PREVIEW_EXTENSIONS,
    "txt", "text", "log", "md", "markdown", "json", "yaml", "yml", "csv",
])
const CODE_KEYWORDS = new Set([
    "async", "await", "break", "case", "catch", "class", "const", "continue", "def",
    "default", "do", "else", "export", "extends", "false", "finally", "for", "from",
    "function", "if", "import", "in", "interface", "let", "new", "null", "return",
    "switch", "throw", "true", "try", "type", "var", "while",
])

function getInitialFilesView(): FilesViewMode {
    if (typeof window === "undefined") return "list"
    const value = window.localStorage.getItem(FILES_VIEW_KEY)
    return value === "grid" || value === "columns" ? value : "list"
}

function getInitialSortKey(): FilesSortKey {
    if (typeof window === "undefined") return "name"
    const value = window.localStorage.getItem(FILES_SORT_KEY)
    return value === "modified" || value === "size" || value === "type" ? value : "name"
}

function getInitialSortDirection(): "asc" | "desc" {
    if (typeof window === "undefined") return "asc"
    return window.localStorage.getItem(FILES_SORT_DIRECTION_KEY) === "desc" ? "desc" : "asc"
}

function parseIdParam(value: string | null) {
    if (!value) return null
    const id = Number(value)
    return Number.isInteger(id) && id > 0 ? id : null
}

function getFileExtension(fileName: string) {
    const match = fileName.toLowerCase().match(/\.([^.]+)$/)
    return match?.[1] || ""
}

function getInitialFilterType(searchParams: URLSearchParams) {
    const type = searchParams.get("type")
    return FILE_FILTER_TYPES.includes(type as typeof FILE_FILTER_TYPES[number]) ? type : null
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
    if (bytes === 0) return "—"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

function formatDate(dateString: string): string {
    const date = parseApiDate(dateString)
    if (!date) return "-"
    const now = new Date()
    const diffMs = Math.max(0, now.getTime() - date.getTime())
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return "Today"
    if (diffDays === 1) return "Yesterday"
    if (diffDays < 7) return `${diffDays} days ago`
    return formatApiDate(dateString)
}

export function FilesContent() {
    const { addUpload } = useUpload()
    const { isFileAccessible, disconnectedDrives, notification } = useDriveStatus()
    const { isVaultUnlocked, getVaultKey, unlockVault, lockVault, touchVault } = useVaults()
    const [searchParams, setSearchParams] = useSearchParams()
    const [view, setView] = useState<FilesViewMode>(() => getInitialFilesView())
    const [files, setFiles] = useState<FileItem[]>([])
    const [columns, setColumns] = useState<FilesColumn[]>([])
    const [columnsLoading, setColumnsLoading] = useState(false)
    const [columnsError, setColumnsError] = useState<string | null>(null)
    const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([])
    const [displayNames, setDisplayNames] = useState<Record<number, string>>({})
    const [currentFolderId, setCurrentFolderId] = useState<number | null>(() => parseIdParam(searchParams.get("folder")))
    const [loadedFolderId, setLoadedFolderId] = useState<number | null | undefined>(undefined)
    const [highlightedFileId, setHighlightedFileId] = useState<number | null>(() => parseIdParam(searchParams.get("highlight")))
    const [currentFolder, setCurrentFolder] = useState<Breadcrumb | null>(null)
    const [currentVault, setCurrentVault] = useState<Breadcrumb | null>(null)
    const [selectedFiles, setSelectedFiles] = useState<number[]>([])
    const [lastSelectedFileId, setLastSelectedFileId] = useState<number | null>(null)
    const [isSelecting, setIsSelecting] = useState(false)
    const [searchQuery, setSearchQuery] = useState("")
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [storageWarning, setStorageWarning] = useState<string | null>(null)
    const fileLoadRequestRef = useRef(0)
    const columnsLoadRequestRef = useRef(0)
    const currentFolderIdRef = useRef<number | null>(currentFolderId)
    const loadedFolderIdRef = useRef<number | null | undefined>(loadedFolderId)

    // Sorting & filtering
    const [sortKey, setSortKey] = useState<FilesSortKey>(() => getInitialSortKey())
    const [sortDirection, setSortDirection] = useState<"asc" | "desc">(() => getInitialSortDirection())
    const [filterType, setFilterTypeState] = useState<string | null>(() => getInitialFilterType(searchParams))

    // File details sidebar
    const [detailFile, setDetailFile] = useState<FileItem | null>(null)
    const [brokenThumbnails, setBrokenThumbnails] = useState<Record<number, boolean>>({})

    // Dialogs
    const [showNewFolderDialog, setShowNewFolderDialog] = useState(false)
    const [showSecureVaultDialog, setShowSecureVaultDialog] = useState(false)
    const [showUnlockVaultDialog, setShowUnlockVaultDialog] = useState(false)
    const [showChangePinDialog, setShowChangePinDialog] = useState(false)
    const [showRenameDialog, setShowRenameDialog] = useState(false)
    const [showDeleteDialog, setShowDeleteDialog] = useState(false)
    const [showLocationDialog, setShowLocationDialog] = useState(false)
    const [showKeyboardHelp, setShowKeyboardHelp] = useState(false)
    const [newFolderName, setNewFolderName] = useState("")
    const [newSecureVaultName, setNewSecureVaultName] = useState("")
    const [secureVaultPin, setSecureVaultPin] = useState("")
    const [secureVaultPinConfirm, setSecureVaultPinConfirm] = useState("")
    const [unlockPin, setUnlockPin] = useState("")
    const [changePinCurrent, setChangePinCurrent] = useState("")
    const [changePinNext, setChangePinNext] = useState("")
    const [changePinConfirm, setChangePinConfirm] = useState("")
    const [renameValue, setRenameValue] = useState("")
    const [selectedItem, setSelectedItem] = useState<FileItem | null>(null)
    const [locationMode, setLocationMode] = useState<"move" | "copy">("move")
    const [locationTarget, setLocationTarget] = useState<FileItem | null>(null)
    const [locationTargets, setLocationTargets] = useState<FileItem[]>([])
    const [destinationFolderId, setDestinationFolderId] = useState<number | null>(null)
    const [destinationFolders, setDestinationFolders] = useState<FileItem[]>([])
    const [destinationBreadcrumbs, setDestinationBreadcrumbs] = useState<Breadcrumb[]>([])
    const [destinationLoading, setDestinationLoading] = useState(false)
    const [isApplyingLocation, setIsApplyingLocation] = useState(false)

    // File preview
    const [previewFile, setPreviewFile] = useState<FileItem | null>(null)
    const [previewTextContent, setPreviewTextContent] = useState<string | null>(null)
    const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
    const [previewPdfError, setPreviewPdfError] = useState<string | null>(null)
    const [imageZoom, setImageZoom] = useState(1)
    const [imageRotation, setImageRotation] = useState(0)
    const [imagePan, setImagePan] = useState({ x: 0, y: 0 })
    const [isImagePanning, setIsImagePanning] = useState(false)
    const imagePanStartRef = useRef({ pointerX: 0, pointerY: 0, panX: 0, panY: 0 })
    const previewRequestAbortRef = useRef<AbortController | null>(null)
    const [previewTextWrap, setPreviewTextWrap] = useState(true)
    const [previewTextCopied, setPreviewTextCopied] = useState(false)

    // Shared shortcuts added to My Files
    const [browsingShortcut, setBrowsingShortcut] = useState<FileItem | null>(null)
    const [shortcutFiles, setShortcutFiles] = useState<FileItem[]>([])
    const [shortcutBreadcrumbs, setShortcutBreadcrumbs] = useState<Breadcrumb[]>([])
    const [shortcutRootFolderId, setShortcutRootFolderId] = useState<number | null>(null)
    const [shortcutLoading, setShortcutLoading] = useState(false)

    // Upload
    const fileInputRef = useRef<HTMLInputElement>(null)
    const folderInputRef = useRef<HTMLInputElement>(null)

    // Drag and drop
    const [isDragging, setIsDragging] = useState(false)
    const [internalDragIds, setInternalDragIds] = useState<number[]>([])
    const [dropTargetFolderId, setDropTargetFolderId] = useState<number | null>(null)
    const dragCounter = useRef(0)

    // Share dialog
    const [showShareDialog, setShowShareDialog] = useState(false)
    const [shareFile, setShareFile] = useState<FileItem | null>(null)
    const [shareFiles, setShareFiles] = useState<FileItem[]>([])
    const [shareUsers, setShareUsers] = useState<ShareUser[]>([])
    const [shareLoading, setShareLoading] = useState(false)
    const [selectedShareUsers, setSelectedShareUsers] = useState<number[]>([])
    const [shareUserQuery, setShareUserQuery] = useState("")
    const [sharePermission, setSharePermission] = useState<SharePermission>("view")
    const [shareExpiry, setShareExpiry] = useState("")
    const [allowShareDownload, setAllowShareDownload] = useState(true)
    const [shareStatus, setShareStatus] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null)
    const [isSharing, setIsSharing] = useState(false)
    const [vaultBusy, setVaultBusy] = useState(false)
    const [versionFile, setVersionFile] = useState<FileItem | null>(null)
    const [versionHistory, setVersionHistory] = useState<FileVersionsResponse | null>(null)
    const [versionLoading, setVersionLoading] = useState(false)
    const [versionError, setVersionError] = useState<string | null>(null)
    const [versionAction, setVersionAction] = useState<{ type: "restore" | "delete"; version: FileVersion } | null>(null)
    const [versionActionBusy, setVersionActionBusy] = useState(false)

    useEffect(() => {
        currentFolderIdRef.current = currentFolderId
    }, [currentFolderId])

    useEffect(() => {
        loadedFolderIdRef.current = loadedFolderId
    }, [loadedFolderId])

    useEffect(() => {
        const nextFolderId = parseIdParam(searchParams.get("folder"))
        const nextHighlightId = parseIdParam(searchParams.get("highlight"))
        const folderChanged = nextFolderId !== currentFolderId
        const highlightChanged = nextHighlightId !== highlightedFileId
        setHighlightedFileId(nextHighlightId)

        if (folderChanged || highlightChanged) {
            closePreview()
            setDetailFile(null)
            closeVersionHistory()
            closeShortcutBrowser()
        }

        if (folderChanged) {
            currentFolderIdRef.current = nextFolderId
            loadedFolderIdRef.current = undefined
            fileLoadRequestRef.current += 1
            columnsLoadRequestRef.current += 1
            setLoadedFolderId(undefined)
            setColumns([])
            setColumnsError(null)
            setColumnsLoading(false)
            setIsLoading(true)
            setSelectedFiles([])
            setLastSelectedFileId(null)
            setIsSelecting(false)
            setCurrentFolderId(nextFolderId)
        }
    }, [searchParams])

    useEffect(() => {
        const nextFilterType = getInitialFilterType(searchParams)
        setFilterTypeState((current) => current === nextFilterType ? current : nextFilterType)
    }, [searchParams])

    useEffect(() => {
        if (typeof window === "undefined") return
        window.localStorage.setItem(FILES_VIEW_KEY, view)
    }, [view])

    useEffect(() => {
        if (typeof window === "undefined") return
        window.localStorage.setItem(FILES_SORT_KEY, sortKey)
        window.localStorage.setItem(FILES_SORT_DIRECTION_KEY, sortDirection)
    }, [sortKey, sortDirection])

    // Load files
    useEffect(() => {
        loadFiles()
    }, [currentFolderId])

    useEffect(() => {
        if (!notification) return
        if (notification.type === "connect") {
            setStorageWarning(null)
        }
        loadFiles()
    }, [notification])

    useEffect(() => {
        if (view !== "columns" || isLoading || loadedFolderId !== currentFolderId) return
        loadColumnsForPath()
    }, [view, isLoading, currentFolderId, loadedFolderId, files, breadcrumbs])

    useEffect(() => {
        const previewId = parseIdParam(searchParams.get("preview"))
        if (!previewId || isLoading) return

        const target = files.find((file) => file.id === previewId)
        if (!target) return

        const nextParams = new URLSearchParams(searchParams)
        nextParams.delete("preview")

        if (target.type !== "folder" && isFileAccessible(target) && !isSecureItem(target)) {
            openPreview(target)
        }

        setSearchParams(nextParams, { replace: true })
    }, [searchParams, isLoading, files])

    const activeVaultId = currentVault?.id ?? null
    const isInsideVault = activeVaultId !== null
    const isActiveVaultUnlocked = isVaultUnlocked(activeVaultId)

    function isLatestFileLoad(requestId: number, folderId: number | null) {
        return requestId === fileLoadRequestRef.current && currentFolderIdRef.current === folderId
    }

    function isLatestColumnLoad(requestId: number, folderId: number | null) {
        return requestId === columnsLoadRequestRef.current &&
            currentFolderIdRef.current === folderId &&
            loadedFolderIdRef.current === folderId
    }

    function getDisplayName(item: { id: number; name: string }) {
        return displayNames[item.id] ?? item.name
    }

    async function loadFiles() {
        const folderId = currentFolderIdRef.current
        const requestId = ++fileLoadRequestRef.current
        setIsLoading(true)
        setError(null)
        try {
            const data = await getFiles(folderId) as any
            if (!isLatestFileLoad(requestId, folderId)) return
            setFiles(data.files)
            setBreadcrumbs(data.breadcrumbs)
            setCurrentFolder(data.currentFolder || null)
            setCurrentVault(data.currentVault || null)
            loadedFolderIdRef.current = folderId
            setLoadedFolderId(folderId)
            // Show warning if user's assigned drive is disconnected
            if (data.storageWarning) {
                setStorageWarning(data.storageWarning)
            } else {
                setStorageWarning(null)
            }
        } catch (err) {
            if (!isLatestFileLoad(requestId, folderId)) return
            loadedFolderIdRef.current = undefined
            setLoadedFolderId(undefined)
            setError(err instanceof Error ? err.message : "Failed to load files")
        } finally {
            if (isLatestFileLoad(requestId, folderId)) {
                setIsLoading(false)
            }
        }
    }

    async function loadColumnsForPath() {
        const folderId = currentFolderIdRef.current
        const requestId = ++columnsLoadRequestRef.current
        setColumnsLoading(true)
        setColumnsError(null)
        try {
            const nextColumns: FilesColumn[] = []
            const rootData = folderId === null ? { files } : await getFiles(null) as any
            if (!isLatestColumnLoad(requestId, folderId)) return
            nextColumns.push({
                folderId: null,
                title: "My Files",
                files: rootData.files || [],
            })

            for (const crumb of breadcrumbs) {
                const crumbData = crumb.id === folderId ? { files } : await getFiles(crumb.id) as any
                if (!isLatestColumnLoad(requestId, folderId)) return
                nextColumns.push({
                    folderId: crumb.id,
                    title: getDisplayName(crumb),
                    files: crumbData.files || [],
                })
            }

            setColumns(nextColumns)
        } catch (err) {
            if (!isLatestColumnLoad(requestId, folderId)) return
            setColumnsError(err instanceof Error ? err.message : "Failed to load columns view")
            setColumns([])
        } finally {
            if (isLatestColumnLoad(requestId, folderId)) {
                setColumnsLoading(false)
            }
        }
    }

    useEffect(() => {
        let cancelled = false

        async function resolveEncryptedNames() {
            const nextNames: Record<number, string> = {}
            const activeKey = getVaultKey(activeVaultId)

            const columnItems = columns.flatMap((column) => column.files)
            const allItems = [
                ...files,
                ...columnItems,
                ...breadcrumbs,
                ...(currentFolder ? [currentFolder] : []),
                ...(currentVault ? [currentVault] : []),
            ]

            for (const item of allItems) {
                if (item.encrypted_metadata && activeKey) {
                    try {
                        nextNames[item.id] = await decryptMetadata(activeKey, item.encrypted_metadata)
                    } catch {
                        nextNames[item.id] = item.name
                    }
                } else {
                    nextNames[item.id] = item.name
                }
            }

            if (!cancelled) {
                setDisplayNames(nextNames)
            }
        }

        resolveEncryptedNames()

        return () => {
            cancelled = true
        }
    }, [files, columns, breadcrumbs, currentFolder, currentVault, activeVaultId, getVaultKey])

    function fileMatchesActiveFilters(file: FileItem) {
        if (!getDisplayName(file).toLowerCase().includes(searchQuery.toLowerCase())) return false
        if (!filterType) return true
        if (filterType === "starred") return file.starred === 1
        if (filterType === "other") return !KNOWN_FILE_FILTER_TYPES.includes(file.type as typeof KNOWN_FILE_FILTER_TYPES[number])
        return file.type === filterType
    }

    function compareFilesForDisplay(a: FileItem, b: FileItem) {
        // Folders always come first.
        if (a.type === "folder" && b.type !== "folder") return -1
        if (a.type !== "folder" && b.type === "folder") return 1

        let cmp = 0
        switch (sortKey) {
            case "name":
                cmp = getDisplayName(a).localeCompare(getDisplayName(b))
                break
            case "modified":
                cmp = (parseApiDate(a.modified_at)?.getTime() || 0) - (parseApiDate(b.modified_at)?.getTime() || 0)
                break
            case "size":
                cmp = a.size - b.size
                break
            case "type":
                cmp = a.type.localeCompare(b.type)
                break
        }
        return sortDirection === "asc" ? cmp : -cmp
    }

    function getSortedVisibleFiles(items: FileItem[]) {
        return [...items].filter(fileMatchesActiveFilters).sort(compareFilesForDisplay)
    }

    const filteredFiles = getSortedVisibleFiles(files)

    const filteredShareUsers = shareUsers.filter((user) => {
        const needle = shareUserQuery.toLowerCase()
        return user.username.toLowerCase().includes(needle) || (user.email || "").toLowerCase().includes(needle)
    })

    function handleSort(key: typeof sortKey) {
        if (sortKey === key) {
            setSortDirection(d => d === "asc" ? "desc" : "asc")
        } else {
            setSortKey(key)
            setSortDirection("asc")
        }
    }

    function isSecureItem(file: FileItem | Breadcrumb | null | undefined) {
        if (!file) return false
        return Boolean(file.is_secure_vault) || Number.isInteger(file.vault_root_id)
    }

    function isShareShortcut(file: FileItem | null | undefined) {
        return Boolean(file?.is_share_shortcut && file.share_id)
    }

    function getShareShortcutPreviewUrl(file: FileItem) {
        return file.share_id ? getIncomingSharePreviewUrl(file.share_id) : ""
    }

    function canDragFile(file: FileItem) {
        return !isShareShortcut(file) && !isSecureItem(file) && isFileAccessible(file)
    }

    function isInternalFileDrag(event: React.DragEvent | DragEvent) {
        return Array.from(event.dataTransfer?.types || []).includes(FILE_DRAG_TYPE)
    }

    function getDragIdsForFile(file: FileItem) {
        if (!canDragFile(file)) return []
        if (selectedFiles.includes(file.id)) {
            return getSelectedRegularItems()
                .filter((selected) => canDragFile(selected))
                .map((selected) => selected.id)
        }
        return [file.id]
    }

    function canDropOnFolder(folder: FileItem) {
        return folder.type === "folder" &&
            canDragFile(folder) &&
            !internalDragIds.includes(folder.id)
    }

    function getVersionNumber(file: FileItem | null | undefined) {
        return Math.max(1, Number(file?.version_number) || 1)
    }

    function canShowVersions(file: FileItem | null | undefined) {
        return Boolean(file && file.type !== "folder" && !isSecureItem(file) && !isShareShortcut(file) && isFileAccessible(file))
    }

    function getUnavailableActionMessage(file: FileItem, action: string) {
        return `Reconnect the drive for "${getDisplayName(file)}" before you ${action}.`
    }

    function ensureFileAvailable(file: FileItem, action: string) {
        if (isFileAccessible(file)) return true
        setError(getUnavailableActionMessage(file, action))
        return false
    }

    function ensureFilesAvailable(items: FileItem[], action: string) {
        const unavailable = items.find((file) => !isFileAccessible(file))
        if (!unavailable) return true
        setError(getUnavailableActionMessage(unavailable, action))
        return false
    }

    async function readPreviewError(response: Response, fallback: string) {
        try {
            const data = await response.clone().json()
            if (data?.error) return String(data.error)
        } catch {
            // Preview endpoints normally return a file stream, not JSON.
        }
        return `${fallback} (${response.status})`
    }

    function cancelPreviewRequest() {
        previewRequestAbortRef.current?.abort()
        previewRequestAbortRef.current = null
    }

    function getStorageSourceLabel(file: FileItem) {
        const sourceId = file.storage_source_id || "internal"
        if (file.storage_source_label) return file.storage_source_label
        return sourceId === "internal" ? "Internal Storage" : "External Drive"
    }

    function getStorageSourceDescription(file: FileItem) {
        const sourceId = file.storage_source_id || "internal"
        const sourceType = (file.storage_source_type || (sourceId === "internal" ? "internal" : "external")).toLowerCase()
        const ownerPrefix = isShareShortcut(file) ? "Owner's " : ""
        const kind = sourceType === "internal" ? "internal storage" : "external drive"
        const status = isFileAccessible(file) ? "online" : "offline"
        return `${ownerPrefix}${kind} - ${status}`
    }

    function getPreviewUrlForFile(file: FileItem) {
        if (!isShareShortcut(file) && browsingShortcut?.share_id && shortcutFiles.some((item) => item.id === file.id)) {
            return getSharedFilePreviewUrl(browsingShortcut.share_id, file.id)
        }
        return isShareShortcut(file) ? getShareShortcutPreviewUrl(file) : getPreviewUrl(file.id)
    }

    function isPdfPreviewFile(file: FileItem | null | undefined) {
        if (!file) return false
        const name = getDisplayName(file).toLowerCase()
        return Boolean(file.mime_type?.toLowerCase().includes("pdf") || name.endsWith(".pdf"))
    }

    function isTextPreviewFile(file: FileItem | null | undefined) {
        if (!file || file.type !== "document" || isPdfPreviewFile(file)) return false
        const mime = (file.mime_type || "").toLowerCase()
        const ext = getFileExtension(getDisplayName(file))
        return mime.startsWith("text/") ||
            mime.includes("json") ||
            mime.includes("javascript") ||
            mime.includes("xml") ||
            mime.includes("csv") ||
            TEXT_PREVIEW_EXTENSIONS.has(ext)
    }

    function isCodePreviewFile(file: FileItem | null | undefined) {
        if (!file) return false
        const ext = getFileExtension(getDisplayName(file))
        const mime = (file.mime_type || "").toLowerCase()
        return CODE_PREVIEW_EXTENSIONS.has(ext) ||
            mime.includes("javascript") ||
            mime.includes("json") ||
            mime.includes("xml")
    }

    function getPreviewLanguageLabel(file: FileItem) {
        const ext = getFileExtension(getDisplayName(file))
        if (ext === "md" || ext === "markdown") return "Markdown"
        if (ext === "env") return "Environment"
        if (ext === "txt" || ext === "text") return "Plain text"
        if (ext === "log") return "Log"
        if (ext) return ext.toUpperCase()
        return file.mime_type || "Text"
    }

    function isUnsupportedPreviewFile(file: FileItem | null | undefined) {
        if (!file) return false
        return file.type !== "image" &&
            file.type !== "video" &&
            file.type !== "audio" &&
            !isPdfPreviewFile(file) &&
            !isTextPreviewFile(file)
    }

    function closeVersionHistory() {
        setVersionFile(null)
        setVersionHistory(null)
        setVersionError(null)
        setVersionAction(null)
        setVersionActionBusy(false)
        setVersionLoading(false)
    }

    function closeShortcutBrowser() {
        setBrowsingShortcut(null)
        setShortcutFiles([])
        setShortcutBreadcrumbs([])
        setShortcutRootFolderId(null)
        setShortcutLoading(false)
    }

    function clearOverlays() {
        closePreview()
        setDetailFile(null)
        closeVersionHistory()
        closeShortcutBrowser()
    }

    function getStorageDisconnectTitle(source: { source_id: string; label: string }) {
        return source.source_id === "internal" ? "Internal Storage Unavailable" : "Storage Drive Disconnected"
    }

    function getStorageDisconnectMessage(source: { source_id: string; label: string }) {
        if (source.source_id === "internal") {
            return "CloudPi's internal storage is temporarily unavailable."
        }
        return `Drive "${source.label}" is not currently attached. Files on this drive are temporarily unavailable.`
    }

    function getDisconnectBannerMessage(sources: { source_id: string; label: string }[]) {
        const internalSource = sources.find((source) => source.source_id === "internal")
        const externalSources = sources.filter((source) => source.source_id !== "internal")

        if (internalSource && externalSources.length === 0) {
            return getStorageDisconnectMessage(internalSource)
        }

        if (!internalSource && externalSources.length === 1) {
            return getStorageDisconnectMessage(externalSources[0])
        }

        if (!internalSource) {
            return `${externalSources.length} drives are disconnected: ${externalSources.map(d => `"${d.label}"`).join(", ")}. Files on these drives are temporarily unavailable.`
        }

        return `CloudPi's encrypted internal storage is unavailable, and ${externalSources.length} external drive${externalSources.length === 1 ? "" : "s"} ${externalSources.map(d => `"${d.label}"`).join(", ")} ${externalSources.length === 1 ? "is" : "are"} also offline.`
    }

    function updateFilterType(nextType: string | null) {
        const nextParams = new URLSearchParams(searchParams)
        if (nextType) {
            nextParams.set("type", nextType)
        } else {
            nextParams.delete("type")
        }
        setFilterTypeState(nextType)
        setSearchParams(nextParams, { replace: false })
    }

    // Navigation
    function navigateToFolder(folderId: number | null) {
        clearOverlays()
        if (folderId !== currentFolderIdRef.current) {
            currentFolderIdRef.current = folderId
            loadedFolderIdRef.current = undefined
            fileLoadRequestRef.current += 1
            columnsLoadRequestRef.current += 1
            setLoadedFolderId(undefined)
            setColumns([])
            setColumnsError(null)
            setColumnsLoading(false)
            setIsLoading(true)
        }
        const nextParams = new URLSearchParams(searchParams)
        if (folderId) {
            nextParams.set("folder", String(folderId))
        } else {
            nextParams.delete("folder")
        }
        nextParams.delete("highlight")
        setSearchParams(nextParams, { replace: false })
        setHighlightedFileId(null)
        setCurrentFolderId(folderId)
        setSelectedFiles([])
        setLastSelectedFileId(null)
        setIsSelecting(false)
    }

    async function openShortcutFolder(file: FileItem) {
        if (!file.share_id) return
        setBrowsingShortcut(file)
        setShortcutLoading(true)
        setError(null)
        try {
            const data = await getSharedFolderFiles(file.share_id)
            setShortcutFiles(data.files)
            setShortcutBreadcrumbs(data.breadcrumbs)
            setShortcutRootFolderId(data.rootFolderId)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to open shared folder")
        } finally {
            setShortcutLoading(false)
        }
    }

    async function navigateShortcutFolder(folderId?: number) {
        if (!browsingShortcut?.share_id) return
        setShortcutLoading(true)
        setError(null)
        try {
            const data = await getSharedFolderFiles(browsingShortcut.share_id, folderId)
            setShortcutFiles(data.files)
            setShortcutBreadcrumbs(data.breadcrumbs)
            setShortcutRootFolderId(data.rootFolderId)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load shared folder")
        } finally {
            setShortcutLoading(false)
        }
    }

    function handleFileClick(file: FileItem) {
        if (isShareShortcut(file)) {
            if (file.type === "folder") {
                openShortcutFolder(file)
            } else {
                openPreview(file)
            }
            return
        }
        if (file.type === "folder") {
            navigateToFolder(file.id)
        }
    }

    function getColumnTitle(column: FilesColumn) {
        if (column.folderId === null) return "My Files"
        const crumb = breadcrumbs.find((item) => item.id === column.folderId)
        if (crumb) return getDisplayName(crumb)
        return column.title
    }

    function handleColumnItemClick(file: FileItem, column: FilesColumn, event: React.MouseEvent) {
        const isActiveColumn = column.folderId === currentFolderId
        if (isSelecting) {
            event.stopPropagation()
            if (isActiveColumn && !isShareShortcut(file)) {
                toggleFileSelection(file.id, event)
            }
            return
        }
        if (!isFileAccessible(file)) return
        if (file.type === "folder") {
            handleFileClick(file)
            return
        }
        if (!isSecureItem(file)) {
            openPreview(file)
        }
    }

    // Selection
    function toggleFileSelection(id: number, event?: Pick<React.MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">) {
        if (id < 0) return
        const selectableIds = filteredFiles.filter((file) => !isShareShortcut(file)).map((file) => file.id)

        if (event?.shiftKey && lastSelectedFileId !== null) {
            const start = selectableIds.indexOf(lastSelectedFileId)
            const end = selectableIds.indexOf(id)
            if (start !== -1 && end !== -1) {
                const [from, to] = start < end ? [start, end] : [end, start]
                const range = selectableIds.slice(from, to + 1)
                setSelectedFiles((prev) => Array.from(new Set([...prev, ...range])))
                setLastSelectedFileId(id)
                return
            }
        }

        setSelectedFiles((prev) =>
            prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
        )
        setLastSelectedFileId(id)
    }

    // Create folder
    async function handleCreateFolder() {
        if (!newFolderName.trim()) return
        try {
            if (isInsideVault) {
                const targetFolderId = currentFolderId ?? activeVaultId
                if (!activeVaultId || !targetFolderId) {
                    throw new Error("Vault folder context is unavailable")
                }
                const dek = getVaultKey(activeVaultId)
                if (!dek) {
                    throw new Error("Unlock this vault before creating encrypted folders")
                }
                touchVault(activeVaultId)
                await createVaultFolder(activeVaultId, targetFolderId, await encryptMetadata(dek, newFolderName.trim()))
            } else {
                await createFolder(newFolderName.trim(), currentFolderId)
            }
            setError(null)
            setNewFolderName("")
            setShowNewFolderDialog(false)
            loadFiles()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create folder")
        }
    }

    async function handleCreateSecureVault() {
        if (!newSecureVaultName.trim()) return
        if (secureVaultPin.length < 4) {
            setError("Choose a vault PIN with at least 4 characters")
            return
        }
        if (secureVaultPin !== secureVaultPinConfirm) {
            setError("Vault PIN confirmation does not match")
            return
        }

        setVaultBusy(true)
        setError(null)

        try {
            const envelope = await createVaultEnvelope(secureVaultPin)
            const result = await createSecureVault(newSecureVaultName.trim(), currentFolderId, {
                salt: envelope.salt,
                encrypted_dek: envelope.encryptedDek,
                dek_iv: envelope.dekIv,
            })
            unlockVault(result.folder.id, envelope.dek)
            setShowSecureVaultDialog(false)
            setNewSecureVaultName("")
            setSecureVaultPin("")
            setSecureVaultPinConfirm("")
            await loadFiles()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create secure vault")
        } finally {
            setVaultBusy(false)
        }
    }

    async function handleUnlockVault() {
        if (!activeVaultId || !unlockPin.trim()) return

        setVaultBusy(true)
        setError(null)

        try {
            const response = await getVaultMetadata(activeVaultId)
            const dek = await unwrapVaultDek(
                unlockPin,
                response.vault.salt,
                response.vault.encrypted_dek,
                response.vault.dek_iv,
            )
            unlockVault(activeVaultId, dek)
            setUnlockPin("")
            setShowUnlockVaultDialog(false)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to unlock vault")
        } finally {
            setVaultBusy(false)
        }
    }

    async function handleChangeVaultPin() {
        if (!activeVaultId) return
        if (!isActiveVaultUnlocked && !changePinCurrent.trim()) {
            setError("Current PIN is required to unlock the vault before changing it")
            return
        }
        if (changePinNext.length < 4) {
            setError("Choose a new vault PIN with at least 4 characters")
            return
        }
        if (changePinNext !== changePinConfirm) {
            setError("New vault PIN confirmation does not match")
            return
        }

        setVaultBusy(true)
        setError(null)

        try {
            let dek = getVaultKey(activeVaultId)
            if (!dek) {
                const response = await getVaultMetadata(activeVaultId)
                dek = await unwrapVaultDek(
                    changePinCurrent,
                    response.vault.salt,
                    response.vault.encrypted_dek,
                    response.vault.dek_iv,
                )
                unlockVault(activeVaultId, dek)
            }
            const updatedEnvelope = await rewrapVaultDek(dek, changePinNext)
            await changeVaultPin(activeVaultId, {
                salt: updatedEnvelope.salt,
                encrypted_dek: updatedEnvelope.encryptedDek,
                dek_iv: updatedEnvelope.dekIv,
            })
            setShowChangePinDialog(false)
            setChangePinCurrent("")
            setChangePinNext("")
            setChangePinConfirm("")
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to change vault PIN")
        } finally {
            setVaultBusy(false)
        }
    }

    async function uploadRegularFilesChunked(filesToUpload: File[], folderId: number | null, onProgress: (uploadedBytes: number, totalBytes: number) => void, signal?: AbortSignal) {
        const totalBytes = filesToUpload.reduce((sum, file) => sum + file.size, 0)
        let completedBytes = 0
        const throwIfAborted = () => {
            if (signal?.aborted) {
                throw new DOMException("Upload cancelled", "AbortError")
            }
        }

        for (const file of filesToUpload) {
            throwIfAborted()
            const uploadFile = file as CloudPiUploadFile
            const relativePath = uploadFile.cloudpiRelativePath || uploadFile.webkitRelativePath || file.name
            const chunkCount = file.size === 0 ? 0 : Math.ceil(file.size / CHUNK_SIZE_BYTES)
            const init = await initFileUpload({
                parent_id: folderId,
                name: file.name,
                size: file.size,
                mime_type: file.type || "application/octet-stream",
                relative_path: relativePath,
                chunk_count: chunkCount,
            })

            let fileUploadedBytes = 0
            try {
                for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
                    throwIfAborted()
                    const start = chunkIndex * CHUNK_SIZE_BYTES
                    const end = Math.min(file.size, start + CHUNK_SIZE_BYTES)
                    const chunkBuffer = await file.slice(start, end).arrayBuffer()
                    throwIfAborted()
                    await uploadFileChunk(init.upload.id, chunkIndex, new Uint8Array(chunkBuffer), signal)
                    fileUploadedBytes += end - start
                    onProgress(completedBytes + fileUploadedBytes, totalBytes)
                }

                await completeFileUpload(init.upload.id)
                completedBytes += file.size
                onProgress(completedBytes, totalBytes)
            } catch (error) {
                await abortFileUpload(init.upload.id).catch(() => undefined)
                throw error
            }
        }
    }

    async function uploadFilesToVault(filesToUpload: File[], folderId: number | null, onProgress: (uploadedBytes: number, totalBytes: number) => void, signal?: AbortSignal) {
        if (!activeVaultId || !folderId) {
            throw new Error("Vault destination is unavailable")
        }

        const dek = getVaultKey(activeVaultId)
        if (!dek) {
            throw new Error("Unlock this vault before uploading files")
        }

        const totalBytes = filesToUpload.reduce((sum, file) => sum + file.size, 0)
        let uploadedBytes = 0
        const throwIfAborted = () => {
            if (signal?.aborted) {
                throw new DOMException("Upload cancelled", "AbortError")
            }
        }

        for (const file of filesToUpload) {
            throwIfAborted()
            const storageId = createStorageId()
            const encryptedMetadata = await encryptMetadata(dek, file.name)
            const baseIv = createFileIv()
            const chunkCount = Math.max(1, Math.ceil(file.size / CHUNK_SIZE_BYTES))
            const init = await initVaultUpload(activeVaultId, {
                parent_id: folderId,
                storage_id: storageId,
                encrypted_metadata: encryptedMetadata,
                e2ee_iv: baseIv,
                chunk_count: chunkCount,
                size: file.size,
                mime_type: file.type || "application/octet-stream",
            })

            try {
                for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
                    throwIfAborted()
                    const start = chunkIndex * CHUNK_SIZE_BYTES
                    const end = Math.min(file.size, start + CHUNK_SIZE_BYTES)
                    const chunkBuffer = await file.slice(start, end).arrayBuffer()
                    throwIfAborted()
                    const encryptedChunk = await encryptChunk(dek, chunkBuffer, baseIv, chunkIndex)
                    await uploadVaultChunk(init.upload.id, chunkIndex, encryptedChunk, signal)
                    uploadedBytes += end - start
                    onProgress(uploadedBytes, totalBytes)
                    touchVault(activeVaultId)
                }

                await completeVaultUpload(init.upload.id)
            } catch (error) {
                await abortVaultUpload(init.upload.id).catch(() => undefined)
                throw error
            }
        }
    }

    async function downloadVaultFile(file: FileItem) {
        if (!file.e2ee_iv || !file.chunk_count || !activeVaultId) {
            throw new Error("Encrypted file metadata is incomplete")
        }

        const dek = getVaultKey(activeVaultId)
        if (!dek) {
            throw new Error("Unlock this vault before downloading files")
        }

        const fileName = getDisplayName(file)
        touchVault(activeVaultId)

        const picker = "showSaveFilePicker" in window
            ? await (window as typeof window & {
                showSaveFilePicker?: (options: {
                    suggestedName: string
                }) => Promise<FileSystemFileHandle>
            }).showSaveFilePicker?.({ suggestedName: fileName })
            : null

        if (picker) {
            const writable = await picker.createWritable()
            try {
                for (let chunkIndex = 0; chunkIndex < file.chunk_count; chunkIndex += 1) {
                    const encryptedChunk = await fetchVaultChunk(file.id, chunkIndex)
                    const plaintextChunk = await decryptChunk(dek, encryptedChunk, file.e2ee_iv, chunkIndex)
                    await writable.write(new Uint8Array(plaintextChunk).buffer)
                    touchVault(activeVaultId)
                }
            } finally {
                await writable.close()
            }
            return
        }

        const blobParts: BlobPart[] = []
        for (let chunkIndex = 0; chunkIndex < file.chunk_count; chunkIndex += 1) {
            const encryptedChunk = await fetchVaultChunk(file.id, chunkIndex)
            const plaintextChunk = await decryptChunk(dek, encryptedChunk, file.e2ee_iv, chunkIndex)
            blobParts.push(new Uint8Array(plaintextChunk).buffer)
            touchVault(activeVaultId)
        }

        const url = window.URL.createObjectURL(new Blob(blobParts, { type: file.mime_type || "application/octet-stream" }))
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = fileName
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        window.URL.revokeObjectURL(url)
    }

    // Upload
    function withRelativePath(file: File, relativePath: string): File {
        const uploadFile = file as CloudPiUploadFile
        uploadFile.cloudpiRelativePath = relativePath.replace(/\\/g, "/")
        return uploadFile
    }

    function readDirectoryEntries(reader: any): Promise<any[]> {
        return new Promise((resolve, reject) => {
            const entries: any[] = []

            function readBatch() {
                reader.readEntries(
                    (batch: any[]) => {
                        if (batch.length === 0) {
                            resolve(entries)
                            return
                        }
                        entries.push(...batch)
                        readBatch()
                    },
                    reject,
                )
            }

            readBatch()
        })
    }

    function readEntryFile(entry: any): Promise<File> {
        return new Promise((resolve, reject) => entry.file(resolve, reject))
    }

    async function collectEntryFiles(entry: any, parentPath: string, output: File[]) {
        if (entry.isFile) {
            const file = await readEntryFile(entry)
            output.push(withRelativePath(file, `${parentPath}${file.name}`))
            return
        }

        if (entry.isDirectory) {
            const directoryPath = `${parentPath}${entry.name}/`
            const reader = entry.createReader()
            const entries = await readDirectoryEntries(reader)
            for (const child of entries) {
                await collectEntryFiles(child, directoryPath, output)
            }
        }
    }

    async function filesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
        const items = Array.from(dataTransfer.items || [])
        const entries = items
            .map((item) => {
                const maybeEntry = item as DataTransferItem & { webkitGetAsEntry?: () => any }
                return maybeEntry.webkitGetAsEntry?.()
            })
            .filter(Boolean)

        if (entries.length === 0) {
            return Array.from(dataTransfer.files || [])
        }

        const files: File[] = []
        for (const entry of entries) {
            await collectEntryFiles(entry, "", files)
        }
        return files
    }

    function enqueueUpload(filesArray: File[]) {
        if (filesArray.length === 0) return
        addUpload(
            filesArray,
            currentFolderId,
            () => loadFiles(),
            isInsideVault ? uploadFilesToVault : uploadRegularFilesChunked,
        )
    }

    function openUploadPicker() {
        if (isInsideVault && !isActiveVaultUnlocked) {
            setError("Unlock this vault before uploading files")
            setShowUnlockVaultDialog(true)
            return
        }

        fileInputRef.current?.click()
    }

    function handleFileDragStart(event: React.DragEvent, file: FileItem) {
        const dragIds = getDragIdsForFile(file)
        if (dragIds.length === 0) {
            event.preventDefault()
            return
        }

        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData(FILE_DRAG_TYPE, JSON.stringify(dragIds))
        event.dataTransfer.setData("text/plain", `${dragIds.length} CloudPi item${dragIds.length === 1 ? "" : "s"}`)
        setInternalDragIds(dragIds)
        setIsDragging(false)
        dragCounter.current = 0
    }

    function handleFileDragEnd() {
        setInternalDragIds([])
        setDropTargetFolderId(null)
    }

    function parseDraggedFileIds(event: React.DragEvent) {
        try {
            const raw = event.dataTransfer.getData(FILE_DRAG_TYPE)
            const parsed = JSON.parse(raw)
            if (!Array.isArray(parsed)) return []
            return parsed.map(Number).filter((id) => Number.isInteger(id) && id > 0)
        } catch {
            return []
        }
    }

    function handleFolderDragOver(event: React.DragEvent, folder: FileItem) {
        if (!isInternalFileDrag(event) || !canDropOnFolder(folder)) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = "move"
        setDropTargetFolderId(folder.id)
    }

    function handleFolderDragLeave(event: React.DragEvent, folder: FileItem) {
        if (!isInternalFileDrag(event)) return
        const nextTarget = event.relatedTarget as Node | null
        if (nextTarget && event.currentTarget.contains(nextTarget)) return
        if (dropTargetFolderId === folder.id) {
            setDropTargetFolderId(null)
        }
    }

    async function handleFolderDrop(event: React.DragEvent, folder: FileItem) {
        if (!isInternalFileDrag(event) || !canDropOnFolder(folder)) return
        event.preventDefault()
        event.stopPropagation()

        const ids = parseDraggedFileIds(event).filter((id) => id !== folder.id)
        setDropTargetFolderId(null)
        setInternalDragIds([])
        if (ids.length === 0) return

        try {
            for (const id of ids) {
                await moveFile(id, folder.id)
            }
            setSelectedFiles([])
            setLastSelectedFileId(null)
            setIsSelecting(false)
            await loadFiles()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Move failed")
            await loadFiles()
        }
    }

    async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const fileList = e.target.files
        if (!fileList || fileList.length === 0) return

        enqueueUpload(Array.from(fileList))

        // Reset input
        if (fileInputRef.current) {
            fileInputRef.current.value = ""
        }
    }

    async function handleFolderUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const fileList = e.target.files
        if (!fileList || fileList.length === 0) return

        if (isInsideVault) {
            setError("Folder upload into encrypted vaults is not supported yet")
        } else {
            enqueueUpload(Array.from(fileList))
        }

        if (folderInputRef.current) {
            folderInputRef.current.value = ""
        }
    }

    // Drag and drop handlers
    function handleDragEnter(e: React.DragEvent) {
        e.preventDefault()
        e.stopPropagation()
        if (isInternalFileDrag(e)) return
        if (isInsideVault && !isActiveVaultUnlocked) return
        dragCounter.current++
        if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
            setIsDragging(true)
        }
    }

    function handleDragLeave(e: React.DragEvent) {
        e.preventDefault()
        e.stopPropagation()
        if (isInternalFileDrag(e)) return
        dragCounter.current--
        if (dragCounter.current === 0) {
            setIsDragging(false)
        }
    }

    function handleDragOver(e: React.DragEvent) {
        e.preventDefault()
        e.stopPropagation()
        if (isInternalFileDrag(e)) {
            e.dataTransfer.dropEffect = "none"
        }
    }

    async function handleDrop(e: React.DragEvent) {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)
        dragCounter.current = 0

        if (isInternalFileDrag(e)) {
            setInternalDragIds([])
            setDropTargetFolderId(null)
            return
        }

        if (isInsideVault && !isActiveVaultUnlocked) {
            setError("Unlock this vault before uploading files")
            return
        }

        const filesArray = await filesFromDataTransfer(e.dataTransfer)
        if (filesArray.some((file) => (file as CloudPiUploadFile).cloudpiRelativePath) && isInsideVault) {
            setError("Folder upload into encrypted vaults is not supported yet")
            return
        }
        enqueueUpload(filesArray)
    }

    // Download (supports both files and folders — folders download as ZIP)
    async function handleDownload(file: FileItem) {
        try {
            if (isShareShortcut(file)) {
                if (!file.share_id) throw new Error("Shared shortcut is missing its share reference")
                if (file.share_allow_download === 0) throw new Error("Downloads are disabled for this share")
                const fileName = file.type === 'folder' ? `${getDisplayName(file)}.zip` : getDisplayName(file)
                await downloadIncomingShare(file.share_id, fileName)
                return
            }
            if (isSecureItem(file)) {
                if (file.type === "folder") {
                    throw new Error("Vault folders cannot be downloaded as server-side ZIP archives yet")
                }
                await downloadVaultFile(file)
                return
            }
            if (!ensureFileAvailable(file, "download it")) return
            const displayName = getDisplayName(file)
            const fileName = file.type === 'folder' ? `${displayName}.zip` : displayName
            await downloadFile(file.id, fileName)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Download failed")
        }
    }

    async function handleDuplicate(file: FileItem) {
        if (isShareShortcut(file)) {
            setError("Shared shortcuts cannot be duplicated")
            return
        }
        if (isSecureItem(file)) {
            setError("Encrypted vault items cannot be duplicated yet")
            return
        }
        if (!ensureFileAvailable(file, "duplicate it")) return
        try {
            await copyFile(file.id, file.parent_id ?? null)
            await loadFiles()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Duplicate failed")
        }
    }

    // Share
    async function handleShare(file: FileItem) {
        if (isShareShortcut(file)) {
            setError("Shared shortcuts are managed from the Shares page")
            return
        }
        if (isSecureItem(file)) {
            setError("Encrypted vault items cannot be shared yet")
            return
        }
        if (!ensureFileAvailable(file, "share it")) return
        setShareFile(file)
        setShareFiles([file])
        setShowShareDialog(true)
        setShareLoading(true)
        setSelectedShareUsers([])
        setShareUserQuery("")
        setSharePermission("view")
        setShareExpiry("")
        setAllowShareDownload(true)
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

    async function handleBulkShare() {
        const targets = getSelectedRegularItems()
        if (targets.length === 0) return
        if (targets.some((file) => isSecureItem(file))) {
            setError("Encrypted vault items cannot be shared yet")
            return
        }
        if (!ensureFilesAvailable(targets, "share it")) return

        setShareFile(targets[0])
        setShareFiles(targets)
        setShowShareDialog(true)
        setShareLoading(true)
        setSelectedShareUsers([])
        setShareUserQuery("")
        setSharePermission("view")
        setShareExpiry("")
        setAllowShareDownload(true)
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
        const targets = shareFiles.length > 0 ? shareFiles : (shareFile ? [shareFile] : [])
        if (targets.length === 0 || selectedShareUsers.length === 0) return
        if (!ensureFilesAvailable(targets, "share it")) return
        setIsSharing(true)
        setShareStatus(null)

        const results: string[] = []
        const updated: string[] = []
        let hadError = false

        const shareOptions = {
            expiresAt: shareExpiry || null,
            allowDownload: allowShareDownload,
        }

        for (const file of targets) {
            for (const userId of selectedShareUsers) {
                try {
                    const result = await createShareLink(file.id, userId, sharePermission, shareOptions)
                    const user = shareUsers.find(u => u.id === userId)
                    const label = targets.length > 1
                        ? `${getDisplayName(file)} -> ${user?.username || 'user'}`
                        : (user?.username || 'user')
                    if (result.message.includes('updated')) {
                        updated.push(label)
                    } else {
                        results.push(label)
                    }
                } catch {
                    hadError = true
                }
            }
        }

        setIsSharing(false)
        setSelectedShareUsers([])
        setSelectedFiles([])
        setLastSelectedFileId(null)
        setIsSelecting(false)
        await loadFiles()

        if (results.length > 0 && updated.length > 0) {
            setShareStatus({
                type: 'warning',
                message: targets.length > 1
                    ? `Shared ${results.length} access rule(s). Updated ${updated.length}.`
                    : `Shared with ${results.join(', ')}. Updated ${updated.join(', ')}.`
            })
        } else if (results.length > 0) {
            setShareStatus({
                type: 'success',
                message: targets.length > 1
                    ? `Successfully shared ${targets.length} item(s).`
                    : `Successfully shared with ${results.join(', ')}!`
            })
        } else if (updated.length > 0) {
            setShareStatus({
                type: 'warning',
                message: targets.length > 1
                    ? `Updated ${updated.length} access rule(s).`
                    : `Updated share settings for ${updated.join(', ')}.`
            })
        } else if (hadError) {
            setShareStatus({
                type: 'error',
                message: 'Failed to share. Please try again.'
            })
        }
    }

    async function loadVersionHistory(fileId: number) {
        setVersionLoading(true)
        setVersionError(null)
        try {
            const history = await getFileVersions(fileId)
            setVersionHistory(history)
        } catch (err) {
            setVersionError(err instanceof Error ? err.message : "Failed to load version history")
        } finally {
            setVersionLoading(false)
        }
    }

    function openVersionHistory(file: FileItem) {
        if (!canShowVersions(file)) {
            setError(isFileAccessible(file)
                ? "Version history is only available for regular files"
                : getUnavailableActionMessage(file, "view version history"))
            return
        }

        setDetailFile(null)
        setVersionFile(file)
        setVersionHistory(null)
        setVersionAction(null)
        loadVersionHistory(file.id)
    }

    async function handleVersionAction() {
        if (!versionFile || !versionAction) return
        if (!ensureFileAvailable(versionFile, "change its version history")) return

        setVersionActionBusy(true)
        setVersionError(null)

        try {
            if (versionAction.type === "restore") {
                const result = await restoreArchivedFileVersion(versionFile.id, versionAction.version.id)
                const updatedFile = { ...versionFile, ...result.file }
                setVersionFile(updatedFile)
                setFiles(prev => prev.map(file => file.id === updatedFile.id ? { ...file, ...updatedFile } : file))
                if (detailFile?.id === updatedFile.id) setDetailFile(updatedFile)
                await loadVersionHistory(updatedFile.id)
            } else {
                await deleteArchivedFileVersion(versionFile.id, versionAction.version.id)
                await loadVersionHistory(versionFile.id)
            }

            setVersionAction(null)
            await loadFiles()
        } catch (err) {
            setVersionError(err instanceof Error ? err.message : "Version action failed")
        } finally {
            setVersionActionBusy(false)
        }
    }

    // Rename
    function openRenameDialog(file: FileItem) {
        if (isShareShortcut(file)) {
            setError("Shared shortcuts cannot be renamed here")
            return
        }
        if (!ensureFileAvailable(file, "rename it")) return
        setSelectedItem(file)
        setRenameValue(getDisplayName(file))
        setShowRenameDialog(true)
    }

    async function handleRename() {
        if (!selectedItem || !renameValue.trim()) return
        if (!ensureFileAvailable(selectedItem, "rename it")) return
        try {
            if (isSecureItem(selectedItem) && !selectedItem.is_secure_vault) {
                if (!activeVaultId) {
                    throw new Error("Vault context is unavailable")
                }
                const dek = getVaultKey(activeVaultId)
                if (!dek) {
                    throw new Error("Unlock this vault before renaming encrypted items")
                }
                await renameVaultItem(selectedItem.id, await encryptMetadata(dek, renameValue.trim()))
                touchVault(activeVaultId)
            } else {
                await renameFile(selectedItem.id, renameValue.trim())
            }
            setShowRenameDialog(false)
            loadFiles()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Rename failed")
        }
    }

    async function loadDestinationView(parentId: number | null) {
        setDestinationLoading(true)
        try {
            const data = await getFiles(parentId)
            const folders = data.files.filter((file) => file.type === "folder")
            setDestinationFolders(folders)
            setDestinationBreadcrumbs(data.breadcrumbs)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load destination folders")
        } finally {
            setDestinationLoading(false)
        }
    }

    async function openLocationDialog(file: FileItem, mode: "move" | "copy") {
        if (isShareShortcut(file)) {
            setError("Shared shortcuts stay in My Files until you remove the shortcut")
            return
        }
        if (isSecureItem(file)) {
            setError(`${mode === "move" ? "Moving" : "Copying"} encrypted vault items is not supported yet`)
            return
        }
        if (!ensureFileAvailable(file, mode === "move" ? "move it" : "copy it")) return
        setLocationTarget(file)
        setLocationTargets([file])
        setLocationMode(mode)
        setShowLocationDialog(true)
        const initialParent = currentFolderId
        setDestinationFolderId(initialParent)
        await loadDestinationView(initialParent)
    }

    async function openBulkLocationDialog(mode: "move" | "copy") {
        const targets = getSelectedRegularItems()
        if (targets.length === 0) return
        if (targets.some((file) => isSecureItem(file))) {
            setError(`${mode === "move" ? "Moving" : "Copying"} encrypted vault items is not supported yet`)
            return
        }
        if (!ensureFilesAvailable(targets, mode === "move" ? "move it" : "copy it")) return

        setLocationTarget(null)
        setLocationTargets(targets)
        setLocationMode(mode)
        setShowLocationDialog(true)
        const initialParent = currentFolderId
        setDestinationFolderId(initialParent)
        await loadDestinationView(initialParent)
    }

    async function handleDestinationNavigate(folderId: number | null) {
        setDestinationFolderId(folderId)
        await loadDestinationView(folderId)
    }

    async function applyLocationAction() {
        const targets = locationTargets.length > 0 ? locationTargets : (locationTarget ? [locationTarget] : [])
        if (targets.length === 0 || isApplyingLocation) return
        if (!ensureFilesAvailable(targets, locationMode === "move" ? "move it" : "copy it")) return

        setIsApplyingLocation(true)
        try {
            for (const target of targets) {
                if (locationMode === "move") {
                    await moveFile(target.id, destinationFolderId)
                } else {
                    await copyFile(target.id, destinationFolderId)
                }
            }
            setShowLocationDialog(false)
            setLocationTarget(null)
            setLocationTargets([])
            setSelectedFiles([])
            setLastSelectedFileId(null)
            setIsSelecting(false)
            await loadFiles()
        } catch (err) {
            setError(err instanceof Error ? err.message : `${locationMode === "move" ? "Move" : "Copy"} failed`)
        } finally {
            setIsApplyingLocation(false)
        }
    }

    // Star
    async function handleToggleStar(file: FileItem) {
        if (isShareShortcut(file)) {
            setError("Shared shortcuts cannot be starred")
            return
        }
        if (!ensureFileAvailable(file, file.starred ? "unstar it" : "star it")) return
        try {
            await toggleStar(file.id)
            loadFiles()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update star")
        }
    }

    // Delete
    function openDeleteDialog(file: FileItem) {
        if (isShareShortcut(file)) {
            handleRemoveShortcut(file)
            return
        }
        if (!ensureFileAvailable(file, "delete it")) return
        setSelectedItem(file)
        setShowDeleteDialog(true)
    }

    async function handleDelete() {
        if (!selectedItem) return
        if (!ensureFileAvailable(selectedItem, "delete it")) return
        try {
            await deleteFile(selectedItem.id)
            setShowDeleteDialog(false)
            loadFiles()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Delete failed")
        }
    }

    async function handleRemoveShortcut(file: FileItem) {
        if (!file.share_id) return
        try {
            await removeShareShortcut(file.share_id)
            if (detailFile?.id === file.id) setDetailFile(null)
            if (browsingShortcut?.id === file.id) closeShortcutBrowser()
            await loadFiles()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to remove shortcut")
        }
    }

    // Bulk delete
    async function handleBulkDelete() {
        try {
            const selected = getSelectedRegularItems()
            if (!ensureFilesAvailable(selected, "delete it")) return
            for (const file of selected) {
                await deleteFile(file.id)
            }
            setSelectedFiles([])
            setLastSelectedFileId(null)
            loadFiles()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Delete failed")
        }
    }

    async function handleBulkStar() {
        try {
            const selected = files.filter((file) => selectedFiles.includes(file.id) && !isShareShortcut(file))
            if (!ensureFilesAvailable(selected, "star it")) return
            for (const file of selected) {
                if (file.starred !== 1) {
                    await toggleStar(file.id)
                }
            }
            await loadFiles()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update starred items")
        }
    }

    async function handleBulkDownload() {
        const selected = getSelectedRegularItems()
        if (selected.length === 0) return
        if (!ensureFilesAvailable(selected, "download it")) return
        if (selected.some((file) => isSecureItem(file))) {
            setError("Encrypted vault items cannot be included in server-side ZIP downloads yet")
            return
        }

        try {
            const currentName = currentFolder ? getDisplayName(currentFolder) : "cloudpi-selection"
            const fileName = selected.length === 1
                ? `${getDisplayName(selected[0])}.zip`
                : `${currentName || "cloudpi-selection"}.zip`
            await downloadFilesZip(selected.map((file) => file.id), fileName)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Bulk download failed")
        }
    }

    function getSelectedRegularItems() {
        return filteredFiles.filter((file) => selectedFiles.includes(file.id) && !isShareShortcut(file))
    }

    function openSelectedItem() {
        if (selectedFiles.length !== 1) return
        const selected = filteredFiles.find((file) => file.id === selectedFiles[0])
        if (!selected || !isFileAccessible(selected)) return
        if (selected.type === "folder") {
            handleFileClick(selected)
        } else {
            openPreview(selected)
        }
    }

    function renameSelectedItem() {
        if (selectedFiles.length !== 1) return
        const selected = filteredFiles.find((file) => file.id === selectedFiles[0])
        if (selected && !isShareShortcut(selected)) {
            openRenameDialog(selected)
        }
    }

    function goUpFolder() {
        const parent = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2] : null
        navigateToFolder(parent?.id ?? null)
    }

    function selectAllVisible() {
        const ids = filteredFiles.filter((file) => !isShareShortcut(file)).map((file) => file.id)
        setIsSelecting(true)
        setSelectedFiles(ids)
        setLastSelectedFileId(ids.length > 0 ? ids[ids.length - 1] : null)
    }

    function getPreviewSibling(direction: -1 | 1) {
        if (!previewFile) return null
        const previewable = filteredFiles.filter((file) =>
            file.type !== "folder" &&
            isFileAccessible(file) &&
            (isShareShortcut(file) || !isSecureItem(file))
        )
        const index = previewable.findIndex((file) => file.id === previewFile.id)
        if (index === -1) return null
        return previewable[index + direction] || null
    }

    function navigatePreviewSibling(direction: -1 | 1) {
        const next = getPreviewSibling(direction)
        if (next) openPreview(next)
    }

    function resetImagePreviewState() {
        setImageZoom(1)
        setImageRotation(0)
        setImagePan({ x: 0, y: 0 })
        setIsImagePanning(false)
    }

    function updateImageZoom(nextZoom: number) {
        setImageZoom(Math.min(4, Math.max(0.5, Number(nextZoom.toFixed(2)))))
    }

    function zoomImage(delta: number) {
        updateImageZoom(imageZoom + delta)
    }

    function handleImagePointerDown(event: React.PointerEvent<HTMLDivElement>) {
        if (imageZoom <= 1) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        imagePanStartRef.current = {
            pointerX: event.clientX,
            pointerY: event.clientY,
            panX: imagePan.x,
            panY: imagePan.y,
        }
        setIsImagePanning(true)
    }

    function handleImagePointerMove(event: React.PointerEvent<HTMLDivElement>) {
        if (!isImagePanning) return
        const start = imagePanStartRef.current
        setImagePan({
            x: start.panX + event.clientX - start.pointerX,
            y: start.panY + event.clientY - start.pointerY,
        })
    }

    function handleImagePointerUp(event: React.PointerEvent<HTMLDivElement>) {
        if (!isImagePanning) return
        event.currentTarget.releasePointerCapture(event.pointerId)
        setIsImagePanning(false)
    }

    function handleImageWheel(event: React.WheelEvent<HTMLDivElement>) {
        event.preventDefault()
        updateImageZoom(imageZoom + (event.deltaY < 0 ? 0.15 : -0.15))
    }

    async function copyPreviewText() {
        if (!previewTextContent) return
        try {
            await navigator.clipboard.writeText(previewTextContent)
            setPreviewTextCopied(true)
            window.setTimeout(() => setPreviewTextCopied(false), 1200)
        } catch {
            setError("Could not copy preview text")
        }
    }

    function renderHighlightedLine(line: string, file: FileItem, lineIndex: number) {
        if (!isCodePreviewFile(file)) return line || "\u00A0"

        const ext = getFileExtension(getDisplayName(file))
        if (ext === "md" || ext === "markdown") {
            if (/^#{1,6}\s/.test(line)) return <span className="font-semibold text-sky-300">{line}</span>
            if (/^```/.test(line)) return <span className="text-emerald-300">{line}</span>
            if (/^\s*[-*+]\s/.test(line)) return <span className="text-violet-300">{line}</span>
        }

        if (ext === "env" || ext === "ini") {
            const envMatch = line.match(/^([^=#\s][^=]*)(=)(.*)$/)
            if (envMatch) {
                return (
                    <>
                        <span className="text-sky-300">{envMatch[1]}</span>
                        <span className="text-white/60">{envMatch[2]}</span>
                        <span className="text-amber-200">{envMatch[3]}</span>
                    </>
                )
            }
        }

        const parts: React.ReactNode[] = []
        const tokenPattern = /(\/\/.*|#.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|[{}()[\].,;:])/g
        let lastIndex = 0

        for (const match of line.matchAll(tokenPattern)) {
            const token = match[0]
            const index = match.index ?? 0
            if (index > lastIndex) {
                parts.push(line.slice(lastIndex, index))
            }

            let className = "text-card-foreground"
            if (token.startsWith("//") || token.startsWith("#")) className = "text-white/40"
            else if (/^["'`]/.test(token)) className = "text-emerald-300"
            else if (/^\d/.test(token)) className = "text-amber-300"
            else if (CODE_KEYWORDS.has(token)) className = "text-violet-300"
            else if (/^[{}()[\].,;:]$/.test(token)) className = "text-white/50"

            parts.push(
                <span key={`${lineIndex}-${index}`} className={className}>
                    {token}
                </span>
            )
            lastIndex = index + token.length
        }

        if (lastIndex < line.length) {
            parts.push(line.slice(lastIndex))
        }

        return parts.length > 0 ? parts : "\u00A0"
    }

    // Preview
    function openPreview(file: FileItem) {
        cancelPreviewRequest()
        const shortcut = isShareShortcut(file)
        if (!shortcut && isSecureItem(file)) {
            clearOverlays()
            setError("Encrypted vault files cannot be previewed in the browser yet. Download them to decrypt locally.")
            return
        }
        setPreviewFile(file)
        setPreviewTextContent(null)
        if (pdfBlobUrl?.startsWith('blob:')) URL.revokeObjectURL(pdfBlobUrl)
        setPdfBlobUrl(null)
        setPreviewPdfError(null)
        setPreviewTextCopied(false)
        resetImagePreviewState()
        const previewUrl = getPreviewUrlForFile(file)
        // For PDFs, fetch as a blob so browser extensions do not intercept the inline stream.
        if (isPdfPreviewFile(file)) {
            const controller = new AbortController()
            previewRequestAbortRef.current = controller
            fetch(previewUrl, {
                signal: controller.signal,
                headers: { "Accept": "application/pdf,*/*" },
            })
                .then(async (response) => {
                    if (!response.ok) {
                        throw new Error(await readPreviewError(response, "Failed to load PDF"))
                    }
                    const blob = await response.blob()
                    if (blob.size === 0) throw new Error("PDF preview returned an empty file")
                    return blob
                })
                .then((blob) => {
                    if (controller.signal.aborted) return
                    if (previewRequestAbortRef.current === controller) previewRequestAbortRef.current = null
                    // Re-create blob with correct PDF type so browser's PDF viewer renders it
                    const pdfBlob = new Blob([blob], { type: 'application/pdf' })
                    const url = URL.createObjectURL(pdfBlob)
                    setPdfBlobUrl(url)
                })
                .catch((err) => {
                    if (controller.signal.aborted) return
                    if (previewRequestAbortRef.current === controller) previewRequestAbortRef.current = null
                    setPreviewPdfError(err instanceof Error ? err.message : "Failed to load PDF")
                    setPdfBlobUrl('error')
                })
        }
        // For non-PDF documents (text, code, etc.), fetch as text
        if (isTextPreviewFile(file)) {
            const controller = new AbortController()
            previewRequestAbortRef.current = controller
            fetch(previewUrl, { signal: controller.signal })
                .then(async (response) => {
                    if (!response.ok) {
                        throw new Error(await readPreviewError(response, "Failed to load file content"))
                    }
                    return response.text()
                })
                .then((text) => {
                    if (controller.signal.aborted) return
                    if (previewRequestAbortRef.current === controller) previewRequestAbortRef.current = null
                    setPreviewTextContent(text)
                })
                .catch((err) => {
                    if (controller.signal.aborted) return
                    if (previewRequestAbortRef.current === controller) previewRequestAbortRef.current = null
                    setPreviewTextContent(err instanceof Error ? err.message : 'Failed to load file content')
                })
        }
    }

    function closePreview() {
        cancelPreviewRequest()
        if (pdfBlobUrl?.startsWith('blob:')) URL.revokeObjectURL(pdfBlobUrl)
        setPreviewFile(null)
        setPreviewTextContent(null)
        setPdfBlobUrl(null)
        setPreviewPdfError(null)
        setPreviewTextCopied(false)
        resetImagePreviewState()
    }

    async function handleDownloadShortcutFolderFile(file: FileItem) {
        if (!browsingShortcut?.share_id) return
        try {
            if (browsingShortcut.share_allow_download === 0) {
                throw new Error("Downloads are disabled for this share")
            }
            const fileName = file.type === "folder" ? `${file.name}.zip` : file.name
            await downloadSharedFile(browsingShortcut.share_id, file.id, fileName)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Download failed")
        }
    }

    function renderFileContextMenuItems(file: FileItem) {
        const isShortcut = isShareShortcut(file)
        const accessible = isFileAccessible(file)
        const previewAllowed = !isSecureItem(file) && file.type !== "folder"
        const unavailableTitle = !accessible ? "Drive disconnected" : undefined

        return (
            <>
                {isShortcut ? (
                    <>
                        <ContextMenuItem onClick={() => handleFileClick(file)}>
                            {file.type === "folder" ? (
                                <FolderOpen className="h-4 w-4 mr-2" />
                            ) : (
                                <Eye className="h-4 w-4 mr-2" />
                            )}
                            {file.type === "folder" ? "Open shared folder" : "Preview"}
                        </ContextMenuItem>
                        <ContextMenuItem
                            onClick={() => handleDownload(file)}
                            disabled={file.share_allow_download === 0}
                        >
                            <Download className="h-4 w-4 mr-2" />
                            {file.type === "folder" ? "Download ZIP" : "Download"}
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => setDetailFile(file)}>
                            <Info className="h-4 w-4 mr-2" />
                            Details
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem className="text-destructive" onClick={() => handleRemoveShortcut(file)}>
                            <Trash2 className="h-4 w-4 mr-2" />
                            Remove shortcut
                        </ContextMenuItem>
                    </>
                ) : file.type === "folder" ? (
                    <>
                        <ContextMenuItem
                            onClick={() => accessible && handleFileClick(file)}
                            disabled={!accessible}
                            title={unavailableTitle}
                        >
                            <FolderOpen className="h-4 w-4 mr-2" />
                            Open
                        </ContextMenuItem>
                        <ContextMenuItem
                            onClick={() => accessible && handleDownload(file)}
                            disabled={!accessible}
                            title={unavailableTitle}
                        >
                            <Download className="h-4 w-4 mr-2" />
                            Download as ZIP
                        </ContextMenuItem>
                    </>
                ) : (
                    <>
                        <ContextMenuItem
                            onClick={() => accessible && openPreview(file)}
                            disabled={!accessible || !previewAllowed}
                            title={unavailableTitle}
                        >
                            <Eye className="h-4 w-4 mr-2" />
                            {previewAllowed ? "Preview" : "Preview unavailable"}
                        </ContextMenuItem>
                        <ContextMenuItem
                            onClick={() => accessible && handleDownload(file)}
                            disabled={!accessible}
                            title={unavailableTitle}
                        >
                            <Download className="h-4 w-4 mr-2" />
                            Download
                        </ContextMenuItem>
                        <ContextMenuItem
                            onClick={() => accessible && openVersionHistory(file)}
                            disabled={!accessible || !canShowVersions(file)}
                            title={unavailableTitle}
                        >
                            <History className="h-4 w-4 mr-2" />
                            Version history
                        </ContextMenuItem>
                    </>
                )}
                {!isShortcut && (
                    <>
                        <ContextMenuSeparator />
                        <ContextMenuItem onClick={() => accessible && openRenameDialog(file)} disabled={!accessible} title={unavailableTitle}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Rename
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => accessible && openLocationDialog(file, "move")} disabled={!accessible} title={unavailableTitle}>
                            <Scissors className="h-4 w-4 mr-2" />
                            Move
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => accessible && openLocationDialog(file, "copy")} disabled={!accessible} title={unavailableTitle}>
                            <Copy className="h-4 w-4 mr-2" />
                            Copy
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => accessible && handleDuplicate(file)} disabled={!accessible} title={unavailableTitle}>
                            <Copy className="h-4 w-4 mr-2" />
                            Duplicate
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => accessible && handleToggleStar(file)} disabled={!accessible} title={unavailableTitle}>
                            <Star className="h-4 w-4 mr-2" />
                            {file.starred ? "Unstar" : "Star"}
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => accessible && handleShare(file)} disabled={!accessible} title={unavailableTitle}>
                            <Link2 className="h-4 w-4 mr-2" />
                            Share
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => setDetailFile(file)}>
                            <Info className="h-4 w-4 mr-2" />
                            Details
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem className="text-destructive" onClick={() => accessible && openDeleteDialog(file)} disabled={!accessible} title={unavailableTitle}>
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                        </ContextMenuItem>
                    </>
                )}
            </>
        )
    }

    useEffect(() => {
        if (!highlightedFileId || isLoading) return
        const file = files.find((item) => item.id === highlightedFileId)
        if (!file) return

        const timer = window.setTimeout(() => {
            const element = document.querySelector(`[data-file-id="${highlightedFileId}"]`)
            element?.scrollIntoView({ block: "center", behavior: "smooth" })
        }, 75)

        return () => window.clearTimeout(timer)
    }, [highlightedFileId, files, isLoading])

    useEffect(() => {
        if (isLoading) return

        const handleOpenUploadPicker = () => openUploadPicker()
        const handleRefreshFiles = () => loadFiles()

        window.addEventListener(OPEN_FILE_UPLOAD_PICKER_EVENT, handleOpenUploadPicker)
        window.addEventListener(REFRESH_FILES_EVENT, handleRefreshFiles)

        return () => {
            window.removeEventListener(OPEN_FILE_UPLOAD_PICKER_EVENT, handleOpenUploadPicker)
            window.removeEventListener(REFRESH_FILES_EVENT, handleRefreshFiles)
        }
    }, [isLoading, isInsideVault, isActiveVaultUnlocked, currentFolderId])

    useEffect(() => {
        function isTypingTarget(target: EventTarget | null) {
            if (!(target instanceof HTMLElement)) return false
            const tagName = target.tagName.toLowerCase()
            return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (previewFile) {
                if (event.key === "Escape") {
                    event.preventDefault()
                    closePreview()
                } else if (event.key === "ArrowLeft") {
                    event.preventDefault()
                    navigatePreviewSibling(-1)
                } else if (event.key === "ArrowRight") {
                    event.preventDefault()
                    navigatePreviewSibling(1)
                }
                return
            }

            if (isTypingTarget(event.target)) return

            const dialogOpen = showNewFolderDialog || showSecureVaultDialog || showUnlockVaultDialog ||
                showChangePinDialog || showRenameDialog || showDeleteDialog || showLocationDialog ||
                showShareDialog || showKeyboardHelp || Boolean(versionFile) || Boolean(versionAction)

            if (dialogOpen) return

            const key = event.key.toLowerCase()

            if (key === "?") {
                event.preventDefault()
                setShowKeyboardHelp(true)
                return
            }

            if ((event.ctrlKey || event.metaKey) && key === "a") {
                event.preventDefault()
                selectAllVisible()
                return
            }

            if ((event.ctrlKey || event.metaKey) && key === "u") {
                event.preventDefault()
                openUploadPicker()
                return
            }

            if (event.key === "Escape") {
                event.preventDefault()
                clearOverlays()
                setSelectedFiles([])
                setLastSelectedFileId(null)
                setIsSelecting(false)
                return
            }

            if (event.key === "Enter") {
                event.preventDefault()
                openSelectedItem()
                return
            }

            if (event.key === "F2") {
                event.preventDefault()
                renameSelectedItem()
                return
            }

            if (event.key === "Delete") {
                event.preventDefault()
                const selected = getSelectedRegularItems()
                if (selected.length === 1) {
                    openDeleteDialog(selected[0])
                } else if (selected.length > 1) {
                    handleBulkDelete()
                }
                return
            }

            if (event.key === "Backspace" || (event.altKey && event.key === "ArrowLeft")) {
                event.preventDefault()
                goUpFolder()
            }
        }

        window.addEventListener("keydown", handleKeyDown)
        return () => window.removeEventListener("keydown", handleKeyDown)
    })

    const previewPreviousFile = previewFile ? getPreviewSibling(-1) : null
    const previewNextFile = previewFile ? getPreviewSibling(1) : null
    const previewTextLines = previewTextContent?.split(/\r?\n/) || []
    const selectedRegularItems = getSelectedRegularItems()
    const selectedHasUnavailable = selectedRegularItems.some((file) => !isFileAccessible(file))
    const selectedActionDisabled = selectedRegularItems.length === 0 || selectedHasUnavailable
    const selectedUnavailableTitle = selectedHasUnavailable ? "One or more selected items are on a disconnected drive" : undefined
    const detailFileAccessible = detailFile ? isFileAccessible(detailFile) : true
    const detailUnavailableTitle = !detailFileAccessible ? "Drive disconnected" : undefined

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    if (browsingShortcut) {
        return (
            <div className="space-y-6">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={closeShortcutBrowser}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div className="min-w-0">
                        <h1 className="flex items-center gap-2 truncate text-2xl font-bold text-foreground">
                            <Folder className="h-6 w-6 shrink-0 text-blue-400" />
                            {getDisplayName(browsingShortcut)}
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            Shared by {browsingShortcut.shared_by_name || "another user"}
                        </p>
                    </div>
                </div>

                {shortcutBreadcrumbs.length > 0 && (
                    <div className="flex items-center gap-1 overflow-x-auto pb-2 text-sm">
                        {shortcutBreadcrumbs.map((crumb, index) => (
                            <div key={crumb.id} className="flex shrink-0 items-center gap-1">
                                {index > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="max-w-[180px] truncate"
                                    onClick={() => navigateShortcutFolder(crumb.id === shortcutRootFolderId ? undefined : crumb.id)}
                                >
                                    {index === 0 && <FolderOpen className="mr-1 h-4 w-4" />}
                                    {crumb.name}
                                </Button>
                            </div>
                        ))}
                    </div>
                )}

                {error && (
                    <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                        {error}
                    </div>
                )}

                {shortcutLoading ? (
                    <div className="flex h-32 items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                ) : shortcutFiles.length === 0 ? (
                    <Card className="py-12">
                        <CardContent className="flex flex-col items-center justify-center text-center">
                            <FolderOpen className="mb-4 h-12 w-12 text-muted-foreground" />
                            <h3 className="text-lg font-medium">This shared folder is empty</h3>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-3">
                        {shortcutFiles.map((file) => {
                            const Icon = getFileIcon(file.type)
                            return (
                                <Card
                                    key={file.id}
                                    className="cursor-pointer transition-colors hover:bg-secondary"
                                    onClick={() => file.type === "folder" ? navigateShortcutFolder(file.id) : openPreview(file)}
                                >
                                    <CardContent className="flex items-center gap-3 p-4">
                                        <div className="rounded-lg bg-secondary p-2.5">
                                            <Icon className={cn("h-5 w-5", getFileColor(file.type))} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate font-medium">{file.name}</p>
                                            <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="gap-2"
                                            disabled={browsingShortcut.share_allow_download === 0}
                                            onClick={(event) => {
                                                event.stopPropagation()
                                                handleDownloadShortcutFolderFile(file)
                                            }}
                                        >
                                            <Download className="h-3.5 w-3.5" />
                                            {file.type === "folder" ? "ZIP" : "Download"}
                                        </Button>
                                    </CardContent>
                                </Card>
                            )
                        })}
                    </div>
                )}
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
                    <div className="mx-4 rounded-2xl border-2 border-dashed border-primary p-8 text-center animate-pulse sm:p-16">
                        <Upload className="mx-auto mb-4 h-12 w-12 text-primary sm:h-16 sm:w-16" />
                        <p className="text-lg font-semibold text-primary sm:text-xl">Drop files here to upload</p>
                        <p className="text-sm text-muted-foreground mt-2">Files and folders will be uploaded to the current folder</p>
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
                            {getDisplayName(crumb)}
                        </Button>
                    </div>
                ))}
            </div>

            {/* Header Actions */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full flex-1 sm:max-w-md">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Search files..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                </div>
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                    {!isInsideVault && (
                        <Button
                            variant="outline"
                            className="min-w-0 flex-1 gap-2 sm:flex-none"
                            onClick={() => setShowSecureVaultDialog(true)}
                        >
                            <Lock className="h-4 w-4" />
                            <span className="truncate">Secure Vault</span>
                        </Button>
                    )}
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => {
                            clearOverlays()
                            setShowNewFolderDialog(true)
                        }}
                        disabled={isInsideVault && !isActiveVaultUnlocked}
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
                    <input
                        type="file"
                        multiple
                        ref={folderInputRef}
                        onChange={handleFolderUpload}
                        className="hidden"
                        {...{ webkitdirectory: "", directory: "" }}
                    />
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                className="min-w-0 flex-1 gap-2 sm:flex-none"
                                disabled={isInsideVault && !isActiveVaultUnlocked}
                            >
                                <Upload className="h-4 w-4" />
                                <span>Upload</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={openUploadPicker}>
                                <Upload className="h-4 w-4 mr-2" />
                                Upload files
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                disabled={isInsideVault}
                                onClick={() => folderInputRef.current?.click()}
                            >
                                <FolderOpen className="h-4 w-4 mr-2" />
                                Upload folder
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    {isInsideVault && (
                        <>
                            {isActiveVaultUnlocked ? (
                                <>
                                    <Button variant="outline" size="icon" onClick={() => setShowChangePinDialog(true)} title="Change vault PIN">
                                        <RefreshCw className="h-4 w-4" />
                                    </Button>
                                    <Button variant="outline" size="icon" onClick={() => activeVaultId && lockVault(activeVaultId)} title="Lock vault">
                                        <Lock className="h-4 w-4" />
                                    </Button>
                                </>
                            ) : (
                                <Button variant="outline" className="gap-2" onClick={() => setShowUnlockVaultDialog(true)}>
                                    <KeyRound className="h-4 w-4" />
                                    Unlock
                                </Button>
                            )}
                        </>
                    )}
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setShowKeyboardHelp(true)}
                        title="Keyboard shortcuts"
                    >
                        <Keyboard className="h-4 w-4" />
                    </Button>
                    <Button
                        variant={isSelecting ? "default" : "outline"}
                        size="icon"
                        onClick={() => {
                            setIsSelecting(!isSelecting)
                            if (isSelecting) {
                                setSelectedFiles([])
                                setLastSelectedFileId(null)
                            }
                        }}
                        title={isSelecting ? "Cancel selection" : "Select files"}
                    >
                        <CheckSquare className="h-4 w-4" />
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
                            title="List view"
                        >
                            <List className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setView("columns")}
                            className={cn(view === "columns" && "bg-secondary")}
                            title="Columns view"
                        >
                            <Columns3 className="h-4 w-4" />
                        </Button>
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon" title={`Sort by ${sortKey} (${sortDirection})`}>
                                {sortDirection === "asc" ? <SortAsc className="h-4 w-4" /> : <SortDesc className="h-4 w-4" />}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleSort("name")} className={cn(sortKey === "name" && "text-primary font-medium")}>
                                Name {sortKey === "name" && (sortDirection === "asc" ? "↑" : "↓")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleSort("modified")} className={cn(sortKey === "modified" && "text-primary font-medium")}>
                                Date modified {sortKey === "modified" && (sortDirection === "asc" ? "↑" : "↓")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleSort("size")} className={cn(sortKey === "size" && "text-primary font-medium")}>
                                Size {sortKey === "size" && (sortDirection === "asc" ? "↑" : "↓")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleSort("type")} className={cn(sortKey === "type" && "text-primary font-medium")}>
                                Type {sortKey === "type" && (sortDirection === "asc" ? "↑" : "↓")}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Filter Chips */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                {[
                    { key: null, label: "All", Icon: Filter },
                    { key: "image", label: "Images", Icon: ImageIcon },
                    { key: "document", label: "Docs", Icon: FileText },
                    { key: "video", label: "Videos", Icon: Video },
                    { key: "audio", label: "Audio", Icon: Music },
                    { key: "archive", label: "Archives", Icon: Archive },
                    { key: "other", label: "Other", Icon: FileIcon },
                    { key: "starred", label: "Starred", Icon: Star },
                ].map(({ key, label, Icon }) => (
                    <Button
                        key={key ?? "all"}
                        variant={filterType === key ? "default" : "outline"}
                        size="sm"
                        className="h-7 gap-1.5 text-xs shrink-0 rounded-full"
                        onClick={() => updateFilterType(key)}
                    >
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                    </Button>
                ))}
            </div>

            {/* Drive Status Notification Toast */}
            {notification && (
                <div className={cn(
                    "fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-lg border transition-all animate-in slide-in-from-bottom-4 duration-300",
                    notification.type === "disconnect"
                        ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-500"
                        : "bg-green-500/10 border-green-500/30 text-green-500"
                )}>
                    {notification.type === "disconnect" ? (
                        <AlertCircle className="h-5 w-5 flex-shrink-0" />
                    ) : (
                        <Check className="h-5 w-5 flex-shrink-0" />
                    )}
                    <span className="text-sm font-medium">
                        {notification.type === "disconnect"
                            ? (notification.source_id === "internal"
                                ? "Internal encrypted storage became unavailable"
                                : `Drive "${notification.label}" disconnected`)
                            : (notification.source_id === "internal"
                                ? "Internal encrypted storage is back online"
                                : `Drive "${notification.label}" is back online`)}
                    </span>
                </div>
            )}

            {/* Storage Drive Disconnected Warning (real-time via SSE) */}
            {disconnectedDrives.length > 0 && (
                <Card className="bg-yellow-500/10 border-yellow-500/30">
                    <CardContent className="py-3 flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-yellow-500">
                                {disconnectedDrives.length === 1
                                    ? getStorageDisconnectTitle(disconnectedDrives[0])
                                    : "Storage Unavailable"}
                            </p>
                            <p className="text-sm text-yellow-500/80 mt-0.5">
                                {getDisconnectBannerMessage(disconnectedDrives)}
                            </p>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Legacy storage warning (from API, as fallback) */}
            {storageWarning && disconnectedDrives.length === 0 && (
                <Card className="bg-yellow-500/10 border-yellow-500/30">
                    <CardContent className="py-3 flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-yellow-500">Storage Drive Disconnected</p>
                            <p className="text-sm text-yellow-500/80 mt-0.5">{storageWarning}</p>
                        </div>
                    </CardContent>
                </Card>
            )}

            {isInsideVault && (
                <Card className={cn(
                    isActiveVaultUnlocked ? "bg-emerald-500/10 border-emerald-500/30" : "bg-amber-500/10 border-amber-500/30"
                )}>
                    <CardContent className="py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex items-start gap-3">
                            {isActiveVaultUnlocked ? (
                                <Lock className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
                            ) : (
                                <ShieldAlert className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                            )}
                            <div>
                                <p className={cn(
                                    "text-sm font-medium",
                                    isActiveVaultUnlocked ? "text-emerald-500" : "text-amber-500",
                                )}>
                                    {isActiveVaultUnlocked ? "Vault unlocked" : "Vault locked"}
                                </p>
                                <p className={cn(
                                    "text-sm mt-0.5",
                                    isActiveVaultUnlocked ? "text-emerald-500/80" : "text-amber-500/80",
                                )}>
                                    {isActiveVaultUnlocked
                                        ? `${getDisplayName(currentVault || { id: 0, name: "Vault" })} is using end-to-end encryption. The DEK will be evicted from memory after 15 minutes of inactivity.`
                                        : "Enter the vault PIN to decrypt filenames and access file contents. If you lose the PIN, the data cannot be recovered."}
                                </p>
                            </div>
                        </div>
                        {!isActiveVaultUnlocked && (
                            <Button className="gap-2 self-start md:self-auto" onClick={() => setShowUnlockVaultDialog(true)}>
                                <KeyRound className="h-4 w-4" />
                                Unlock Vault
                            </Button>
                        )}
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
            {isSelecting && (
                <Card className="sticky bottom-3 z-30 bg-secondary/95 border-border shadow-lg backdrop-blur supports-[backdrop-filter]:bg-secondary/85">
                    <CardContent className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                            <span className="text-sm text-secondary-foreground">
                                {selectedFiles.length} item(s) selected
                            </span>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="gap-2"
                                onClick={() => {
                                    const selectableCount = filteredFiles.filter(f => !isShareShortcut(f)).length
                                    if (selectedFiles.length === selectableCount) {
                                        setSelectedFiles([])
                                        setLastSelectedFileId(null)
                                    } else {
                                        setSelectedFiles(filteredFiles.filter(f => !isShareShortcut(f)).map(f => f.id))
                                        const selectable = filteredFiles.filter(f => !isShareShortcut(f)).map(f => f.id)
                                        setLastSelectedFileId(selectable.length > 0 ? selectable[selectable.length - 1] : null)
                                    }
                                }}
                            >
                                <CheckSquare className="h-4 w-4" />
                                {selectedFiles.length === filteredFiles.filter(f => !isShareShortcut(f)).length ? "Deselect All" : "Select All"}
                            </Button>
                        </div>
                        <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center">
                            {selectedFiles.length > 0 && (
                                <>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="gap-2 justify-center"
                                        onClick={handleBulkDownload}
                                        disabled={selectedActionDisabled}
                                        title={selectedUnavailableTitle}
                                    >
                                        <Download className="h-4 w-4" />
                                        <span className="hidden sm:inline">ZIP</span>
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="gap-2 justify-center"
                                        onClick={handleBulkStar}
                                        disabled={selectedActionDisabled}
                                        title={selectedUnavailableTitle}
                                    >
                                        <Star className="h-4 w-4" />
                                        <span className="hidden sm:inline">Star</span>
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="gap-2 justify-center"
                                        onClick={() => openBulkLocationDialog("move")}
                                        disabled={selectedActionDisabled}
                                        title={selectedUnavailableTitle}
                                    >
                                        <Scissors className="h-4 w-4" />
                                        <span className="hidden sm:inline">Move</span>
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="gap-2 justify-center"
                                        onClick={() => openBulkLocationDialog("copy")}
                                        disabled={selectedActionDisabled}
                                        title={selectedUnavailableTitle}
                                    >
                                        <Copy className="h-4 w-4" />
                                        <span className="hidden sm:inline">Copy</span>
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="gap-2 justify-center"
                                        onClick={handleBulkShare}
                                        disabled={selectedActionDisabled}
                                        title={selectedUnavailableTitle}
                                    >
                                        <Link2 className="h-4 w-4" />
                                        <span className="hidden sm:inline">Share</span>
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="gap-2 justify-center text-destructive"
                                        onClick={handleBulkDelete}
                                        disabled={selectedActionDisabled}
                                        title={selectedUnavailableTitle}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                        <span className="hidden sm:inline">Delete</span>
                                    </Button>
                                </>
                            )}
                            <Button
                                variant="ghost"
                                size="sm"
                                className="justify-center"
                                onClick={() => { setIsSelecting(false); setSelectedFiles([]) }}
                            >
                                <X className="h-4 w-4" />
                                <span className="hidden sm:inline">Cancel</span>
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {isInsideVault && !isActiveVaultUnlocked && !isLoading && (
                <Card className="py-12">
                    <CardContent className="flex flex-col items-center justify-center text-center">
                        <Lock className="h-16 w-16 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-medium">Vault is locked</h3>
                        <p className="text-muted-foreground mt-1">
                            Unlock this vault to reveal encrypted filenames and access file contents.
                        </p>
                        <Button className="mt-4 gap-2" onClick={() => setShowUnlockVaultDialog(true)}>
                            <KeyRound className="h-4 w-4" />
                            Unlock Vault
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* Empty State */}
            {(!isInsideVault || isActiveVaultUnlocked) && view !== "columns" && filteredFiles.length === 0 && !isLoading && (
                <Card className="py-12">
                    <CardContent className="flex flex-col items-center justify-center text-center">
                        <FolderOpen className="h-16 w-16 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-medium">
                            {searchQuery || filterType ? "No matching files" : "This folder is empty"}
                        </h3>
                        <p className="text-muted-foreground mt-1">
                            {searchQuery || filterType
                                ? "Try clearing search or filters to broaden the view"
                                : isInsideVault
                                    ? "Upload encrypted files or create encrypted folders to get started"
                                    : "Upload files or create a folder to get started"}
                        </p>
                        <div className="flex flex-wrap justify-center gap-2 mt-4">
                            {searchQuery || filterType ? (
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setSearchQuery("")
                                        updateFilterType(null)
                                    }}
                                >
                                    Clear filters
                                </Button>
                            ) : (
                                <>
                                    <Button
                                        variant="outline"
                                        onClick={() => setShowNewFolderDialog(true)}
                                    >
                                        <FolderPlus className="h-4 w-4 mr-2" />
                                        New Folder
                                    </Button>
                                    <Button onClick={openUploadPicker}>
                                        <Upload className="h-4 w-4 mr-2" />
                                        Upload Files
                                    </Button>
                                    {!isInsideVault && (
                                        <Button variant="outline" onClick={() => folderInputRef.current?.click()}>
                                            <FolderOpen className="h-4 w-4 mr-2" />
                                            Upload Folder
                                        </Button>
                                    )}
                                </>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Files Columns */}
            {(!isInsideVault || isActiveVaultUnlocked) && view === "columns" && !isLoading && (
                <Card className="bg-card border-border overflow-hidden">
                    <CardHeader className="border-b border-border px-4 py-3">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h3 className="text-sm font-medium">Columns</h3>
                                <p className="text-xs text-muted-foreground">
                                    Browse folders side by side. The rightmost column is your current folder.
                                </p>
                            </div>
                            {columnsLoading && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Loading
                                </div>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {columnsError ? (
                            <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
                                <AlertCircle className="h-10 w-10 text-destructive" />
                                <div>
                                    <p className="text-sm font-medium">Columns view could not load</p>
                                    <p className="text-sm text-muted-foreground">{columnsError}</p>
                                </div>
                                <Button variant="outline" size="sm" onClick={loadColumnsForPath}>
                                    Try again
                                </Button>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <div className="flex min-h-[420px] w-max min-w-full">
                                    {(columns.length > 0 ? columns : [{ folderId: currentFolderId, title: currentFolder ? getDisplayName(currentFolder) : "My Files", files }]).map((column) => {
                                        const visibleColumnFiles = getSortedVisibleFiles(column.files)
                                        const isActiveColumn = column.folderId === currentFolderId
                                        return (
                                            <div
                                                key={column.folderId ?? "root"}
                                                className={cn(
                                                    "w-[min(82vw,20rem)] shrink-0 border-r border-border last:border-r-0 sm:w-80",
                                                    isActiveColumn && "bg-secondary/20"
                                                )}
                                            >
                                                <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-card/95 px-3 py-2 backdrop-blur">
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-medium">{getColumnTitle(column)}</p>
                                                        <p className="text-xs text-muted-foreground">
                                                            {visibleColumnFiles.length} item{visibleColumnFiles.length === 1 ? "" : "s"}
                                                        </p>
                                                    </div>
                                                    {isActiveColumn && (
                                                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                                                            Current
                                                        </Badge>
                                                    )}
                                                </div>
                                                <div className="space-y-1 p-2">
                                                    {visibleColumnFiles.length === 0 ? (
                                                        <div className="flex min-h-32 flex-col items-center justify-center rounded-md border border-dashed border-border px-3 py-8 text-center">
                                                            <FolderOpen className="mb-2 h-8 w-8 text-muted-foreground" />
                                                            <p className="text-sm font-medium">
                                                                {searchQuery || filterType ? "No matching files" : "This folder is empty"}
                                                            </p>
                                                            <p className="text-xs text-muted-foreground">
                                                                {searchQuery || filterType ? "Clear search or filters to show more" : "Drop files here or use Upload"}
                                                            </p>
                                                        </div>
                                                    ) : (
                                                        visibleColumnFiles.map((file) => {
                                                            const Icon = getFileIcon(file.type)
                                                            const isShortcut = isShareShortcut(file)
                                                            const accessible = isFileAccessible(file)
                                                            const draggable = canDragFile(file)
                                                            const isDropTarget = dropTargetFolderId === file.id && canDropOnFolder(file)
                                                            return (
                                                                <ContextMenu key={file.id}>
                                                                    <ContextMenuTrigger asChild>
                                                                        <div
                                                                            data-file-id={file.id}
                                                                            draggable={draggable}
                                                                            onDragStart={(event) => handleFileDragStart(event, file)}
                                                                            onDragEnd={handleFileDragEnd}
                                                                            onDragOver={(event) => handleFolderDragOver(event, file)}
                                                                            onDragLeave={(event) => handleFolderDragLeave(event, file)}
                                                                            onDrop={(event) => handleFolderDrop(event, file)}
                                                                            className={cn(
                                                                                "group flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-secondary",
                                                                                draggable && "cursor-grab active:cursor-grabbing",
                                                                                selectedFiles.includes(file.id) && "bg-primary/10 text-primary",
                                                                                highlightedFileId === file.id && "bg-amber-400/10 ring-1 ring-inset ring-amber-400/60",
                                                                                isDropTarget && "bg-primary/10 ring-1 ring-inset ring-primary",
                                                                                !accessible && "opacity-50",
                                                                                isSelecting && !isActiveColumn && "cursor-default"
                                                                            )}
                                                                            onClick={(event) => handleColumnItemClick(file, column, event)}
                                                                            title={!accessible ? "Drive disconnected - file temporarily unavailable" : getDisplayName(file)}
                                                                        >
                                                                    {isSelecting && isActiveColumn && (
                                                                        <Checkbox
                                                                            checked={selectedFiles.includes(file.id)}
                                                                            disabled={isShortcut}
                                                                            onCheckedChange={() => toggleFileSelection(file.id)}
                                                                            onClick={(event) => event.stopPropagation()}
                                                                            aria-label={`Select ${getDisplayName(file)}`}
                                                                        />
                                                                    )}
                                                                    <Icon className={cn("h-4 w-4 shrink-0", getFileColor(file.type))} />
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="flex min-w-0 items-center gap-1.5">
                                                                            <span className="truncate font-medium">{getDisplayName(file)}</span>
                                                                            {file.starred === 1 && !isShortcut && (
                                                                                <Star className="h-3.5 w-3.5 shrink-0 fill-yellow-400 text-yellow-400" />
                                                                            )}
                                                                            {isSecureItem(file) && (
                                                                                <Lock className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                                                                            )}
                                                                        </div>
                                                                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                                                                            <span>{file.type === "folder" ? "Folder" : formatFileSize(file.size)}</span>
                                                                            {isShortcut && <span>Shortcut</span>}
                                                                            {Number(file.shared_count || 0) > 0 && !isShortcut && <span>Shared</span>}
                                                                        </div>
                                                                    </div>
                                                                    {file.type === "folder" ? (
                                                                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                                                    ) : (
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            className="h-7 w-7 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                                                                            onClick={(event) => {
                                                                                event.stopPropagation()
                                                                                setDetailFile(file)
                                                                            }}
                                                                            title="Details"
                                                                        >
                                                                            <Info className="h-3.5 w-3.5" />
                                                                        </Button>
                                                                    )}
                                                                        </div>
                                                                    </ContextMenuTrigger>
                                                                    <ContextMenuContent className="w-56">
                                                                        {renderFileContextMenuItems(file)}
                                                                    </ContextMenuContent>
                                                                </ContextMenu>
                                                            )
                                                        })
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Files Grid */}
            {(!isInsideVault || isActiveVaultUnlocked) && view === "grid" && filteredFiles.length > 0 && (
                <div className="grid gap-3 grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {filteredFiles.map((file) => {
                        const Icon = getFileIcon(file.type)
                        const isShortcut = isShareShortcut(file)
                        const accessible = isFileAccessible(file)
                        const previewAllowed = !isSecureItem(file) && file.type !== "folder"
                        const draggable = canDragFile(file)
                        const isDropTarget = dropTargetFolderId === file.id && canDropOnFolder(file)
                        return (
                            <ContextMenu key={file.id}>
                                <ContextMenuTrigger asChild>
                                    <Card
                                        data-file-id={file.id}
                                        draggable={draggable}
                                        onDragStart={(event) => handleFileDragStart(event, file)}
                                        onDragEnd={handleFileDragEnd}
                                        onDragOver={(event) => handleFolderDragOver(event, file)}
                                        onDragLeave={(event) => handleFolderDragLeave(event, file)}
                                        onDrop={(event) => handleFolderDrop(event, file)}
                                        className={cn(
                                            "group relative cursor-pointer transition-colors hover:bg-secondary",
                                            draggable && "cursor-grab active:cursor-grabbing",
                                            selectedFiles.includes(file.id) && "ring-2 ring-primary bg-primary/5",
                                            highlightedFileId === file.id && "ring-2 ring-amber-400 bg-amber-400/10",
                                            isDropTarget && "ring-2 ring-primary bg-primary/10",
                                            !accessible && "opacity-50"
                                        )}
                                        onClick={(event) => isSelecting ? toggleFileSelection(file.id, event) : (accessible ? handleFileClick(file) : null)}
                                        title={!accessible ? "Drive disconnected — file temporarily unavailable" : undefined}
                                    >
                                        <CardContent className="p-4">
                                            <div className="absolute right-2 top-2 flex items-center gap-1">
                                                {isShortcut && (
                                                    <FolderPlus className="h-4 w-4 text-primary" />
                                                )}
                                                {isSecureItem(file) && (
                                                    <Lock className="h-4 w-4 text-sky-400" />
                                                )}
                                                {file.starred === 1 && !isShortcut && (
                                                    <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                                                )}
                                                {Number(file.shared_count || 0) > 0 && !isShortcut && (
                                                    <Link2 className="h-4 w-4 text-primary" />
                                                )}
                                                {previewAllowed && !isSelecting && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 sm:opacity-0 sm:group-hover:opacity-100"
                                                        onClick={(e) => { e.stopPropagation(); openPreview(file) }}
                                                    >
                                                        <Maximize2 className="h-4 w-4" />
                                                    </Button>
                                                )}
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 sm:opacity-0 sm:group-hover:opacity-100"
                                                            onClick={(event) => event.stopPropagation()}
                                                        >
                                                            <MoreVertical className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        {isShortcut ? (
                                                            <>
                                                                <DropdownMenuItem onClick={() => handleFileClick(file)}>
                                                                    {file.type === "folder" ? (
                                                                        <FolderOpen className="h-4 w-4 mr-2" />
                                                                    ) : (
                                                                        <Eye className="h-4 w-4 mr-2" />
                                                                    )}
                                                                    {file.type === "folder" ? "Open shared folder" : "Preview"}
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem
                                                                    onClick={() => handleDownload(file)}
                                                                    disabled={file.share_allow_download === 0}
                                                                >
                                                                    <Download className="h-4 w-4 mr-2" />
                                                                    {file.type === "folder" ? "Download ZIP" : "Download"}
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem onClick={() => setDetailFile(file)}>
                                                                    <Info className="h-4 w-4 mr-2" />
                                                                    Details
                                                                </DropdownMenuItem>
                                                                <DropdownMenuSeparator />
                                                                <DropdownMenuItem
                                                                    className="text-destructive"
                                                                    onClick={() => handleRemoveShortcut(file)}
                                                                >
                                                                    <Trash2 className="h-4 w-4 mr-2" />
                                                                    Remove shortcut
                                                                </DropdownMenuItem>
                                                            </>
                                                        ) : file.type === "folder" ? (
                                                            <>
                                                                <DropdownMenuItem onClick={() => handleFileClick(file)}>
                                                                    <FolderOpen className="h-4 w-4 mr-2" />
                                                                    Open
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem
                                                                    onClick={() => accessible && handleDownload(file)}
                                                                    disabled={!accessible}
                                                                    title={!accessible ? "Drive disconnected" : undefined}
                                                                >
                                                                    <Download className="h-4 w-4 mr-2" />
                                                                    Download as ZIP
                                                                </DropdownMenuItem>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <DropdownMenuItem
                                                                    onClick={() => accessible && openPreview(file)}
                                                                    disabled={!accessible || !previewAllowed}
                                                                    title={!accessible ? "Drive disconnected" : undefined}
                                                                >
                                                                    <Eye className="h-4 w-4 mr-2" />
                                                                    {previewAllowed ? "Preview" : "Preview unavailable"}
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem
                                                                    onClick={() => accessible && handleDownload(file)}
                                                                    disabled={!accessible}
                                                                    title={!accessible ? "Drive disconnected" : undefined}
                                                                >
                                                                    <Download className="h-4 w-4 mr-2" />
                                                                    Download
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem onClick={() => openVersionHistory(file)}>
                                                                    <History className="h-4 w-4 mr-2" />
                                                                    Version history
                                                                </DropdownMenuItem>
                                                            </>
                                                        )}
                                                        {!isShortcut && (
                                                            <>
                                                                <DropdownMenuItem onClick={() => openRenameDialog(file)}>
                                                                    <Pencil className="h-4 w-4 mr-2" />
                                                                    Rename
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem onClick={() => openLocationDialog(file, "move")}>
                                                                    <Scissors className="h-4 w-4 mr-2" />
                                                                    Move
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem onClick={() => openLocationDialog(file, "copy")}>
                                                                    <Copy className="h-4 w-4 mr-2" />
                                                                    Copy
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem onClick={() => handleDuplicate(file)}>
                                                                    <Copy className="h-4 w-4 mr-2" />
                                                                    Duplicate
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem onClick={() => handleToggleStar(file)}>
                                                                    <Star className="h-4 w-4 mr-2" />
                                                                    {file.starred ? "Unstar" : "Star"}
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem onClick={() => handleShare(file)}>
                                                                    <Link2 className="h-4 w-4 mr-2" />
                                                                    Share
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem onClick={() => setDetailFile(file)}>
                                                                    <Info className="h-4 w-4 mr-2" />
                                                                    Details
                                                                </DropdownMenuItem>
                                                                <DropdownMenuSeparator />
                                                                <DropdownMenuItem
                                                                    className="text-destructive"
                                                                    onClick={() => openDeleteDialog(file)}
                                                                >
                                                                    <Trash2 className="h-4 w-4 mr-2" />
                                                                    Delete
                                                                </DropdownMenuItem>
                                                            </>
                                                        )}
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                            <div
                                                className="flex flex-col items-center pt-4"
                                                onClick={(event) => {
                                                    if (!accessible) return
                                                    if (isSelecting) {
                                                        event.stopPropagation()
                                                        toggleFileSelection(file.id, event)
                                                        return
                                                    }
                                                    if (file.type === "folder") handleFileClick(file)
                                                    else if (previewAllowed) openPreview(file)
                                                    else if (!isShortcut || file.share_allow_download !== 0) handleDownload(file)
                                                }}
                                            >
                                                {(file.type === "image" || file.type === "video") && !isSecureItem(file) && !isShortcut ? (
                                                    <div className="w-full h-20 sm:h-24 mb-2 sm:mb-3 rounded overflow-hidden bg-secondary flex items-center justify-center">
                                                        {!accessible || brokenThumbnails[file.id] ? (
                                                            <Icon className={cn("h-10 w-10 sm:h-12 sm:w-12", getFileColor(file.type))} />
                                                        ) : (
                                                            <img
                                                                src={getThumbnailUrl(file.id, 256)}
                                                                alt={getDisplayName(file)}
                                                                className="w-full h-full object-cover"
                                                                loading="lazy"
                                                                onError={(e) => {
                                                                    const target = e.currentTarget
                                                                    if (file.type === "image" && !target.dataset.fallback) {
                                                                        target.dataset.fallback = "1"
                                                                        target.src = getPreviewUrl(file.id)
                                                                        return
                                                                    }
                                                                    setBrokenThumbnails(prev => ({ ...prev, [file.id]: true }))
                                                                }}
                                                            />
                                                        )}
                                                    </div>
                                                ) : (
                                                    <Icon className={cn("h-10 w-10 sm:h-12 sm:w-12 mb-2 sm:mb-3", getFileColor(file.type))} />
                                                )}
                                                <p className="text-xs sm:text-sm font-medium text-card-foreground text-center line-clamp-2 w-full px-1" title={getDisplayName(file)}>
                                                    {getDisplayName(file)}
                                                </p>
                                                <div className="mt-1 flex items-center justify-center gap-2">
                                                    <p className="text-xs text-muted-foreground">
                                                        {formatFileSize(file.size)}
                                                    </p>
                                                    {isShortcut && (
                                                        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                                            Shortcut
                                                        </Badge>
                                                    )}
                                                    {canShowVersions(file) && getVersionNumber(file) > 1 && (
                                                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                                                            v{getVersionNumber(file)}
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </ContextMenuTrigger>
                                <ContextMenuContent className="w-48">
                                    {isShortcut ? (
                                        <>
                                            <ContextMenuItem onClick={() => handleFileClick(file)}>
                                                {file.type === "folder" ? (
                                                    <FolderOpen className="h-4 w-4 mr-2" />
                                                ) : (
                                                    <Eye className="h-4 w-4 mr-2" />
                                                )}
                                                {file.type === "folder" ? "Open shared folder" : "Preview"}
                                            </ContextMenuItem>
                                            <ContextMenuItem
                                                onClick={() => handleDownload(file)}
                                                disabled={file.share_allow_download === 0}
                                            >
                                                <Download className="h-4 w-4 mr-2" />
                                                {file.type === "folder" ? "Download ZIP" : "Download"}
                                            </ContextMenuItem>
                                            <ContextMenuItem onClick={() => setDetailFile(file)}>
                                                <Info className="h-4 w-4 mr-2" />
                                                Details
                                            </ContextMenuItem>
                                            <ContextMenuSeparator />
                                            <ContextMenuItem className="text-destructive" onClick={() => handleRemoveShortcut(file)}>
                                                <Trash2 className="h-4 w-4 mr-2" />
                                                Remove shortcut
                                            </ContextMenuItem>
                                        </>
                                    ) : file.type === "folder" ? (
                                        <>
                                            <ContextMenuItem onClick={() => handleFileClick(file)}>
                                                <FolderOpen className="h-4 w-4 mr-2" />
                                                Open
                                            </ContextMenuItem>
                                            <ContextMenuItem
                                                onClick={() => accessible && handleDownload(file)}
                                                disabled={!accessible}
                                                title={!accessible ? "Drive disconnected" : undefined}
                                            >
                                                <Download className="h-4 w-4 mr-2" />
                                                Download as ZIP
                                            </ContextMenuItem>
                                        </>
                                    ) : (
                                        <>
                                            <ContextMenuItem
                                                onClick={() => accessible && openPreview(file)}
                                                disabled={!accessible || !previewAllowed}
                                                title={!accessible ? "Drive disconnected" : undefined}
                                            >
                                                <Eye className="h-4 w-4 mr-2" />
                                                {previewAllowed ? "Preview" : "Preview unavailable"}
                                            </ContextMenuItem>
                                            <ContextMenuItem
                                                onClick={() => accessible && handleDownload(file)}
                                                disabled={!accessible}
                                                title={!accessible ? "Drive disconnected" : undefined}
                                            >
                                                <Download className="h-4 w-4 mr-2" />
                                                Download
                                            </ContextMenuItem>
                                            <ContextMenuItem onClick={() => openVersionHistory(file)}>
                                                <History className="h-4 w-4 mr-2" />
                                                Version history
                                            </ContextMenuItem>
                                        </>
                                    )}
                                    {!isShortcut && (
                                        <>
                                            <ContextMenuSeparator />
                                            <ContextMenuItem onClick={() => openRenameDialog(file)}>
                                                <Pencil className="h-4 w-4 mr-2" />
                                                Rename
                                            </ContextMenuItem>
                                            <ContextMenuItem onClick={() => openLocationDialog(file, "move")}>
                                                <Scissors className="h-4 w-4 mr-2" />
                                                Move
                                            </ContextMenuItem>
                                            <ContextMenuItem onClick={() => openLocationDialog(file, "copy")}>
                                                <Copy className="h-4 w-4 mr-2" />
                                                Copy
                                            </ContextMenuItem>
                                            <ContextMenuItem onClick={() => handleDuplicate(file)}>
                                                <Copy className="h-4 w-4 mr-2" />
                                                Duplicate
                                            </ContextMenuItem>
                                            <ContextMenuItem onClick={() => handleToggleStar(file)}>
                                                <Star className="h-4 w-4 mr-2" />
                                                {file.starred ? "Unstar" : "Star"}
                                            </ContextMenuItem>
                                            <ContextMenuItem onClick={() => handleShare(file)}>
                                                <Link2 className="h-4 w-4 mr-2" />
                                                Share
                                            </ContextMenuItem>
                                            <ContextMenuItem onClick={() => setDetailFile(file)}>
                                                <Info className="h-4 w-4 mr-2" />
                                                Details
                                            </ContextMenuItem>
                                            <ContextMenuSeparator />
                                            <ContextMenuItem className="text-destructive" onClick={() => openDeleteDialog(file)}>
                                                <Trash2 className="h-4 w-4 mr-2" />
                                                Delete
                                            </ContextMenuItem>
                                        </>
                                    )}
                                </ContextMenuContent>
                            </ContextMenu>
                        )
                    })}
                </div>
            )}

            {/* Files List */}
            {(!isInsideVault || isActiveVaultUnlocked) && view === "list" && filteredFiles.length > 0 && (
                <Card className="bg-card border-border overflow-hidden">
                    <CardHeader className="border-b border-border py-3 hidden sm:block">
                        <div className="grid grid-cols-12 gap-4 text-xs font-medium text-muted-foreground">
                            <div className="col-span-7 sm:col-span-6 flex items-center gap-3">
                                {isSelecting && (
                                    <Checkbox
                                        checked={
                                            filteredFiles.filter(f => !isShareShortcut(f)).length > 0 &&
                                            selectedFiles.length === filteredFiles.filter(f => !isShareShortcut(f)).length
                                        }
                                        onCheckedChange={() => {
                                            const selectable = filteredFiles.filter(f => !isShareShortcut(f)).map(f => f.id)
                                            if (selectedFiles.length === selectable.length) {
                                                setSelectedFiles([])
                                                setLastSelectedFileId(null)
                                            } else {
                                                setSelectedFiles(selectable)
                                                setLastSelectedFileId(selectable.length > 0 ? selectable[selectable.length - 1] : null)
                                            }
                                        }}
                                        aria-label="Select all visible files"
                                    />
                                )}
                                Name
                            </div>
                            <div className="col-span-2 hidden sm:block">Size</div>
                            <div className="col-span-3 hidden md:block">Modified</div>
                            <div className="col-span-1" />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {filteredFiles.map((file) => {
                            const Icon = getFileIcon(file.type)
                            const isShortcut = isShareShortcut(file)
                            const accessible = isFileAccessible(file)
                            const previewAllowed = !isSecureItem(file) && file.type !== "folder"
                            const draggable = canDragFile(file)
                            const isDropTarget = dropTargetFolderId === file.id && canDropOnFolder(file)
                            return (
                                <ContextMenu key={file.id}>
                                    <ContextMenuTrigger asChild>
                                        <div
                                            data-file-id={file.id}
                                            draggable={draggable}
                                            onDragStart={(event) => handleFileDragStart(event, file)}
                                            onDragEnd={handleFileDragEnd}
                                            onDragOver={(event) => handleFolderDragOver(event, file)}
                                            onDragLeave={(event) => handleFolderDragLeave(event, file)}
                                            onDrop={(event) => handleFolderDrop(event, file)}
                                            className={cn(
                                                "flex sm:grid sm:grid-cols-12 gap-2 sm:gap-4 items-center px-4 sm:px-6 py-3 border-b border-border last:border-0 hover:bg-secondary cursor-pointer",
                                                draggable && "cursor-grab active:cursor-grabbing",
                                                selectedFiles.includes(file.id) && "bg-primary/10",
                                                highlightedFileId === file.id && "bg-amber-400/10 ring-1 ring-inset ring-amber-400/60",
                                                isDropTarget && "bg-primary/10 ring-1 ring-inset ring-primary",
                                                !accessible && "opacity-50"
                                            )}
                                            onClick={(event) => isSelecting ? toggleFileSelection(file.id, event) : (accessible ? handleFileClick(file) : null)}
                                            title={!accessible ? "Drive disconnected — file temporarily unavailable" : undefined}
                                        >
                                    <div
                                        className="flex-1 sm:col-span-7 md:col-span-6 flex items-center gap-3 min-w-0"
                                    >
                                        {isSelecting && (
                                            <Checkbox
                                                checked={selectedFiles.includes(file.id)}
                                                disabled={isShortcut}
                                                onCheckedChange={() => toggleFileSelection(file.id)}
                                                onClick={(event) => event.stopPropagation()}
                                                aria-label={`Select ${getDisplayName(file)}`}
                                            />
                                        )}
                                        {(file.type === "image" || file.type === "video") && !isSecureItem(file) && !isShortcut ? (
                                            <div className="h-9 w-9 rounded overflow-hidden bg-secondary shrink-0 flex items-center justify-center">
                                                {!accessible || brokenThumbnails[file.id] ? (
                                                    <Icon className={cn("h-5 w-5", getFileColor(file.type))} />
                                                ) : (
                                                    <img
                                                        src={getThumbnailUrl(file.id, 96)}
                                                        alt={getDisplayName(file)}
                                                        className="h-full w-full object-cover"
                                                        loading="lazy"
                                                        onError={(e) => {
                                                            const target = e.currentTarget
                                                            if (file.type === "image" && !target.dataset.fallback) {
                                                                target.dataset.fallback = "1"
                                                                target.src = getPreviewUrl(file.id)
                                                                return
                                                            }
                                                            setBrokenThumbnails(prev => ({ ...prev, [file.id]: true }))
                                                        }}
                                                    />
                                                )}
                                            </div>
                                        ) : (
                                            <Icon className={cn("h-5 w-5 flex-shrink-0", getFileColor(file.type))} />
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className="text-sm font-medium text-card-foreground truncate">
                                                    {getDisplayName(file)}
                                                </span>
                                                {canShowVersions(file) && getVersionNumber(file) > 1 && (
                                                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                                                        v{getVersionNumber(file)}
                                                    </Badge>
                                                )}
                                                {isShortcut && (
                                                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                                        Shortcut
                                                    </Badge>
                                                )}
                                                {Number(file.shared_count || 0) > 0 && !isShortcut && (
                                                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                                        Shared
                                                    </Badge>
                                                )}
                                            </div>
                                            <span className="text-xs text-muted-foreground sm:hidden">
                                                {formatFileSize(file.size)}
                                            </span>
                                        </div>
                                        {file.starred === 1 && !isShortcut && (
                                            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400 flex-shrink-0" />
                                        )}
                                        {isShortcut && (
                                            <FolderPlus className="h-4 w-4 text-primary flex-shrink-0" />
                                        )}
                                        {isSecureItem(file) && (
                                            <Lock className="h-4 w-4 text-sky-400 flex-shrink-0" />
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
                                                {isShortcut ? (
                                                    <>
                                                        <DropdownMenuItem onClick={() => handleFileClick(file)}>
                                                            {file.type === "folder" ? (
                                                                <FolderOpen className="h-4 w-4 mr-2" />
                                                            ) : (
                                                                <Eye className="h-4 w-4 mr-2" />
                                                            )}
                                                            {file.type === "folder" ? "Open shared folder" : "Preview"}
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            onClick={() => handleDownload(file)}
                                                            disabled={file.share_allow_download === 0}
                                                        >
                                                            <Download className="h-4 w-4 mr-2" />
                                                            {file.type === "folder" ? "Download ZIP" : "Download"}
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => setDetailFile(file)}>
                                                            <Info className="h-4 w-4 mr-2" />
                                                            Details
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem
                                                            className="text-destructive"
                                                            onClick={() => handleRemoveShortcut(file)}
                                                        >
                                                            <Trash2 className="h-4 w-4 mr-2" />
                                                            Remove shortcut
                                                        </DropdownMenuItem>
                                                    </>
                                                ) : file.type === "folder" ? (
                                                    <>
                                                        <DropdownMenuItem
                                                            onClick={() => accessible && handleFileClick(file)}
                                                            disabled={!accessible}
                                                            title={!accessible ? "Drive disconnected" : undefined}
                                                        >
                                                            <FolderOpen className="h-4 w-4 mr-2" />
                                                            Open
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            onClick={() => accessible && handleDownload(file)}
                                                            disabled={!accessible}
                                                            title={!accessible ? "Drive disconnected" : undefined}
                                                        >
                                                            <Download className="h-4 w-4 mr-2" />
                                                            Download as ZIP
                                                        </DropdownMenuItem>
                                                    </>
                                                ) : (
                                                    <>
                                                        <DropdownMenuItem
                                                            onClick={() => accessible && openPreview(file)}
                                                            disabled={!accessible || !previewAllowed}
                                                            title={!accessible ? "Drive disconnected" : undefined}
                                                        >
                                                            <Eye className="h-4 w-4 mr-2" />
                                                            {previewAllowed ? "Preview" : "Preview unavailable"}
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            onClick={() => accessible && handleDownload(file)}
                                                            disabled={!accessible}
                                                            title={!accessible ? "Drive disconnected" : undefined}
                                                        >
                                                            <Download className="h-4 w-4 mr-2" />
                                                            Download
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            onClick={() => accessible && openVersionHistory(file)}
                                                            disabled={!accessible || !canShowVersions(file)}
                                                            title={!accessible ? "Drive disconnected" : undefined}
                                                        >
                                                            <History className="h-4 w-4 mr-2" />
                                                            Version history
                                                        </DropdownMenuItem>
                                                    </>
                                                )}
                                                {!isShortcut && (
                                                    <>
                                                        <DropdownMenuItem onClick={() => accessible && openRenameDialog(file)} disabled={!accessible} title={!accessible ? "Drive disconnected" : undefined}>
                                                            <Pencil className="h-4 w-4 mr-2" />
                                                            Rename
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => accessible && openLocationDialog(file, "move")} disabled={!accessible} title={!accessible ? "Drive disconnected" : undefined}>
                                                            <Scissors className="h-4 w-4 mr-2" />
                                                            Move
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => accessible && openLocationDialog(file, "copy")} disabled={!accessible} title={!accessible ? "Drive disconnected" : undefined}>
                                                            <Copy className="h-4 w-4 mr-2" />
                                                            Copy
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => accessible && handleDuplicate(file)} disabled={!accessible} title={!accessible ? "Drive disconnected" : undefined}>
                                                            <Copy className="h-4 w-4 mr-2" />
                                                            Duplicate
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => accessible && handleToggleStar(file)} disabled={!accessible} title={!accessible ? "Drive disconnected" : undefined}>
                                                            <Star className="h-4 w-4 mr-2" />
                                                            {file.starred ? "Unstar" : "Star"}
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => accessible && handleShare(file)} disabled={!accessible} title={!accessible ? "Drive disconnected" : undefined}>
                                                            <Link2 className="h-4 w-4 mr-2" />
                                                            Share
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => setDetailFile(file)}>
                                                            <Info className="h-4 w-4 mr-2" />
                                                            Details
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem
                                                            className="text-destructive"
                                                            onClick={() => accessible && openDeleteDialog(file)}
                                                            disabled={!accessible}
                                                            title={!accessible ? "Drive disconnected" : undefined}
                                                        >
                                                            <Trash2 className="h-4 w-4 mr-2" />
                                                            Delete
                                                        </DropdownMenuItem>
                                                    </>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                        </div>
                                    </ContextMenuTrigger>
                                    <ContextMenuContent className="w-56">
                                        {renderFileContextMenuItems(file)}
                                    </ContextMenuContent>
                                </ContextMenu>
                            )
                        })}
                    </CardContent>
                </Card>
            )}

            <Dialog open={showSecureVaultDialog} onOpenChange={setShowSecureVaultDialog}>
                <DialogContent className="max-h-[90vh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Create Secure Vault</DialogTitle>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <div>
                            <Label htmlFor="secureVaultName">Vault name</Label>
                            <Input
                                id="secureVaultName"
                                value={newSecureVaultName}
                                onChange={(e) => setNewSecureVaultName(e.target.value)}
                                placeholder="Private files"
                                className="mt-2"
                            />
                        </div>
                        <div>
                            <Label htmlFor="secureVaultPin">Vault PIN</Label>
                            <Input
                                id="secureVaultPin"
                                type="password"
                                value={secureVaultPin}
                                onChange={(e) => setSecureVaultPin(e.target.value)}
                                placeholder="At least 4 characters"
                                className="mt-2"
                            />
                        </div>
                        <div>
                            <Label htmlFor="secureVaultPinConfirm">Confirm PIN</Label>
                            <Input
                                id="secureVaultPinConfirm"
                                type="password"
                                value={secureVaultPinConfirm}
                                onChange={(e) => setSecureVaultPinConfirm(e.target.value)}
                                className="mt-2"
                                onKeyDown={(e) => e.key === "Enter" && handleCreateSecureVault()}
                            />
                        </div>
                        <p className="text-xs text-muted-foreground">
                            This PIN is never stored on the server. If you lose it, the encrypted data cannot be recovered.
                        </p>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowSecureVaultDialog(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleCreateSecureVault} disabled={vaultBusy || !newSecureVaultName.trim()}>
                            {vaultBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Lock className="h-4 w-4 mr-2" />}
                            Create Vault
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showUnlockVaultDialog} onOpenChange={setShowUnlockVaultDialog}>
                <DialogContent className="max-h-[90vh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Unlock Secure Vault</DialogTitle>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Enter the PIN for "{currentVault ? getDisplayName(currentVault) : "this vault"}" to decrypt filenames and access file contents.
                        </p>
                        <div>
                            <Label htmlFor="unlockVaultPin">Vault PIN</Label>
                            <Input
                                id="unlockVaultPin"
                                type="password"
                                value={unlockPin}
                                onChange={(e) => setUnlockPin(e.target.value)}
                                className="mt-2"
                                onKeyDown={(e) => e.key === "Enter" && handleUnlockVault()}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowUnlockVaultDialog(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleUnlockVault} disabled={vaultBusy || !unlockPin.trim()}>
                            {vaultBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <KeyRound className="h-4 w-4 mr-2" />}
                            Unlock
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showChangePinDialog} onOpenChange={setShowChangePinDialog}>
                <DialogContent className="max-h-[90vh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Change Vault PIN</DialogTitle>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        {!isActiveVaultUnlocked && (
                            <div>
                                <Label htmlFor="changePinCurrent">Current PIN</Label>
                                <Input
                                    id="changePinCurrent"
                                    type="password"
                                    value={changePinCurrent}
                                    onChange={(e) => setChangePinCurrent(e.target.value)}
                                    className="mt-2"
                                />
                            </div>
                        )}
                        <div>
                            <Label htmlFor="changePinNext">New PIN</Label>
                            <Input
                                id="changePinNext"
                                type="password"
                                value={changePinNext}
                                onChange={(e) => setChangePinNext(e.target.value)}
                                className="mt-2"
                            />
                        </div>
                        <div>
                            <Label htmlFor="changePinConfirm">Confirm new PIN</Label>
                            <Input
                                id="changePinConfirm"
                                type="password"
                                value={changePinConfirm}
                                onChange={(e) => setChangePinConfirm(e.target.value)}
                                className="mt-2"
                                onKeyDown={(e) => e.key === "Enter" && handleChangeVaultPin()}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowChangePinDialog(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleChangeVaultPin} disabled={vaultBusy || !changePinNext.trim()}>
                            {vaultBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                            Update PIN
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* New Folder Dialog */}
            <Dialog open={showNewFolderDialog} onOpenChange={setShowNewFolderDialog}>
                <DialogContent className="max-h-[90vh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{isInsideVault ? "Create Encrypted Folder" : "Create New Folder"}</DialogTitle>
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

            {/* Move/Copy Destination Dialog */}
            <Dialog
                open={showLocationDialog}
                onOpenChange={(open) => {
                    setShowLocationDialog(open)
                    if (!open) {
                        setLocationTarget(null)
                        setLocationTargets([])
                        setDestinationFolders([])
                        setDestinationBreadcrumbs([])
                        setDestinationFolderId(null)
                    }
                }}
            >
                <DialogContent className="max-h-[90vh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            {locationMode === "move" ? <Scissors className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                            {locationMode === "move" ? "Move to..." : "Copy to..."}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="text-sm text-muted-foreground">
                            {locationMode === "move" ? "Moving" : "Copying"}{" "}
                            <span className="font-medium text-foreground">
                                {locationTargets.length > 1
                                    ? `${locationTargets.length} items`
                                    : `"${locationTargets[0] ? getDisplayName(locationTargets[0]) : locationTarget ? getDisplayName(locationTarget) : ""}"`}
                            </span>
                        </div>

                        <div className="rounded-lg border border-border p-3 space-y-3">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 text-sm min-w-0">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        disabled={destinationFolderId === null || destinationLoading}
                                        onClick={() => {
                                            if (destinationBreadcrumbs.length <= 1) {
                                                handleDestinationNavigate(null)
                                                return
                                            }
                                            const parentCrumb = destinationBreadcrumbs[destinationBreadcrumbs.length - 2]
                                            handleDestinationNavigate(parentCrumb.id)
                                        }}
                                    >
                                        <ArrowLeft className="h-4 w-4" />
                                    </Button>
                                    <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className={cn("h-7 px-2", destinationFolderId === null && "text-primary")}
                                            onClick={() => handleDestinationNavigate(null)}
                                        >
                                            <Home className="h-3.5 w-3.5 mr-1" />
                                            Root
                                        </Button>
                                        {destinationBreadcrumbs.map((crumb) => (
                                            <div key={crumb.id} className="flex items-center gap-1">
                                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className={cn("h-7 px-2", destinationFolderId === crumb.id && "text-primary")}
                                                    onClick={() => handleDestinationNavigate(crumb.id)}
                                                >
                                                    {getDisplayName(crumb)}
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="text-xs text-muted-foreground">
                                Destination:{" "}
                                <span className="text-foreground font-medium">
                                    {destinationBreadcrumbs.length > 0
                                        ? getDisplayName(destinationBreadcrumbs[destinationBreadcrumbs.length - 1])
                                        : "Root"}
                                </span>
                            </div>
                        </div>

                        <div className="space-y-2 max-h-64 overflow-y-auto border border-border rounded-lg p-2">
                            {destinationLoading ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                </div>
                            ) : destinationFolders.length === 0 ? (
                                <div className="text-sm text-muted-foreground text-center py-6">
                                    No subfolders here
                                </div>
                            ) : (
                                destinationFolders
                                    .filter((folder) => !locationTargets.some((target) => target.id === folder.id) && folder.id !== locationTarget?.id)
                                    .map((folder) => (
                                            <Button
                                                key={folder.id}
                                                variant="ghost"
                                                className="w-full justify-between h-auto py-2.5 px-3"
                                            onClick={() => handleDestinationNavigate(folder.id)}
                                        >
                                            <span className="flex items-center gap-2 min-w-0">
                                                <Folder className="h-4 w-4 text-blue-400 shrink-0" />
                                                <span className="truncate">{getDisplayName(folder)}</span>
                                            </span>
                                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                        </Button>
                                    ))
                            )}
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowLocationDialog(false)}>
                            Cancel
                        </Button>
                        <Button onClick={applyLocationAction} disabled={isApplyingLocation || destinationLoading}>
                            {isApplyingLocation ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : locationMode === "move" ? (
                                <Scissors className="h-4 w-4 mr-2" />
                            ) : (
                                <Copy className="h-4 w-4 mr-2" />
                            )}
                            {isApplyingLocation
                                ? (locationMode === "move" ? "Moving..." : "Copying...")
                                : (locationMode === "move" ? "Move Here" : "Copy Here")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Rename Dialog */}
            <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
                <DialogContent className="max-h-[90vh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-md">
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
                            "{selectedItem ? getDisplayName(selectedItem) : ""}" will be moved to trash. You can restore it later from the Trash page.
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

            {/* File Preview Modal */}
            {previewFile && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/90 p-2 sm:p-4"
                    onClick={() => closePreview()}
                    onKeyDown={(e) => e.key === 'Escape' && closePreview()}
                >
                    <div className="absolute left-0 right-0 top-0 z-20 flex flex-col gap-3 bg-gradient-to-b from-black/80 to-transparent p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                        <div className="flex min-w-0 items-center gap-3">
                            <FileIcon className="h-5 w-5 text-white/70 shrink-0" />
                            <div className="min-w-0">
                                <p className="text-white text-sm font-medium truncate">{getDisplayName(previewFile)}</p>
                                <p className="text-white/50 text-xs">
                                    {formatFileSize(previewFile.size)}
                                    {isTextPreviewFile(previewFile) && ` · ${getPreviewLanguageLabel(previewFile)}`}
                                </p>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
                            {previewFile.type === "image" && (
                                <div className="flex items-center gap-1 rounded-md bg-secondary/90 p-1">
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); zoomImage(-0.25) }}>
                                        <ZoomOut className="h-4 w-4" />
                                    </Button>
                                    <span className="min-w-12 text-center text-xs font-medium text-secondary-foreground">
                                        {Math.round(imageZoom * 100)}%
                                    </span>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); zoomImage(0.25) }}>
                                        <ZoomIn className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); setImageRotation((value) => value - 90) }}>
                                        <RotateCcw className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); setImageRotation((value) => value + 90) }}>
                                        <RotateCw className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={(e) => { e.stopPropagation(); resetImagePreviewState() }}>
                                        Reset
                                    </Button>
                                </div>
                            )}
                            {isTextPreviewFile(previewFile) && (
                                <div className="flex items-center gap-1 rounded-md bg-secondary/90 p-1">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 px-2 text-xs"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            setPreviewTextWrap((value) => !value)
                                        }}
                                    >
                                        {previewTextWrap ? "No wrap" : "Wrap"}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 gap-1 px-2 text-xs"
                                        disabled={!previewTextContent}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            copyPreviewText()
                                        }}
                                    >
                                        {previewTextCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                                        {previewTextCopied ? "Copied" : "Copy"}
                                    </Button>
                                </div>
                            )}
                            <Button
                                variant="secondary"
                                size="sm"
                                className="gap-2"
                                disabled={isShareShortcut(previewFile) && previewFile.share_allow_download === 0}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    handleDownload(previewFile)
                                }}
                            >
                                <Download className="h-4 w-4" />
                                <span className="hidden sm:inline">Download</span>
                            </Button>
                            <Button
                                variant="secondary"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => closePreview()}
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    <Button
                        variant="secondary"
                        size="icon"
                        className="absolute left-2 top-1/2 z-20 h-10 w-10 -translate-y-1/2 rounded-full sm:left-4"
                        disabled={!previewPreviousFile}
                        onClick={(e) => {
                            e.stopPropagation()
                            navigatePreviewSibling(-1)
                        }}
                    >
                        <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <Button
                        variant="secondary"
                        size="icon"
                        className="absolute right-2 top-1/2 z-20 h-10 w-10 -translate-y-1/2 rounded-full sm:right-4"
                        disabled={!previewNextFile}
                        onClick={(e) => {
                            e.stopPropagation()
                            navigatePreviewSibling(1)
                        }}
                    >
                        <ChevronRight className="h-5 w-5" />
                    </Button>

                    <div className="flex max-h-[calc(100vh-7.5rem)] max-w-full items-center justify-center pt-24 sm:max-h-[calc(100vh-6rem)] sm:pt-14" onClick={(e) => e.stopPropagation()}>
                        {previewFile.type === 'image' && (
                            <div
                                className={cn(
                                    "flex h-[calc(100vh-8rem)] w-[94vw] touch-none items-center justify-center overflow-hidden rounded-lg sm:h-[calc(100vh-7rem)] sm:w-[90vw]",
                                    imageZoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
                                )}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    if (imageZoom === 1) updateImageZoom(1.75)
                                }}
                                onPointerDown={handleImagePointerDown}
                                onPointerMove={handleImagePointerMove}
                                onPointerUp={handleImagePointerUp}
                                onPointerCancel={handleImagePointerUp}
                                onWheel={handleImageWheel}
                            >
                                <img
                                    src={getPreviewUrlForFile(previewFile)}
                                    alt={getDisplayName(previewFile)}
                                    className="max-h-full max-w-full select-none rounded-lg object-contain shadow-2xl"
                                    draggable={false}
                                    style={{
                                        transform: `translate(${imagePan.x}px, ${imagePan.y}px) scale(${imageZoom}) rotate(${imageRotation}deg)`,
                                        transition: isImagePanning ? "none" : "transform 120ms ease-out",
                                    }}
                                />
                            </div>
                        )}
                        {previewFile.type === 'video' && (
                            <div className="flex w-[94vw] max-w-6xl flex-col overflow-hidden rounded-xl bg-card shadow-2xl sm:w-[88vw]">
                                <video
                                    src={getPreviewUrlForFile(previewFile)}
                                    controls
                                    preload="metadata"
                                    className="max-h-[72vh] w-full bg-black"
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
                        {previewFile.type === 'audio' && (
                            <div className="w-[90vw] max-w-[420px] bg-card rounded-2xl p-6 sm:p-8 flex flex-col items-center gap-6 shadow-2xl">
                                <div className="flex h-28 w-28 items-center justify-center rounded-2xl bg-primary/10 shadow-inner">
                                    <Music className="h-12 w-12 text-primary" />
                                </div>
                                <div className="text-center">
                                    <p className="text-card-foreground font-medium break-words">{getDisplayName(previewFile)}</p>
                                    <p className="mt-1 text-xs text-muted-foreground">Press play when you are ready · Volume 50%</p>
                                </div>
                                <audio
                                    src={getPreviewUrlForFile(previewFile)}
                                    controls
                                    preload="metadata"
                                    className="w-full"
                                    ref={(element) => {
                                        if (element) element.volume = 0.5
                                    }}
                                />
                            </div>
                        )}
                        {isPdfPreviewFile(previewFile) && (
                            <div className="flex flex-col items-center gap-3">
                                {pdfBlobUrl === null && (
                                    <div className="bg-card rounded-2xl p-8 flex flex-col items-center gap-4 w-[min(92vw,28rem)]">
                                        <Loader2 className="h-10 w-10 animate-spin text-primary" />
                                        <p className="text-card-foreground font-medium">Loading PDF...</p>
                                    </div>
                                )}
                                {pdfBlobUrl && pdfBlobUrl !== 'error' && (
                                    <object
                                        data={`${pdfBlobUrl}#toolbar=1&navpanes=0&view=FitH`}
                                        type="application/pdf"
                                        className="h-[72vh] w-[94vw] rounded-lg bg-card shadow-2xl sm:h-[80vh] sm:w-[90vw]"
                                    >
                                        <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-lg bg-card p-6 text-center">
                                            <FileIcon className="h-14 w-14 text-red-400" />
                                            <p className="font-medium text-card-foreground">PDF preview unavailable</p>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                className="gap-2"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    window.open(getPreviewUrlForFile(previewFile), '_blank')
                                                }}
                                            >
                                                <Maximize2 className="h-4 w-4" />
                                                Open PDF
                                            </Button>
                                        </div>
                                    </object>
                                )}
                                {pdfBlobUrl === 'error' && (
                                    <div className="bg-card rounded-2xl p-8 flex flex-col items-center gap-4 w-[min(92vw,28rem)]">
                                        <FileIcon className="h-16 w-16 text-red-400" />
                                        <p className="text-card-foreground font-medium text-center">{getDisplayName(previewFile)}</p>
                                        <p className="text-muted-foreground text-sm text-center">
                                            {previewPdfError || "Could not load PDF preview"}
                                        </p>
                                    </div>
                                )}
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="gap-2"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        window.open(getPreviewUrlForFile(previewFile), '_blank')
                                    }}
                                >
                                    <Maximize2 className="h-4 w-4" />
                                    Open in New Tab
                                </Button>
                            </div>
                        )}
                        {isTextPreviewFile(previewFile) && (
                            <div className="flex max-h-[78vh] w-[94vw] max-w-5xl flex-col overflow-hidden rounded-xl bg-card shadow-2xl sm:max-h-[80vh] sm:w-[90vw]">
                                <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-xs text-muted-foreground">
                                    <span>{previewTextLines.length || 1} line{previewTextLines.length === 1 ? "" : "s"}</span>
                                    <span>{previewTextWrap ? "Wrapped" : "No wrap"}</span>
                                </div>
                                <div className="overflow-auto">
                                    {previewTextContent === null ? (
                                        <div className="flex items-center justify-center gap-3 p-8 text-sm text-muted-foreground">
                                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                            Loading text...
                                        </div>
                                    ) : (
                                        <div className="min-w-full py-3 font-mono text-sm leading-6">
                                            {previewTextLines.map((line, index) => (
                                                <div
                                                    key={index}
                                                    className="grid min-w-full grid-cols-[3.5rem_minmax(0,1fr)] gap-3 px-4 hover:bg-secondary/50"
                                                >
                                                    <span className="select-none text-right text-xs text-muted-foreground/70">
                                                        {index + 1}
                                                    </span>
                                                    <code className={cn(
                                                        "text-card-foreground",
                                                        previewTextWrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
                                                    )}>
                                                        {renderHighlightedLine(line, previewFile, index)}
                                                    </code>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        {isUnsupportedPreviewFile(previewFile) && (
                            <div className="w-[min(92vw,28rem)] bg-card rounded-2xl p-8 flex flex-col items-center gap-4 text-center shadow-2xl">
                                {previewFile.type === "archive" ? (
                                    <Archive className="h-16 w-16 text-amber-400" />
                                ) : (
                                    <FileIcon className="h-16 w-16 text-muted-foreground" />
                                )}
                                <p className="text-card-foreground font-medium">{getDisplayName(previewFile)}</p>
                                <p className="text-muted-foreground text-sm">
                                    Preview unavailable for this file type
                                </p>
                                <div className="flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
                                    <Badge variant="outline">{previewFile.type}</Badge>
                                    <Badge variant="outline">{formatFileSize(previewFile.size)}</Badge>
                                </div>
                                <Button
                                    disabled={isShareShortcut(previewFile) && previewFile.share_allow_download === 0}
                                    onClick={(e) => { e.stopPropagation(); handleDownload(previewFile) }}
                                    className="gap-2"
                                >
                                    <Download className="h-4 w-4" />
                                    Download Instead
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            )}
            {/* Share Dialog */}
            <Dialog open={showShareDialog} onOpenChange={(open) => {
                setShowShareDialog(open)
                if (!open) {
                    setShareStatus(null)
                    setSelectedShareUsers([])
                    setShareUserQuery("")
                    setShareExpiry("")
                    setShareFile(null)
                    setShareFiles([])
                }
            }}>
                <DialogContent className="max-h-[90vh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Users className="h-5 w-5" />
                            {shareFiles.length > 1
                                ? `Share ${shareFiles.length} items`
                                : `Share "${shareFile ? getDisplayName(shareFile) : ""}"`}
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

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="sharePeople">People</Label>
                            <Input
                                id="sharePeople"
                                value={shareUserQuery}
                                onChange={(e) => setShareUserQuery(e.target.value)}
                                placeholder="Search username or email"
                            />
                            <div className="space-y-1 max-h-44 overflow-y-auto rounded-md border border-border p-1">
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
                                ) : filteredShareUsers.length === 0 ? (
                                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                                        No matching users
                                    </div>
                                ) : (
                                    filteredShareUsers.map((user) => (
                                        <div
                                            key={user.id}
                                            className={cn(
                                                "flex items-center gap-3 p-2.5 rounded-md cursor-pointer transition-colors",
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
                                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-xs shrink-0">
                                                {user.username.charAt(0).toUpperCase()}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium truncate">{user.username}</p>
                                                {user.email && (
                                                    <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Permission</Label>
                                <Select value={sharePermission} onValueChange={(value) => setSharePermission(value as SharePermission)}>
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="view">View only</SelectItem>
                                        <SelectItem value="comment">Can comment</SelectItem>
                                        <SelectItem value="edit">Can edit/download</SelectItem>
                                        {shareFiles.length === 1 && shareFile?.type === "folder" && <SelectItem value="upload">Upload only</SelectItem>}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="shareExpiry">Expiry</Label>
                                <Input
                                    id="shareExpiry"
                                    type="datetime-local"
                                    value={shareExpiry}
                                    onChange={(e) => setShareExpiry(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-between rounded-md border border-border p-3">
                            <div>
                                <Label htmlFor="shareDownload" className="text-sm">Allow downloads</Label>
                                <p className="text-xs text-muted-foreground">Recipients can save a copy.</p>
                            </div>
                            <Switch
                                id="shareDownload"
                                checked={allowShareDownload}
                                onCheckedChange={setAllowShareDownload}
                            />
                        </div>

                        <div className="rounded-md border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
                            Sharing is limited to CloudPi users on your private network.
                        </div>
                    </div>

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
                                    ? "Choose people to share"
                                    : "Save Share"
                            }
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showKeyboardHelp} onOpenChange={setShowKeyboardHelp}>
                <DialogContent className="max-h-[90vh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Keyboard className="h-5 w-5" />
                            Keyboard Shortcuts
                        </DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-2 py-2 text-sm">
                        {[
                            ["Enter", "Open selected item"],
                            ["Backspace", "Go up one folder"],
                            ["Alt + Left", "Go up one folder"],
                            ["F2", "Rename selected item"],
                            ["Delete", "Move selected item to trash"],
                            ["Ctrl/Cmd + A", "Select all visible items"],
                            ["Ctrl/Cmd + U", "Upload files"],
                            ["Esc", "Close preview or clear selection"],
                            ["Left / Right", "Previous or next file while previewing"],
                            ["?", "Show this reference"],
                        ].map(([shortcut, action]) => (
                            <div key={shortcut} className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2">
                                <kbd className="shrink-0 rounded border border-border bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
                                    {shortcut}
                                </kbd>
                                <span className="text-right text-muted-foreground">{action}</span>
                            </div>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Version History */}
            <Sheet
                open={Boolean(versionFile)}
                onOpenChange={(open) => {
                    if (!open) closeVersionHistory()
                }}
            >
                <SheetContent className="w-full gap-0 p-0 sm:max-w-lg">
                    <SheetHeader className="border-b border-border pr-12">
                        <SheetTitle className="flex items-center gap-2">
                            <History className="h-5 w-5" />
                            Version History
                        </SheetTitle>
                        <SheetDescription className="truncate">
                            {versionFile ? getDisplayName(versionFile) : ""}
                        </SheetDescription>
                    </SheetHeader>

                    <div className="flex-1 overflow-y-auto p-4">
                        {versionFile && (
                            <div className="space-y-4">
                                <div className="rounded-lg border border-border bg-card p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-card-foreground">Current version</p>
                                            <p className="text-xs text-muted-foreground">
                                                v{versionHistory?.currentVersion ?? getVersionNumber(versionFile)} · {formatFileSize(versionFile.size)}
                                            </p>
                                        </div>
                                        <Badge className="shrink-0">Live</Badge>
                                    </div>
                                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                                        <div>
                                            <p className="text-muted-foreground">Modified</p>
                                            <p className="text-card-foreground">{formatApiDateTime(versionFile.modified_at)}</p>
                                        </div>
                                        <div>
                                            <p className="text-muted-foreground">History storage</p>
                                            <p className="text-card-foreground">{formatFileSize(versionHistory?.versionStorageBytes ?? 0)}</p>
                                        </div>
                                    </div>
                                </div>

                                {versionLoading && (
                                    <div className="flex items-center justify-center py-12">
                                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                                    </div>
                                )}

                                {versionError && !versionLoading && (
                                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                                        <div className="flex items-start gap-3">
                                            <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-destructive">{versionError}</p>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="mt-3 gap-2"
                                                    onClick={() => loadVersionHistory(versionFile.id)}
                                                >
                                                    <RefreshCw className="h-3.5 w-3.5" />
                                                    Retry
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {!versionLoading && !versionError && versionHistory?.versions.length === 0 && (
                                    <div className="rounded-lg border border-dashed border-border p-8 text-center">
                                        <History className="mx-auto h-10 w-10 text-muted-foreground" />
                                        <p className="mt-3 text-sm font-medium text-card-foreground">No archived versions</p>
                                    </div>
                                )}

                                {!versionLoading && !versionError && versionHistory && versionHistory.versions.length > 0 && (
                                    <div className="space-y-3">
                                        {versionHistory.versions.map((version) => (
                                            <div key={version.id} className="rounded-lg border border-border bg-card p-4">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-semibold text-card-foreground">Version {version.version_number}</p>
                                                        <p className="text-xs text-muted-foreground">{formatApiDateTime(version.archived_at)}</p>
                                                    </div>
                                                    <Badge variant="outline" className="shrink-0">
                                                        {formatFileSize(version.size)}
                                                    </Badge>
                                                </div>
                                                <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                                                    <div>
                                                        <p className="text-muted-foreground">Type</p>
                                                        <p className="text-card-foreground capitalize">{version.type}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-muted-foreground">MIME</p>
                                                        <p className="truncate text-card-foreground">{version.mime_type || "—"}</p>
                                                    </div>
                                                </div>
                                                {version.integrity_failed ? (
                                                    <div className="mt-3 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                                                        <ShieldAlert className="h-3.5 w-3.5" />
                                                        Integrity check failed
                                                    </div>
                                                ) : null}
                                                <div className="mt-4 flex justify-end gap-2">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="gap-2"
                                                        onClick={() => setVersionAction({ type: "restore", version })}
                                                    >
                                                        <RotateCcw className="h-3.5 w-3.5" />
                                                        Restore
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="gap-2 text-destructive"
                                                        onClick={() => setVersionAction({ type: "delete", version })}
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                        Delete
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </SheetContent>
            </Sheet>

            <AlertDialog open={Boolean(versionAction)} onOpenChange={(open) => {
                if (!open && !versionActionBusy) setVersionAction(null)
            }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {versionAction?.type === "restore"
                                ? `Restore version ${versionAction.version.version_number}?`
                                : `Delete version ${versionAction?.version.version_number}?`}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {versionAction?.type === "restore"
                                ? "The current live file will be archived first, then this version becomes current."
                                : "This removes the archived file data from storage and cannot be undone."}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={versionActionBusy}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(event) => {
                                event.preventDefault()
                                handleVersionAction()
                            }}
                            disabled={versionActionBusy}
                            className={cn(
                                versionAction?.type === "delete" && "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            )}
                        >
                            {versionActionBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {versionAction?.type === "restore" ? "Restore" : "Delete"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* File Details Sidebar */}
            {detailFile && (
                <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setDetailFile(null)}>
                    <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" />
                    <div
                        className="relative w-full max-w-sm bg-card border-l border-border h-full overflow-y-auto animate-in slide-in-from-right duration-300"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="sticky top-0 bg-card/95 backdrop-blur-sm border-b border-border p-4 flex items-center justify-between z-10">
                            <h3 className="font-semibold text-card-foreground">File Details</h3>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDetailFile(null)}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>

                        <div className="p-5 space-y-6">
                            {/* File icon + name */}
                            <div className="flex flex-col items-center text-center gap-3">
                                {detailFile.type === "image" && !isSecureItem(detailFile) ? (
                                    <div className="w-32 h-32 rounded-lg overflow-hidden bg-secondary">
                                        <img
                                            src={isShareShortcut(detailFile) ? getShareShortcutPreviewUrl(detailFile) : getPreviewUrl(detailFile.id)}
                                            alt={getDisplayName(detailFile)}
                                            className="w-full h-full object-cover"
                                            onError={(e) => {
                                                const target = e.target as HTMLImageElement
                                                target.style.display = 'none'
                                            }}
                                        />
                                    </div>
                                ) : (
                                    <div className="w-20 h-20 rounded-xl bg-secondary flex items-center justify-center">
                                        {(() => {
                                            const DetailIcon = getFileIcon(detailFile.type)
                                            return <DetailIcon className={cn("h-10 w-10", getFileColor(detailFile.type))} />
                                        })()}
                                    </div>
                                )}
                                <p className="text-sm font-semibold text-card-foreground break-all">{getDisplayName(detailFile)}</p>
                                {isShareShortcut(detailFile) && (
                                    <Badge variant="outline" className="gap-1">
                                        <FolderPlus className="h-3 w-3" />
                                        Shared shortcut
                                    </Badge>
                                )}
                            </div>

                            {/* Metadata grid */}
                            <div className="space-y-3">
                                {isShareShortcut(detailFile) && (
                                    <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary">
                                        <Users className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                        <div>
                                            <p className="text-xs text-muted-foreground">Shared by</p>
                                            <p className="text-sm text-card-foreground">{detailFile.shared_by_name || "Another user"}</p>
                                            <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                                                {detailFile.share_permission || "view"} access
                                                {detailFile.share_allow_download === 0 ? " · downloads disabled" : ""}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary">
                                    <FileIcon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                    <div>
                                        <p className="text-xs text-muted-foreground">Type</p>
                                        <p className="text-sm text-card-foreground capitalize">{detailFile.type}</p>
                                        {detailFile.mime_type && (
                                            <p className="text-xs text-muted-foreground mt-0.5 font-mono">{detailFile.mime_type}</p>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary">
                                    <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                    <div>
                                        <p className="text-xs text-muted-foreground">Size</p>
                                        <p className="text-sm text-card-foreground">{formatFileSize(detailFile.size)}</p>
                                        {detailFile.size > 0 && (
                                            <p className="text-xs text-muted-foreground mt-0.5">{detailFile.size.toLocaleString()} bytes</p>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary">
                                    <HardDrive className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                    <div className="min-w-0">
                                        <p className="text-xs text-muted-foreground">Stored on</p>
                                        <p className="text-sm text-card-foreground break-words">{getStorageSourceLabel(detailFile)}</p>
                                        <p className="text-xs text-muted-foreground mt-0.5 capitalize">{getStorageSourceDescription(detailFile)}</p>
                                        {detailFile.storage_source_id && detailFile.storage_source_id !== "internal" && (
                                            <p className="text-xs text-muted-foreground/80 mt-0.5 break-all font-mono">{detailFile.storage_source_id}</p>
                                        )}
                                    </div>
                                </div>

                                {canShowVersions(detailFile) && (
                                    <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary">
                                        <History className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                        <div>
                                            <p className="text-xs text-muted-foreground">Version</p>
                                            <p className="text-sm text-card-foreground">v{getVersionNumber(detailFile)}</p>
                                        </div>
                                    </div>
                                )}

                                <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary">
                                    <Calendar className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                    <div>
                                        <p className="text-xs text-muted-foreground">Created</p>
                                        <p className="text-sm text-card-foreground">
                                            {formatApiDateTime(detailFile.created_at)}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary">
                                    <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                    <div>
                                        <p className="text-xs text-muted-foreground">Modified</p>
                                        <p className="text-sm text-card-foreground">
                                            {formatApiDateTime(detailFile.modified_at)}
                                        </p>
                                    </div>
                                </div>

                                {detailFile.starred === 1 && (
                                    <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-500/10">
                                        <Star className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0 fill-yellow-400" />
                                        <div>
                                            <p className="text-sm text-card-foreground">Starred</p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Quick Actions */}
                            <div className="space-y-2 pt-2 border-t border-border">
                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</p>
                                <div className="flex flex-wrap gap-2">
                                    {isShareShortcut(detailFile) ? (
                                        <>
                                            <Button variant="outline" size="sm" className="gap-2" onClick={() => { setDetailFile(null); handleFileClick(detailFile); }}>
                                                {detailFile.type === "folder" ? (
                                                    <FolderOpen className="h-3.5 w-3.5" />
                                                ) : (
                                                    <Eye className="h-3.5 w-3.5" />
                                                )}
                                                {detailFile.type === "folder" ? "Open" : "Preview"}
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="gap-2"
                                                disabled={detailFile.share_allow_download === 0}
                                                onClick={() => { handleDownload(detailFile); }}
                                            >
                                                <Download className="h-3.5 w-3.5" />
                                                {detailFile.type === "folder" ? "Download ZIP" : "Download"}
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="gap-2 text-destructive"
                                                onClick={() => { handleRemoveShortcut(detailFile); }}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                                Remove shortcut
                                            </Button>
                                        </>
                                    ) : (
                                        <>
                                            {detailFile.type !== "folder" && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="gap-2"
                                                    disabled={!detailFileAccessible}
                                                    title={detailUnavailableTitle}
                                                    onClick={() => { handleDownload(detailFile); }}
                                                >
                                                    <Download className="h-3.5 w-3.5" />
                                                    Download
                                                </Button>
                                            )}
                                            <Button variant="outline" size="sm" className="gap-2" disabled={!detailFileAccessible} title={detailUnavailableTitle} onClick={() => { setDetailFile(null); openRenameDialog(detailFile); }}>
                                                <Pencil className="h-3.5 w-3.5" />
                                                Rename
                                            </Button>
                                            <Button variant="outline" size="sm" className="gap-2" disabled={!detailFileAccessible} title={detailUnavailableTitle} onClick={() => { setDetailFile(null); openLocationDialog(detailFile, "move"); }}>
                                                <Scissors className="h-3.5 w-3.5" />
                                                Move
                                            </Button>
                                            <Button variant="outline" size="sm" className="gap-2" disabled={!detailFileAccessible} title={detailUnavailableTitle} onClick={() => { setDetailFile(null); openLocationDialog(detailFile, "copy"); }}>
                                                <Copy className="h-3.5 w-3.5" />
                                                Copy
                                            </Button>
                                            <Button variant="outline" size="sm" className="gap-2" disabled={!detailFileAccessible} title={detailUnavailableTitle} onClick={() => { setDetailFile(null); handleDuplicate(detailFile); }}>
                                                <Copy className="h-3.5 w-3.5" />
                                                Duplicate
                                            </Button>
                                            <Button variant="outline" size="sm" className="gap-2" disabled={!detailFileAccessible} title={detailUnavailableTitle} onClick={() => { setDetailFile(null); handleShare(detailFile); }}>
                                                <Link2 className="h-3.5 w-3.5" />
                                                Share
                                            </Button>
                                            {canShowVersions(detailFile) && (
                                                <Button variant="outline" size="sm" className="gap-2" onClick={() => openVersionHistory(detailFile)}>
                                                    <History className="h-3.5 w-3.5" />
                                                    Versions
                                                </Button>
                                            )}
                                            <Button variant="outline" size="sm" className="gap-2 text-destructive" disabled={!detailFileAccessible} title={detailUnavailableTitle} onClick={() => { setDetailFile(null); openDeleteDialog(detailFile); }}>
                                                <Trash2 className="h-3.5 w-3.5" />
                                                Delete
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
