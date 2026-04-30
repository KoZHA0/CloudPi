"use client"

import { useState, useEffect } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Folder,
    FileText,
    ImageIcon,
    Video,
    Music,
    Archive,
    Search,
    Loader2,
    FolderOpen,
    ArrowRight,
} from "lucide-react"
import { searchFiles, downloadFile, type SearchResult } from "@/lib/api"

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

export function SearchContent() {
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()
    const query = searchParams.get("q") || ""

    const [results, setResults] = useState<SearchResult[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [searchedQuery, setSearchedQuery] = useState("")

    useEffect(() => {
        if (query.trim()) {
            doSearch(query.trim())
        }
    }, [query])

    async function doSearch(q: string) {
        setIsLoading(true)
        try {
            const data = await searchFiles(q)
            setResults(data.files)
            setSearchedQuery(data.query)
        } catch (err) {
            console.error("Search error:", err)
        } finally {
            setIsLoading(false)
        }
    }

    const handleClick = (file: SearchResult) => {
        if (file.type === "folder") {
            navigate(`/files?folder=${file.id}`)
        } else {
            // Navigate to the parent folder so they can see the file in context
            if (file.parent_id) {
                navigate(`/files?folder=${file.parent_id}`)
            } else {
                navigate("/files")
            }
        }
    }

    const handleDownload = (e: React.MouseEvent, file: SearchResult) => {
        e.stopPropagation()
        downloadFile(file.id, file.name)
    }

    if (!query.trim()) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] text-muted-foreground">
                <Search className="h-16 w-16 mb-4 opacity-30" />
                <p className="text-lg font-medium">Search your CloudPi</p>
                <p className="text-sm mt-1">Use the search bar in the sidebar to find files and folders</p>
            </div>
        )
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Search header */}
            <div className="flex items-center gap-3">
                <Search className="h-5 w-5 text-muted-foreground" />
                <div>
                    <h2 className="text-lg font-semibold">
                        {results.length} result{results.length !== 1 ? "s" : ""} for "{searchedQuery}"
                    </h2>
                    <p className="text-sm text-muted-foreground">Searched across all your files and folders</p>
                </div>
            </div>

            {/* Results */}
            {results.length === 0 ? (
                <Card className="bg-card border-border">
                    <CardContent className="flex flex-col items-center justify-center py-16">
                        <Search className="h-12 w-12 text-muted-foreground/30 mb-4" />
                        <p className="text-muted-foreground">No files or folders matching "{searchedQuery}"</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-2">
                    {results.map((file) => {
                        const Icon = getFileIcon(file.type)
                        const color = getFileColor(file.type)

                        return (
                            <Card
                                key={file.id}
                                className="bg-card border-border hover:bg-secondary/50 transition-colors cursor-pointer"
                                onClick={() => handleClick(file)}
                            >
                                <CardContent className="flex items-center gap-4 p-4">
                                    <div className={`p-2 rounded-lg bg-secondary ${color}`}>
                                        <Icon className="h-5 w-5" />
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-sm truncate">{file.name}</p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <Badge variant="outline" className="text-xs">
                                                <FolderOpen className="h-3 w-3 mr-1" />
                                                {file.location}
                                            </Badge>
                                            {file.type !== "folder" && (
                                                <span className="text-xs text-muted-foreground">
                                                    {formatFileSize(file.size)}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        {file.type !== "folder" && (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="text-xs gap-1"
                                                onClick={(e) => handleDownload(e, file)}
                                            >
                                                Download
                                            </Button>
                                        )}
                                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
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
