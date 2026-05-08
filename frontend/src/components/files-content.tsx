"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
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
    SortDesc,
    Upload,
    FolderPlus,
    Download,
    Filter,
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
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
    getFiles,
    createFolder,
    createSecureVault,
    createVaultFolder,
    downloadFile,
    fetchVaultChunk,
    getVaultMetadata,
    changeVaultPin,
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
    createShareLink,
    getShareUsers,
    type FileItem,
    type Breadcrumb,
    type ShareUser,
} from "@/lib/api"
import { useUpload } from "@/contexts/upload-context"
import { useDriveStatus } from "@/contexts/drive-status-context"
import { useVaults } from "@/contexts/vault-context"
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
    const { addUpload } = useUpload()
    const { isFileAccessible, disconnectedDrives, notification } = useDriveStatus()
    const { isVaultUnlocked, getVaultKey, unlockVault, lockVault, touchVault } = useVaults()
    const [view, setView] = useState<"grid" | "list">("grid")
    const [files, setFiles] = useState<FileItem[]>([])
    const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([])
    const [displayNames, setDisplayNames] = useState<Record<number, string>>({})
    const [currentFolderId, setCurrentFolderId] = useState<number | null>(null)
    const [currentFolder, setCurrentFolder] = useState<Breadcrumb | null>(null)
    const [currentVault, setCurrentVault] = useState<Breadcrumb | null>(null)
    const [selectedFiles, setSelectedFiles] = useState<number[]>([])
    const [isSelecting, setIsSelecting] = useState(false)
    const [searchQuery, setSearchQuery] = useState("")
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [storageWarning, setStorageWarning] = useState<string | null>(null)

    // Sorting & filtering
    const [sortKey, setSortKey] = useState<"name" | "modified" | "size" | "type">("name")
    const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc")
    const [filterType, setFilterType] = useState<string | null>(null)

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
    const [destinationFolderId, setDestinationFolderId] = useState<number | null>(null)
    const [destinationFolders, setDestinationFolders] = useState<FileItem[]>([])
    const [destinationBreadcrumbs, setDestinationBreadcrumbs] = useState<Breadcrumb[]>([])
    const [destinationLoading, setDestinationLoading] = useState(false)
    const [isApplyingLocation, setIsApplyingLocation] = useState(false)

    // File preview
    const [previewFile, setPreviewFile] = useState<FileItem | null>(null)
    const [previewTextContent, setPreviewTextContent] = useState<string | null>(null)
    const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)

    // Upload
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
    const [vaultBusy, setVaultBusy] = useState(false)

    // Load files
    useEffect(() => {
        loadFiles()
    }, [currentFolderId])

    const activeVaultId = currentVault?.id ?? null
    const isInsideVault = activeVaultId !== null
    const isActiveVaultUnlocked = isVaultUnlocked(activeVaultId)

    function getDisplayName(item: { id: number; name: string }) {
        return displayNames[item.id] ?? item.name
    }

    async function loadFiles() {
        setIsLoading(true)
        setError(null)
        try {
            const data = await getFiles(currentFolderId) as any
            setFiles(data.files)
            setBreadcrumbs(data.breadcrumbs)
            setCurrentFolder(data.currentFolder || null)
            setCurrentVault(data.currentVault || null)
            // Show warning if user's assigned drive is disconnected
            if (data.storageWarning) {
                setStorageWarning(data.storageWarning)
            } else {
                setStorageWarning(null)
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load files")
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        let cancelled = false

        async function resolveEncryptedNames() {
            const nextNames: Record<number, string> = {}
            const activeKey = getVaultKey(activeVaultId)

            const allItems = [
                ...files,
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
    }, [files, breadcrumbs, currentFolder, currentVault, activeVaultId, getVaultKey])

    const filteredFiles = files
        .filter((file) => getDisplayName(file).toLowerCase().includes(searchQuery.toLowerCase()))
        .filter((file) => {
            if (!filterType) return true
            if (filterType === "starred") return file.starred === 1
            return file.type === filterType
        })
        .sort((a, b) => {
            // Folders always come first
            if (a.type === "folder" && b.type !== "folder") return -1
            if (a.type !== "folder" && b.type === "folder") return 1

            let cmp = 0
            switch (sortKey) {
                case "name":
                    cmp = getDisplayName(a).localeCompare(getDisplayName(b))
                    break
                case "modified":
                    cmp = new Date(a.modified_at).getTime() - new Date(b.modified_at).getTime()
                    break
                case "size":
                    cmp = a.size - b.size
                    break
                case "type":
                    cmp = a.type.localeCompare(b.type)
                    break
            }
            return sortDirection === "asc" ? cmp : -cmp
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

    function clearOverlays() {
        closePreview()
        setDetailFile(null)
    }

    // Navigation
    function navigateToFolder(folderId: number | null) {
        clearOverlays()
        setCurrentFolderId(folderId)
        setSelectedFiles([])
        setIsSelecting(false)
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

    async function uploadFilesToVault(filesToUpload: File[], folderId: number | null, onProgress: (uploadedBytes: number, totalBytes: number) => void) {
        if (!activeVaultId || !folderId) {
            throw new Error("Vault destination is unavailable")
        }

        const dek = getVaultKey(activeVaultId)
        if (!dek) {
            throw new Error("Unlock this vault before uploading files")
        }

        const totalBytes = filesToUpload.reduce((sum, file) => sum + file.size, 0)
        let uploadedBytes = 0

        for (const file of filesToUpload) {
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
                    const start = chunkIndex * CHUNK_SIZE_BYTES
                    const end = Math.min(file.size, start + CHUNK_SIZE_BYTES)
                    const chunkBuffer = await file.slice(start, end).arrayBuffer()
                    const encryptedChunk = await encryptChunk(dek, chunkBuffer, baseIv, chunkIndex)
                    await uploadVaultChunk(init.upload.id, chunkIndex, encryptedChunk)
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
    async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const fileList = e.target.files
        if (!fileList || fileList.length === 0) return

        const filesArray = Array.from(fileList)
        addUpload(
            filesArray,
            currentFolderId,
            () => loadFiles(),
            isInsideVault ? uploadFilesToVault : undefined,
        )

        // Reset input
        if (fileInputRef.current) {
            fileInputRef.current.value = ""
        }
    }

    // Drag and drop handlers
    function handleDragEnter(e: React.DragEvent) {
        e.preventDefault()
        e.stopPropagation()
        if (isInsideVault && !isActiveVaultUnlocked) return
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

        if (isInsideVault && !isActiveVaultUnlocked) {
            setError("Unlock this vault before uploading files")
            return
        }

        const droppedFiles = e.dataTransfer.files
        if (!droppedFiles || droppedFiles.length === 0) return

        const filesArray = Array.from(droppedFiles)
        addUpload(
            filesArray,
            currentFolderId,
            () => loadFiles(),
            isInsideVault ? uploadFilesToVault : undefined,
        )
    }

    // Download (supports both files and folders — folders download as ZIP)
    async function handleDownload(file: FileItem) {
        try {
            if (isSecureItem(file)) {
                if (file.type === "folder") {
                    throw new Error("Vault folders cannot be downloaded as server-side ZIP archives yet")
                }
                await downloadVaultFile(file)
                return
            }
            const displayName = getDisplayName(file)
            const fileName = file.type === 'folder' ? `${displayName}.zip` : displayName
            await downloadFile(file.id, fileName)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Download failed")
        }
    }

    // Share
    async function handleShare(file: FileItem) {
        if (isSecureItem(file)) {
            setError("Encrypted vault items cannot be shared yet")
            return
        }
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
        setRenameValue(getDisplayName(file))
        setShowRenameDialog(true)
    }

    async function handleRename() {
        if (!selectedItem || !renameValue.trim()) return
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
        if (isSecureItem(file)) {
            setError(`${mode === "move" ? "Moving" : "Copying"} encrypted vault items is not supported yet`)
            return
        }
        setLocationTarget(file)
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
        if (!locationTarget || isApplyingLocation) return

        setIsApplyingLocation(true)
        try {
            if (locationMode === "move") {
                await moveFile(locationTarget.id, destinationFolderId)
            } else {
                await copyFile(locationTarget.id, destinationFolderId)
            }
            setShowLocationDialog(false)
            setLocationTarget(null)
            await loadFiles()
        } catch (err) {
            setError(err instanceof Error ? err.message : `${locationMode === "move" ? "Move" : "Copy"} failed`)
        } finally {
            setIsApplyingLocation(false)
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

    // Preview
    function openPreview(file: FileItem) {
        if (isSecureItem(file)) {
            clearOverlays()
            setError("Encrypted vault files cannot be previewed in the browser yet. Download them to decrypt locally.")
            return
        }
        setPreviewFile(file)
        setPreviewTextContent(null)
        setPdfBlobUrl(null)
        // For PDFs, fetch as blob to bypass IDM interception
        // raw=1 tells backend to serve as octet-stream so IDM ignores it
        if (file.mime_type?.includes('pdf')) {
            fetch(getPreviewUrl(file.id) + '&raw=1')
                .then(r => {
                    if (!r.ok) throw new Error('Failed to load PDF')
                    return r.blob()
                })
                .then(blob => {
                    // Re-create blob with correct PDF type so browser's PDF viewer renders it
                    const pdfBlob = new Blob([blob], { type: 'application/pdf' })
                    const url = URL.createObjectURL(pdfBlob)
                    setPdfBlobUrl(url)
                })
                .catch(() => setPdfBlobUrl('error'))
        }
        // For non-PDF documents (text, code, etc.), fetch as text
        if (file.type === 'document' && !file.mime_type?.includes('pdf')) {
            fetch(getPreviewUrl(file.id))
                .then(r => r.text())
                .then(text => setPreviewTextContent(text))
                .catch(() => setPreviewTextContent('Failed to load file content'))
        }
    }

    function closePreview() {
        if (pdfBlobUrl && pdfBlobUrl !== 'error') URL.revokeObjectURL(pdfBlobUrl)
        setPreviewFile(null)
        setPreviewTextContent(null)
        setPdfBlobUrl(null)
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
                            {getDisplayName(crumb)}
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
                    {!isInsideVault && (
                        <Button
                            variant="outline"
                            className="gap-2"
                            onClick={() => setShowSecureVaultDialog(true)}
                        >
                            <Lock className="h-4 w-4" />
                            Secure Vault
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
                    <Button
                        className="gap-2"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isInsideVault && !isActiveVaultUnlocked}
                    >
                        <Upload className="h-4 w-4" />
                        Upload
                    </Button>
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
                        variant={isSelecting ? "default" : "outline"}
                        size="icon"
                        onClick={() => {
                            setIsSelecting(!isSelecting)
                            if (isSelecting) setSelectedFiles([])
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
                        >
                            <List className="h-4 w-4" />
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
                    { key: null, label: "All" },
                    { key: "image", label: "🖼️ Images" },
                    { key: "document", label: "📄 Docs" },
                    { key: "video", label: "🎬 Videos" },
                    { key: "audio", label: "🎵 Audio" },
                    { key: "archive", label: "📦 Archives" },
                    { key: "starred", label: "⭐ Starred" },
                ].map((f) => (
                    <Button
                        key={f.key ?? "all"}
                        variant={filterType === f.key ? "default" : "outline"}
                        size="sm"
                        className="h-7 text-xs shrink-0 rounded-full"
                        onClick={() => setFilterType(f.key)}
                    >
                        {f.label}
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
                            ? `Drive "${notification.label}" disconnected`
                            : `Drive "${notification.label}" is back online`}
                    </span>
                </div>
            )}

            {/* Storage Drive Disconnected Warning (real-time via SSE) */}
            {disconnectedDrives.length > 0 && (
                <Card className="bg-yellow-500/10 border-yellow-500/30">
                    <CardContent className="py-3 flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-yellow-500">Storage Drive Disconnected</p>
                            <p className="text-sm text-yellow-500/80 mt-0.5">
                                {disconnectedDrives.length === 1
                                    ? `Drive "${disconnectedDrives[0].label}" is not currently attached. Files on this drive are temporarily unavailable.`
                                    : `${disconnectedDrives.length} drives are disconnected: ${disconnectedDrives.map(d => `"${d.label}"`).join(", ")}. Files on these drives are temporarily unavailable.`}
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
                <Card className="bg-secondary border-border">
                    <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3">
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-secondary-foreground">
                                {selectedFiles.length} item(s) selected
                            </span>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="gap-2"
                                onClick={() => {
                                    if (selectedFiles.length === filteredFiles.length) {
                                        setSelectedFiles([])
                                    } else {
                                        setSelectedFiles(filteredFiles.map(f => f.id))
                                    }
                                }}
                            >
                                <CheckSquare className="h-4 w-4" />
                                {selectedFiles.length === filteredFiles.length ? "Deselect All" : "Select All"}
                            </Button>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                            {selectedFiles.length > 0 && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="gap-2 text-destructive"
                                    onClick={handleBulkDelete}
                                >
                                    <Trash2 className="h-4 w-4" />
                                    <span className="hidden xs:inline">Delete</span>
                                </Button>
                            )}
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => { setIsSelecting(false); setSelectedFiles([]) }}
                            >
                                <X className="h-4 w-4" />
                                <span className="hidden xs:inline">Cancel</span>
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
            {(!isInsideVault || isActiveVaultUnlocked) && filteredFiles.length === 0 && !isLoading && (
                <Card className="py-12">
                    <CardContent className="flex flex-col items-center justify-center text-center">
                        <FolderOpen className="h-16 w-16 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-medium">No files yet</h3>
                        <p className="text-muted-foreground mt-1">
                            {isInsideVault
                                ? "Upload encrypted files or create encrypted folders to get started"
                                : "Upload files or create a folder to get started"}
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
            {(!isInsideVault || isActiveVaultUnlocked) && view === "grid" && filteredFiles.length > 0 && (
                <div className="grid gap-3 grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {filteredFiles.map((file) => {
                        const Icon = getFileIcon(file.type)
                        const accessible = isFileAccessible(file)
                        const previewAllowed = !isSecureItem(file) && file.type !== "folder"
                        return (
                            <ContextMenu key={file.id}>
                                <ContextMenuTrigger asChild>
                                    <Card
                                        className={cn(
                                            "group relative cursor-pointer transition-colors hover:bg-secondary",
                                            selectedFiles.includes(file.id) && "ring-2 ring-primary bg-primary/5",
                                            !accessible && "opacity-50"
                                        )}
                                        onClick={() => isSelecting ? toggleFileSelection(file.id) : (accessible ? handleFileClick(file) : null)}
                                        title={!accessible ? "Drive disconnected — file temporarily unavailable" : undefined}
                                    >
                                        <CardContent className="p-4">
                                            <div className="absolute right-2 top-2 flex items-center gap-1">
                                                {isSecureItem(file) && (
                                                    <Lock className="h-4 w-4 text-sky-400" />
                                                )}
                                                {file.starred === 1 && (
                                                    <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                                                )}
                                                {previewAllowed && (
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
                                                        >
                                                            <MoreVertical className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        {file.type === "folder" ? (
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
                                                            </>
                                                        )}
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
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                            <div
                                                className="flex flex-col items-center pt-4"
                                                onClick={() => {
                                                    if (!accessible) return
                                                    if (file.type === "folder") handleFileClick(file)
                                                    else if (previewAllowed) openPreview(file)
                                                    else handleDownload(file)
                                                }}
                                            >
                                                {(file.type === "image" || file.type === "video") && !isSecureItem(file) ? (
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
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    {formatFileSize(file.size)}
                                                </p>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </ContextMenuTrigger>
                                <ContextMenuContent className="w-48">
                                    {file.type === "folder" ? (
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
                                        </>
                                    )}
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
                            <div className="col-span-7 sm:col-span-6">Name</div>
                            <div className="col-span-2 hidden sm:block">Size</div>
                            <div className="col-span-3 hidden md:block">Modified</div>
                            <div className="col-span-1" />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {filteredFiles.map((file) => {
                            const Icon = getFileIcon(file.type)
                            const accessible = isFileAccessible(file)
                            const previewAllowed = !isSecureItem(file) && file.type !== "folder"
                            return (
                                <div
                                    key={file.id}
                                    className={cn(
                                        "flex sm:grid sm:grid-cols-12 gap-2 sm:gap-4 items-center px-4 sm:px-6 py-3 border-b border-border last:border-0 hover:bg-secondary cursor-pointer",
                                        selectedFiles.includes(file.id) && "bg-primary/10",
                                        !accessible && "opacity-50"
                                    )}
                                    onClick={() => isSelecting ? toggleFileSelection(file.id) : (accessible ? handleFileClick(file) : null)}
                                    title={!accessible ? "Drive disconnected — file temporarily unavailable" : undefined}
                                >
                                    <div
                                        className="flex-1 sm:col-span-7 md:col-span-6 flex items-center gap-3 min-w-0"
                                    >
                                        {(file.type === "image" || file.type === "video") && !isSecureItem(file) ? (
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
                                            <span className="text-sm font-medium text-card-foreground truncate block">
                                                {getDisplayName(file)}
                                            </span>
                                            <span className="text-xs text-muted-foreground sm:hidden">
                                                {formatFileSize(file.size)}
                                            </span>
                                        </div>
                                        {file.starred === 1 && (
                                            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400 flex-shrink-0" />
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
                                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <MoreVertical className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                {file.type === "folder" ? (
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
                                                    </>
                                                )}
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
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </div>
                            )
                        })}
                    </CardContent>
                </Card>
            )}

            <Dialog open={showSecureVaultDialog} onOpenChange={setShowSecureVaultDialog}>
                <DialogContent>
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
                <DialogContent>
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
                <DialogContent>
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
                <DialogContent>
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
                        setDestinationFolders([])
                        setDestinationBreadcrumbs([])
                        setDestinationFolderId(null)
                    }
                }}
            >
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            {locationMode === "move" ? <Scissors className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                            {locationMode === "move" ? "Move to..." : "Copy to..."}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="text-sm text-muted-foreground">
                            {locationMode === "move" ? "Moving" : "Copying"}{" "}
                            <span className="font-medium text-foreground">"{locationTarget ? getDisplayName(locationTarget) : ""}"</span>
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
                                    .filter((folder) => folder.id !== locationTarget?.id)
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
                    className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
                    onClick={() => closePreview()}
                    onKeyDown={(e) => e.key === 'Escape' && closePreview()}
                >
                    {/* Top bar */}
                    <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 z-10 bg-gradient-to-b from-black/60 to-transparent">
                        <div className="flex items-center gap-3 min-w-0">
                            <FileIcon className="h-5 w-5 text-white/70 shrink-0" />
                            <div className="min-w-0">
                                <p className="text-white text-sm font-medium truncate">{getDisplayName(previewFile)}</p>
                                <p className="text-white/50 text-xs">{formatFileSize(previewFile.size)}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <Button
                                variant="secondary"
                                size="sm"
                                className="gap-2"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    handleDownload(previewFile)
                                }}
                            >
                                <Download className="h-4 w-4" />
                                Download
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

                    {/* Preview content */}
                    <div className="max-w-full max-h-[85vh] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                        {previewFile.type === 'image' && (
                            <img
                                src={getPreviewUrl(previewFile.id)}
                                alt={getDisplayName(previewFile)}
                                className="max-w-full max-h-[85vh] object-contain rounded-lg"
                            />
                        )}
                        {previewFile.type === 'video' && (
                            <video
                                src={getPreviewUrl(previewFile.id)}
                                controls
                                autoPlay
                                className="w-[90vw] max-h-[85vh] rounded-lg bg-black"
                            />
                        )}
                        {previewFile.type === 'audio' && (
                            <div className="bg-card rounded-2xl p-8 flex flex-col items-center gap-6 min-w-[320px]">
                                <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center">
                                    <Music className="h-12 w-12 text-primary" />
                                </div>
                                <p className="text-card-foreground font-medium text-center">{getDisplayName(previewFile)}</p>
                                <audio
                                    src={getPreviewUrl(previewFile.id)}
                                    controls
                                    autoPlay
                                    className="w-full"
                                />
                            </div>
                        )}
                        {previewFile.mime_type?.includes('pdf') && (
                            <div className="flex flex-col items-center gap-3">
                                {pdfBlobUrl === null && (
                                    <div className="bg-card rounded-2xl p-8 flex flex-col items-center gap-4 w-[400px]">
                                        <Loader2 className="h-10 w-10 animate-spin text-primary" />
                                        <p className="text-card-foreground font-medium">Loading PDF...</p>
                                    </div>
                                )}
                                {pdfBlobUrl && pdfBlobUrl !== 'error' && (
                                    <embed
                                        src={pdfBlobUrl + '#toolbar=1&navpanes=0'}
                                        type="application/pdf"
                                        className="w-[90vw] h-[80vh] max-w-4xl rounded-lg"
                                    />
                                )}
                                {pdfBlobUrl === 'error' && (
                                    <div className="bg-card rounded-2xl p-8 flex flex-col items-center gap-4 w-[400px]">
                                        <FileIcon className="h-16 w-16 text-red-400" />
                                        <p className="text-card-foreground font-medium text-center">{getDisplayName(previewFile)}</p>
                                        <p className="text-muted-foreground text-sm text-center">
                                            Could not load PDF preview
                                        </p>
                                    </div>
                                )}
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="gap-2"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        window.open(getPreviewUrl(previewFile.id), '_blank')
                                    }}
                                >
                                    <Maximize2 className="h-4 w-4" />
                                    Open in New Tab
                                </Button>
                            </div>
                        )}
                        {previewFile.type === 'document' && !previewFile.mime_type?.includes('pdf') && (
                            <div className="bg-card rounded-xl p-6 max-w-3xl w-[90vw] max-h-[85vh] overflow-auto">
                                <pre className="text-sm text-card-foreground whitespace-pre-wrap font-mono leading-relaxed">
                                    {previewTextContent ?? 'Loading...'}
                                </pre>
                            </div>
                        )}
                        {previewFile.type === 'archive' && (
                            <div className="bg-card rounded-2xl p-8 flex flex-col items-center gap-4">
                                <Archive className="h-16 w-16 text-amber-400" />
                                <p className="text-card-foreground font-medium">{getDisplayName(previewFile)}</p>
                                <p className="text-muted-foreground text-sm">Archive files cannot be previewed</p>
                                <Button onClick={(e) => { e.stopPropagation(); handleDownload(previewFile) }} className="gap-2">
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
                }
            }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Users className="h-5 w-5" />
                            Share "{shareFile ? getDisplayName(shareFile) : ""}"
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
                                            src={getPreviewUrl(detailFile.id)}
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
                            </div>

                            {/* Metadata grid */}
                            <div className="space-y-3">
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
                                    <Calendar className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                    <div>
                                        <p className="text-xs text-muted-foreground">Created</p>
                                        <p className="text-sm text-card-foreground">
                                            {detailFile.created_at ? new Date(detailFile.created_at).toLocaleString() : "—"}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary">
                                    <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                    <div>
                                        <p className="text-xs text-muted-foreground">Modified</p>
                                        <p className="text-sm text-card-foreground">
                                            {detailFile.modified_at ? new Date(detailFile.modified_at).toLocaleString() : "—"}
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
                                    {detailFile.type !== "folder" && (
                                        <Button variant="outline" size="sm" className="gap-2" onClick={() => { handleDownload(detailFile); }}>
                                            <Download className="h-3.5 w-3.5" />
                                            Download
                                        </Button>
                                    )}
                                    <Button variant="outline" size="sm" className="gap-2" onClick={() => { setDetailFile(null); openRenameDialog(detailFile); }}>
                                        <Pencil className="h-3.5 w-3.5" />
                                        Rename
                                    </Button>
                                    <Button variant="outline" size="sm" className="gap-2" onClick={() => { setDetailFile(null); openLocationDialog(detailFile, "move"); }}>
                                        <Scissors className="h-3.5 w-3.5" />
                                        Move
                                    </Button>
                                    <Button variant="outline" size="sm" className="gap-2" onClick={() => { setDetailFile(null); openLocationDialog(detailFile, "copy"); }}>
                                        <Copy className="h-3.5 w-3.5" />
                                        Copy
                                    </Button>
                                    <Button variant="outline" size="sm" className="gap-2" onClick={() => { setDetailFile(null); handleShare(detailFile); }}>
                                        <Link2 className="h-3.5 w-3.5" />
                                        Share
                                    </Button>
                                    <Button variant="outline" size="sm" className="gap-2 text-destructive" onClick={() => { setDetailFile(null); openDeleteDialog(detailFile); }}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                        Delete
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
