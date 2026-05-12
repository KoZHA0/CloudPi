"use client"

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react"
import { uploadFiles as apiUploadFiles } from "@/lib/api"

export type UploadStatus = "pending" | "uploading" | "done" | "error" | "cancelled"

export interface UploadEntry {
    id: string
    fileName: string
    fileSize: number
    status: UploadStatus
    progress: number
    error?: string
    folderId: number | null
    uploadedBytes: number
    speedBps?: number
    etaSeconds?: number
    startedAt?: number
    finishedAt?: number
}

export type UploadProgressCallback = (uploadedBytes: number, totalBytes: number) => void
export type UploadExecutor = (
    files: File[],
    folderId: number | null,
    onProgress: UploadProgressCallback,
    signal?: AbortSignal
) => Promise<void>
type CloudPiUploadFile = File & { cloudpiRelativePath?: string; webkitRelativePath?: string }

interface UploadContextType {
    uploads: UploadEntry[]
    isMinimized: boolean
    setIsMinimized: (v: boolean) => void
    addUpload: (files: File[], folderId: number | null, onComplete?: () => void, executor?: UploadExecutor) => void
    retryUpload: (id: string) => void
    cancelUpload: (id: string) => void
    cancelAll: () => void
    removeUpload: (id: string) => void
    clearCompleted: () => void
    totalActive: number
}

interface UploadJob {
    files: File[]
    folderId: number | null
    onComplete?: () => void
    executor?: UploadExecutor
    controller?: AbortController
    progressInterval?: number | null
}

const UploadContext = createContext<UploadContextType | undefined>(undefined)

export function useUpload() {
    const ctx = useContext(UploadContext)
    if (!ctx) throw new Error("useUpload must be used within UploadProvider")
    return ctx
}

function getUploadLabel(files: File[]) {
    if (files.length === 1) return files[0].name

    const firstRelativePath = (files[0] as CloudPiUploadFile).cloudpiRelativePath || (files[0] as CloudPiUploadFile).webkitRelativePath
    const rootFolder = firstRelativePath?.split(/[\\/]/).filter(Boolean)[0]
    if (rootFolder && files.every(file => {
        const relativePath = (file as CloudPiUploadFile).cloudpiRelativePath || (file as CloudPiUploadFile).webkitRelativePath
        return relativePath?.split(/[\\/]/).filter(Boolean)[0] === rootFolder
    })) {
        return `${rootFolder} (${files.length} files)`
    }

    return `${files.length} files`
}

function isAbortError(err: unknown) {
    return err instanceof DOMException && err.name === "AbortError"
}

