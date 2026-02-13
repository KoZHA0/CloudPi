"use client"

import { useState, useEffect } from "react"
import { useParams } from "react-router-dom"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
    FileText,
    ImageIcon,
    Video,
    Music,
    Archive,
    Folder,
    Download,
    Loader2,
    CloudOff,
} from "lucide-react"
import { cn } from "@/lib/utils"

const API_BASE = `http://${window.location.hostname}:3001/api`

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
    if (!bytes) return "—"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

interface SharedFile {
    name: string
    type: string
    size: number
    mime_type: string
    shared_by: string
    permission: string
    created_at: string
}

export function ShareViewPage() {
    const { link } = useParams<{ link: string }>()
    const [file, setFile] = useState<SharedFile | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!link) return
        fetchShareInfo()
    }, [link])

    async function fetchShareInfo() {
        setIsLoading(true)
        try {
            const res = await fetch(`${API_BASE}/shares/public/${link}`)
            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error || "Share not found")
            }
            const data = await res.json()
            setFile(data.file)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load shared file")
        } finally {
            setIsLoading(false)
        }
    }

    function handleDownload() {
        window.open(`${API_BASE}/shares/public/${link}/download`, '_blank')
    }

    if (isLoading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    if (error || !file) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center p-4">
                <Card className="w-full max-w-md bg-card border-border">
                    <CardContent className="flex flex-col items-center py-12 text-center">
                        <CloudOff className="h-16 w-16 text-muted-foreground mb-4" />
                        <h2 className="text-xl font-bold text-card-foreground">
                            Link Not Found
                        </h2>
                        <p className="text-muted-foreground mt-2">
                            This share link doesn't exist or has been revoked.
                        </p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    const Icon = getFileIcon(file.type)
    const isImage = file.type === "image"
    const previewUrl = `${API_BASE}/shares/public/${link}/preview`

    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
            <Card className="w-full max-w-lg bg-card border-border">
                <CardContent className="p-6 space-y-6">
                    {/* Header */}
                    <div className="text-center">
                        <p className="text-sm text-muted-foreground mb-2">
                            Shared by <span className="font-medium text-card-foreground">{file.shared_by}</span>
                        </p>
                        <h1 className="text-lg font-bold text-card-foreground break-all">
                            CloudPi
                        </h1>
                    </div>

                    {/* Image preview or file icon */}
                    {isImage ? (
                        <div className="rounded-lg overflow-hidden bg-secondary">
                            <img
                                src={previewUrl}
                                alt={file.name}
                                className="w-full max-h-80 object-contain"
                            />
                        </div>
                    ) : (
                        <div className="flex justify-center py-8">
                            <div className="rounded-2xl bg-secondary p-6">
                                <Icon className={cn("h-16 w-16", getFileColor(file.type))} />
                            </div>
                        </div>
                    )}

                    {/* File info */}
                    <div className="text-center space-y-1">
                        <p className="font-medium text-card-foreground break-all">
                            {file.name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                            {formatFileSize(file.size)}
                        </p>
                    </div>

                    {/* Download button */}
                    {file.type !== "folder" && (
                        <Button
                            className="w-full gap-2"
                            size="lg"
                            onClick={handleDownload}
                        >
                            <Download className="h-5 w-5" />
                            Download
                        </Button>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
