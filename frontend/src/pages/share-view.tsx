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
    Lock,
} from "lucide-react"
import { cn } from "@/lib/utils"

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
    expires_at?: string | null
    allow_download?: number
}

interface PublicShareResponse {
    passwordRequired?: boolean
    file?: SharedFile
}

export function ShareViewPage() {
    const { link } = useParams<{ link: string }>()
    const [file, setFile] = useState<SharedFile | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [passwordRequired, setPasswordRequired] = useState(false)
    const [password, setPassword] = useState("")
    const [accessToken, setAccessToken] = useState<string | null>(null)
    const [isVerifying, setIsVerifying] = useState(false)

    useEffect(() => {
        if (!link) return
        fetchShareInfo()
    }, [link])

    async function fetchShareInfo(token: string | null = accessToken) {
        setIsLoading(true)
        try {
            const suffix = token ? `?access_token=${encodeURIComponent(token)}` : ""
            const res = await fetch(`${API_BASE}/shares/public/${link}${suffix}`)
            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error || "Share not found")
            }
            const data = await res.json() as PublicShareResponse
            if (data.passwordRequired) {
                setPasswordRequired(true)
                setFile(null)
            } else {
                setPasswordRequired(false)
                setFile(data.file || null)
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load shared file")
        } finally {
            setIsLoading(false)
        }
    }

    async function verifyPassword() {
        if (!link || !password.trim()) return
        setIsVerifying(true)
        setError(null)
        try {
            const res = await fetch(`${API_BASE}/shares/public/${link}/verify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Password failed")
            setAccessToken(data.accessToken)
            await fetchShareInfo(data.accessToken)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Incorrect password")
        } finally {
            setIsVerifying(false)
        }
    }

    function handleDownload() {
        const suffix = accessToken ? `?access_token=${encodeURIComponent(accessToken)}` : ""
        window.open(`${API_BASE}/shares/public/${link}/download${suffix}`, '_blank')
    }

    if (isLoading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    if (passwordRequired) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center p-4">
                <Card className="w-full max-w-md bg-card border-border">
                    <CardContent className="flex flex-col items-center py-10 text-center gap-4">
                        <div className="rounded-2xl bg-secondary p-4">
                            <Lock className="h-10 w-10 text-primary" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-card-foreground">Password Required</h2>
                            <p className="text-muted-foreground mt-2">
                                Enter the share password to continue.
                            </p>
                        </div>
                        <input
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") verifyPassword()
                            }}
                            autoFocus
                        />
                        {error && <p className="text-sm text-destructive">{error}</p>}
                        <Button className="w-full" onClick={verifyPassword} disabled={isVerifying || !password.trim()}>
                            {isVerifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Unlock
                        </Button>
                    </CardContent>
                </Card>
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
    const accessSuffix = accessToken ? `?access_token=${encodeURIComponent(accessToken)}` : ""
    const previewUrl = `${API_BASE}/shares/public/${link}/preview${accessSuffix}`
    const canDownload = file.allow_download !== 0

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
                    {canDownload ? (
                        <Button
                            className="w-full gap-2"
                            size="lg"
                            onClick={handleDownload}
                        >
                            <Download className="h-5 w-5" />
                            {file.type === "folder" ? "Download ZIP" : "Download"}
                        </Button>
                    ) : (
                        <div className="rounded-md bg-secondary px-3 py-2 text-center text-sm text-muted-foreground">
                            Downloads are disabled for this share.
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
