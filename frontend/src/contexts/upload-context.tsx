"use client"

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react"
import { uploadFiles as apiUploadFiles } from "@/lib/api"

// ─── Types ────────────────────────────────────────────────────────────
export type UploadStatus = "pending" | "uploading" | "done" | "error"

export interface UploadEntry {
    id: string
    fileName: string
    fileSize: number
    status: UploadStatus
    progress: number
    error?: string
    folderId: number | null
}

interface UploadContextType {
    uploads: UploadEntry[]
    isMinimized: boolean
    setIsMinimized: (v: boolean) => void
    addUpload: (files: File[], folderId: number | null, onComplete?: () => void) => void
    clearCompleted: () => void
    totalActive: number
}

const UploadContext = createContext<UploadContextType | undefined>(undefined)

export function useUpload() {
    const ctx = useContext(UploadContext)
    if (!ctx) throw new Error("useUpload must be used within UploadProvider")
    return ctx
}

// ─── Provider ─────────────────────────────────────────────────────────
export function UploadProvider({ children }: { children: ReactNode }) {
    const [uploads, setUploads] = useState<UploadEntry[]>([])
    const [isMinimized, setIsMinimized] = useState(false)
    const idCounter = useRef(0)

    const totalActive = uploads.filter(u => u.status === "pending" || u.status === "uploading").length

    const addUpload = useCallback((files: File[], folderId: number | null, onComplete?: () => void) => {
        // Create one entry per batch (since the API sends all files together)
        const batchId = `upload-${Date.now()}-${++idCounter.current}`
        const totalSize = files.reduce((sum, f) => sum + f.size, 0)
        const fileNames = files.map(f => f.name)

        const entry: UploadEntry = {
            id: batchId,
            fileName: files.length === 1 ? fileNames[0] : `${files.length} files`,
            fileSize: totalSize,
            status: "uploading",
            progress: 0,
            folderId,
        }

        setUploads(prev => [entry, ...prev])

        // Simulate progress while uploading
        let progressVal = 0
        const progressInterval = setInterval(() => {
            progressVal = Math.min(progressVal + Math.random() * 15, 90)
            setUploads(prev =>
                prev.map(u => u.id === batchId ? { ...u, progress: progressVal } : u)
            )
        }, 300)

        // Fire the actual upload
        apiUploadFiles(files, folderId)
            .then(() => {
                clearInterval(progressInterval)
                setUploads(prev =>
                    prev.map(u => u.id === batchId ? { ...u, status: "done", progress: 100 } : u)
                )
                onComplete?.()
            })
            .catch(err => {
                clearInterval(progressInterval)
                setUploads(prev =>
                    prev.map(u => u.id === batchId ? {
                        ...u,
                        status: "error",
                        progress: 0,
                        error: err instanceof Error ? err.message : "Upload failed"
                    } : u)
                )
            })
    }, [])

    const clearCompleted = useCallback(() => {
        setUploads(prev => prev.filter(u => u.status === "uploading" || u.status === "pending"))
    }, [])

    return (
        <UploadContext.Provider value={{ uploads, isMinimized, setIsMinimized, addUpload, clearCompleted, totalActive }}>
            {children}
        </UploadContext.Provider>
    )
}