export function UploadProvider({ children }: { children: ReactNode }) {
    const [uploads, setUploads] = useState<UploadEntry[]>([])
    const [isMinimized, setIsMinimized] = useState(false)
    const idCounter = useRef(0)
    const jobs = useRef<Record<string, UploadJob>>({})

    const totalActive = uploads.filter(u => u.status === "pending" || u.status === "uploading").length

    const finishInterval = useCallback((id: string) => {
        const job = jobs.current[id]
        if (job?.progressInterval !== null && job?.progressInterval !== undefined) {
            window.clearInterval(job.progressInterval)
            job.progressInterval = null
        }
    }, [])

    const runUpload = useCallback((id: string) => {
        const job = jobs.current[id]
        if (!job) return

        const controller = new AbortController()
        const startedAt = Date.now()
        let lastUploadedBytes = 0
        let lastProgressAt = startedAt
        job.controller = controller

        setUploads(prev => prev.map(upload =>
            upload.id === id
                ? {
                    ...upload,
                    status: "uploading",
                    progress: 0,
                    uploadedBytes: 0,
                    speedBps: undefined,
                    etaSeconds: undefined,
                    error: undefined,
                    startedAt,
                    finishedAt: undefined,
                }
                : upload
        ))

        if (!job.executor) {
            let progressVal = 0
            job.progressInterval = window.setInterval(() => {
                progressVal = Math.min(progressVal + Math.random() * 10, 92)
                setUploads(prev =>
                    prev.map(upload => upload.id === id ? { ...upload, progress: progressVal } : upload)
                )
            }, 400)
        }

        const updateProgress: UploadProgressCallback = (uploadedBytes, totalBytes) => {
            const now = Date.now()
            const elapsedSeconds = Math.max(0.25, (now - lastProgressAt) / 1000)
            const deltaBytes = Math.max(0, uploadedBytes - lastUploadedBytes)
            const speedBps = deltaBytes / elapsedSeconds
            const remainingBytes = Math.max(0, totalBytes - uploadedBytes)
            const etaSeconds = speedBps > 0 ? remainingBytes / speedBps : undefined
            const ratio = totalBytes > 0 ? (uploadedBytes / totalBytes) * 100 : 0

            lastUploadedBytes = uploadedBytes
            lastProgressAt = now

            setUploads(prev =>
                prev.map(upload => upload.id === id
                    ? {
                        ...upload,
                        uploadedBytes,
                        progress: Math.max(0, Math.min(100, ratio)),
                        speedBps,
                        etaSeconds,
                    }
                    : upload)
            )
        }

        const uploadPromise = job.executor
            ? job.executor(job.files, job.folderId, updateProgress, controller.signal)
            : apiUploadFiles(job.files, job.folderId, controller.signal).then(() => undefined)

        uploadPromise
            .then(() => {
                finishInterval(id)
                setUploads(prev =>
                    prev.map(upload => upload.id === id
                        ? {
                            ...upload,
                            status: "done",
                            progress: 100,
                            uploadedBytes: upload.fileSize,
                            speedBps: undefined,
                            etaSeconds: undefined,
                            finishedAt: Date.now(),
                        }
                        : upload)
                )
                job.onComplete?.()
            })
            .catch(err => {
                finishInterval(id)
                const cancelled = controller.signal.aborted || isAbortError(err)
                setUploads(prev =>
                    prev.map(upload => upload.id === id
                        ? {
                            ...upload,
                            status: cancelled ? "cancelled" : "error",
                            progress: cancelled ? upload.progress : 0,
                            speedBps: undefined,
                            etaSeconds: undefined,
                            error: cancelled ? undefined : err instanceof Error ? err.message : "Upload failed",
                            finishedAt: Date.now(),
                        }
                        : upload)
                )
            })
    }, [finishInterval])

    const addUpload = useCallback((files: File[], folderId: number | null, onComplete?: () => void, executor?: UploadExecutor) => {
        if (files.length === 0) return

        const batchId = `upload-${Date.now()}-${++idCounter.current}`
        const totalSize = files.reduce((sum, f) => sum + f.size, 0)

        jobs.current[batchId] = {
            files,
            folderId,
            onComplete,
            executor,
            progressInterval: null,
        }

        const entry: UploadEntry = {
            id: batchId,
            fileName: getUploadLabel(files),
            fileSize: totalSize,
            status: "pending",
            progress: 0,
            folderId,
            uploadedBytes: 0,
        }

        setUploads(prev => [entry, ...prev])
        setIsMinimized(false)
        queueMicrotask(() => runUpload(batchId))
    }, [runUpload])

    const retryUpload = useCallback((id: string) => {
        const job = jobs.current[id]
        if (!job) return
        finishInterval(id)
        runUpload(id)
    }, [finishInterval, runUpload])

    const cancelUpload = useCallback((id: string) => {
        const job = jobs.current[id]
        if (!job) return
        job.controller?.abort()
        finishInterval(id)
        setUploads(prev =>
            prev.map(upload => upload.id === id && (upload.status === "pending" || upload.status === "uploading")
                ? {
                    ...upload,
                    status: "cancelled",
                    speedBps: undefined,
                    etaSeconds: undefined,
                    finishedAt: Date.now(),
                }
                : upload)
        )
    }, [finishInterval])

    const cancelAll = useCallback(() => {
        Object.keys(jobs.current).forEach((id) => cancelUpload(id))
    }, [cancelUpload])

    const removeUpload = useCallback((id: string) => {
        const entry = uploads.find(upload => upload.id === id)
        if (entry?.status === "pending" || entry?.status === "uploading") {
            cancelUpload(id)
        }
        finishInterval(id)
        delete jobs.current[id]
        setUploads(prev => prev.filter(upload => upload.id !== id))
    }, [cancelUpload, finishInterval, uploads])

    const clearCompleted = useCallback(() => {
        setUploads(prev => {
            const active = prev.filter(upload => upload.status === "uploading" || upload.status === "pending")
            const activeIds = new Set(active.map(upload => upload.id))
            Object.keys(jobs.current).forEach((id) => {
                if (!activeIds.has(id)) {
                    finishInterval(id)
                    delete jobs.current[id]
                }
            })
            return active
        })
    }, [finishInterval])

    return (
        <UploadContext.Provider value={{
            uploads,
            isMinimized,
            setIsMinimized,
            addUpload,
            retryUpload,
            cancelUpload,
            cancelAll,
            removeUpload,
            clearCompleted,
            totalActive,
        }}>
            {children}
        </UploadContext.Provider>
    )
}
