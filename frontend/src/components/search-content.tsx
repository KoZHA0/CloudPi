"use client"

import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
    Archive,
    Download,
    ExternalLink,
    FileText,
    Folder,
    FolderOpen,
    ImageIcon,
    Loader2,
    Music,
    Search,
    Star,
    Video,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useDriveStatus } from "@/contexts/drive-status-context"
import { downloadFile, searchFiles, type SearchResult } from "@/lib/api"

type SearchTypeFilter = "all" | SearchResult["type"]
type SearchSort = "relevance" | "name" | "modified" | "size" | "type"
type SearchDirection = "asc" | "desc"

const getFileIcon = (type: SearchResult["type"]) => {
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

const getFileColor = (type: SearchResult["type"]) => {
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
    if (!bytes) return "-"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB", "TB"]
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatDate(dateString?: string): string {
    if (!dateString) return "-"
    return new Date(dateString).toLocaleDateString()
}

function bytesToMegabytes(value: string | null) {
    if (!value) return ""
    const bytes = Number(value)
    if (!Number.isFinite(bytes) || bytes <= 0) return ""
    return String(Math.round((bytes / (1024 * 1024)) * 10) / 10)
}

function megabytesToBytes(value: string) {
    const mb = Number(value)
    if (!Number.isFinite(mb) || mb <= 0) return null
    return Math.round(mb * 1024 * 1024)
}

export function SearchContent() {
    const [searchParams, setSearchParams] = useSearchParams()
    const navigate = useNavigate()
    const { isFileAccessible } = useDriveStatus()
    const query = searchParams.get("q") || ""

    const [searchInput, setSearchInput] = useState(query)
    const [results, setResults] = useState<SearchResult[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [searchedQuery, setSearchedQuery] = useState("")
    const [typeFilter, setTypeFilter] = useState<SearchTypeFilter>("all")
    const [starredOnly, setStarredOnly] = useState(false)
    const [sharedOnly, setSharedOnly] = useState(false)
    const [minSizeMb, setMinSizeMb] = useState("")
    const [maxSizeMb, setMaxSizeMb] = useState("")
    const [modifiedAfter, setModifiedAfter] = useState("")
    const [modifiedBefore, setModifiedBefore] = useState("")
    const [sortKey, setSortKey] = useState<SearchSort>("relevance")
    const [sortDirection, setSortDirection] = useState<SearchDirection>("desc")

    useEffect(() => {
        setSearchInput(query)
        const nextType = searchParams.get("type") as SearchTypeFilter | null
        setTypeFilter(nextType || "all")
        setStarredOnly(searchParams.get("starred") === "true")
        setSharedOnly(searchParams.get("shared") === "true")
        setMinSizeMb(bytesToMegabytes(searchParams.get("min_size")))
        setMaxSizeMb(bytesToMegabytes(searchParams.get("max_size")))
        setModifiedAfter(searchParams.get("modified_after") || "")
        setModifiedBefore(searchParams.get("modified_before") || "")
        setSortKey((searchParams.get("sort") as SearchSort | null) || "relevance")
        setSortDirection((searchParams.get("direction") as SearchDirection | null) || "desc")

        if (query.trim()) {
            doSearch(query.trim(), {
                type: nextType || "all",
                starred: searchParams.get("starred") === "true",
                shared: searchParams.get("shared") === "true",
                minSize: searchParams.get("min_size") ? Number(searchParams.get("min_size")) : null,
                maxSize: searchParams.get("max_size") ? Number(searchParams.get("max_size")) : null,
                modifiedAfter: searchParams.get("modified_after") || undefined,
                modifiedBefore: searchParams.get("modified_before") || undefined,
                sort: (searchParams.get("sort") as SearchSort | null) || "relevance",
                direction: (searchParams.get("direction") as SearchDirection | null) || "desc",
            })
        } else {
            setResults([])
            setSearchedQuery("")
        }
    }, [searchParams])

    async function doSearch(value: string, filters = getFiltersFromState()) {
        setIsLoading(true)
        setError(null)
        try {
            const data = await searchFiles(value, filters)
            setResults(data.files)
            setSearchedQuery(data.query)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Search failed")
            setResults([])
            setSearchedQuery(value)
        } finally {
            setIsLoading(false)
        }
    }

    function getFiltersFromState() {
        return {
            type: typeFilter,
            starred: starredOnly,
            shared: sharedOnly,
            minSize: megabytesToBytes(minSizeMb),
            maxSize: megabytesToBytes(maxSizeMb),
            modifiedAfter: modifiedAfter || undefined,
            modifiedBefore: modifiedBefore || undefined,
            sort: sortKey,
            direction: sortDirection,
        }
    }

    function buildSearchParams(value: string) {
        const params = new URLSearchParams({ q: value })
        const minSize = megabytesToBytes(minSizeMb)
        const maxSize = megabytesToBytes(maxSizeMb)

        if (typeFilter !== "all") params.set("type", typeFilter)
        if (starredOnly) params.set("starred", "true")
        if (sharedOnly) params.set("shared", "true")
        if (minSize !== null) params.set("min_size", String(minSize))
        if (maxSize !== null) params.set("max_size", String(maxSize))
        if (modifiedAfter) params.set("modified_after", modifiedAfter)
        if (modifiedBefore) params.set("modified_before", modifiedBefore)
        if (sortKey !== "relevance") params.set("sort", sortKey)
        if (sortDirection !== "desc") params.set("direction", sortDirection)

        return params
    }

    function handleSubmit(event: React.FormEvent) {
        event.preventDefault()
        const value = searchInput.trim()
        if (value) {
            setSearchParams(buildSearchParams(value))
        }
    }

    function clearFilters() {
        setTypeFilter("all")
        setStarredOnly(false)
        setSharedOnly(false)
        setMinSizeMb("")
        setMaxSizeMb("")
        setModifiedAfter("")
        setModifiedBefore("")
        setSortKey("relevance")
        setSortDirection("desc")
        const value = searchInput.trim() || query.trim()
        if (value) setSearchParams({ q: value })
    }

    function locateInFiles(file: SearchResult) {
        const params = new URLSearchParams()
        if (file.parent_id) params.set("folder", String(file.parent_id))
        params.set("highlight", String(file.id))
        navigate(`/files?${params.toString()}`)
    }

    async function handleDownload(event: React.MouseEvent, file: SearchResult) {
        event.stopPropagation()
        setError(null)
        try {
            await downloadFile(file.id, file.name)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Download failed")
        }
    }

    const folderCount = results.filter((file) => file.type === "folder").length
    const fileCount = results.length - folderCount
    const activeFilterCount = [
        typeFilter !== "all",
        starredOnly,
        sharedOnly,
        Boolean(minSizeMb),
        Boolean(maxSizeMb),
        Boolean(modifiedAfter),
        Boolean(modifiedBefore),
        sortKey !== "relevance" || sortDirection !== "desc",
    ].filter(Boolean).length
    const typeOptions: Array<{ key: SearchTypeFilter; label: string; Icon: typeof FileText }> = [
        { key: "all", label: "All", Icon: Search },
        { key: "folder", label: "Folders", Icon: Folder },
        { key: "document", label: "Docs", Icon: FileText },
        { key: "image", label: "Images", Icon: ImageIcon },
        { key: "video", label: "Videos", Icon: Video },
        { key: "audio", label: "Audio", Icon: Music },
        { key: "archive", label: "Archives", Icon: Archive },
    ]

    if (!query.trim()) {
        return (
            <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
                <Search className="mb-4 h-16 w-16 text-muted-foreground/30" />
                <h2 className="text-lg font-semibold">Search your CloudPi</h2>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                    Find files and folders by name, then locate them in Files with the yellow highlight.
                </p>
                <form onSubmit={handleSubmit} className="mt-6 flex w-full max-w-xl flex-col gap-2 sm:flex-row">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={searchInput}
                            onChange={(event) => setSearchInput(event.target.value)}
                            placeholder="Search files and folders..."
                            className="pl-9"
                        />
                    </div>
                    <Button type="submit" className="gap-2">
                        <Search className="h-4 w-4" />
                        Search
                    </Button>
                </form>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
                        <Search className="h-5 w-5 text-primary sm:h-6 sm:w-6" />
                        Search
                    </h1>
                    <p className="text-xs text-muted-foreground sm:text-sm">
                        Locate matching items across your files
                    </p>
                </div>
                {results.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">{results.length} result{results.length === 1 ? "" : "s"}</Badge>
                        <Badge variant="outline">{folderCount} folder{folderCount === 1 ? "" : "s"}</Badge>
                        <Badge variant="outline">{fileCount} file{fileCount === 1 ? "" : "s"}</Badge>
                    </div>
                )}
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-2 md:flex-row md:items-center">
                <div className="relative max-w-2xl flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={searchInput}
                        onChange={(event) => setSearchInput(event.target.value)}
                        placeholder="Search files and folders..."
                        className="pl-9"
                    />
                </div>
                <Button type="submit" className="gap-2 md:w-auto">
                    <Search className="h-4 w-4" />
                    Search
                </Button>
            </form>

            <Card className="border-border bg-card">
                <CardContent className="space-y-4 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <p className="text-sm font-medium">Filters</p>
                            <p className="text-xs text-muted-foreground">
                                Narrow search by type, status, size, and modified date
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {activeFilterCount > 0 && (
                                <Badge variant="secondary">{activeFilterCount} active</Badge>
                            )}
                            <Button variant="outline" size="sm" onClick={clearFilters} disabled={activeFilterCount === 0}>
                                Clear filters
                            </Button>
                        </div>
                    </div>

                    <div className="flex gap-2 overflow-x-auto pb-1">
                        {typeOptions.map(({ key, label, Icon }) => (
                            <Button
                                key={key}
                                type="button"
                                variant={typeFilter === key ? "default" : "outline"}
                                size="sm"
                                className="h-8 shrink-0 gap-1.5 rounded-full text-xs"
                                onClick={() => setTypeFilter(key)}
                            >
                                <Icon className="h-3.5 w-3.5" />
                                {label}
                            </Button>
                        ))}
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <div className="space-y-2 rounded-lg border border-border p-3">
                            <Label className="text-xs text-muted-foreground">Status</Label>
                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-sm">Starred only</span>
                                    <Switch checked={starredOnly} onCheckedChange={setStarredOnly} />
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-sm">Shared only</span>
                                    <Switch checked={sharedOnly} onCheckedChange={setSharedOnly} />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2 rounded-lg border border-border p-3">
                            <Label className="text-xs text-muted-foreground">Size (MB)</Label>
                            <div className="grid grid-cols-2 gap-2">
                                <Input
                                    type="number"
                                    min="0"
                                    inputMode="decimal"
                                    placeholder="Min"
                                    value={minSizeMb}
                                    onChange={(event) => setMinSizeMb(event.target.value)}
                                />
                                <Input
                                    type="number"
                                    min="0"
                                    inputMode="decimal"
                                    placeholder="Max"
                                    value={maxSizeMb}
                                    onChange={(event) => setMaxSizeMb(event.target.value)}
                                />
                            </div>
                        </div>

                        <div className="space-y-2 rounded-lg border border-border p-3">
                            <Label className="text-xs text-muted-foreground">Modified date</Label>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-1">
                                <Input
                                    type="date"
                                    value={modifiedAfter}
                                    onChange={(event) => setModifiedAfter(event.target.value)}
                                />
                                <Input
                                    type="date"
                                    value={modifiedBefore}
                                    onChange={(event) => setModifiedBefore(event.target.value)}
                                />
                            </div>
                        </div>

                        <div className="space-y-2 rounded-lg border border-border p-3">
                            <Label className="text-xs text-muted-foreground">Sort</Label>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-1">
                                <Select value={sortKey} onValueChange={(value) => setSortKey(value as SearchSort)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="relevance">Relevance</SelectItem>
                                        <SelectItem value="name">Name</SelectItem>
                                        <SelectItem value="modified">Modified</SelectItem>
                                        <SelectItem value="size">Size</SelectItem>
                                        <SelectItem value="type">Type</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Select value={sortDirection} onValueChange={(value) => setSortDirection(value as SearchDirection)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="desc">Descending</SelectItem>
                                        <SelectItem value="asc">Ascending</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {error && (
                <Card className="border-destructive bg-destructive/10">
                    <CardContent className="py-3">
                        <p className="text-sm text-destructive">{error}</p>
                    </CardContent>
                </Card>
            )}

            {isLoading ? (
                <div className="flex h-64 items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            ) : results.length === 0 ? (
                <Card className="border-border bg-card py-12">
                    <CardContent className="flex flex-col items-center justify-center text-center">
                        <Search className="mb-4 h-12 w-12 text-muted-foreground/40" />
                        <h3 className="text-lg font-medium">No results for "{searchedQuery}"</h3>
                        <p className="mt-1 text-sm text-muted-foreground">Try a shorter name or a different word.</p>
                    </CardContent>
                </Card>
            ) : (
                <Card className="overflow-hidden border-border bg-card">
                    <CardHeader className="hidden border-b border-border py-3 sm:block">
                        <div className="grid grid-cols-12 gap-4 text-xs font-medium text-muted-foreground">
                            <div className="col-span-5">Name</div>
                            <div className="col-span-3 hidden md:block">Location</div>
                            <div className="col-span-2 hidden sm:block">Modified</div>
                            <div className="col-span-2" />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {results.map((file) => {
                            const Icon = getFileIcon(file.type)
                            const accessible = isFileAccessible(file)
                            return (
                                <div
                                    key={file.id}
                                    className={cn(
                                        "flex cursor-pointer items-center gap-2 border-b border-border px-4 py-3 last:border-0 hover:bg-secondary sm:grid sm:grid-cols-12 sm:gap-4 sm:px-6",
                                        !accessible && "opacity-50"
                                    )}
                                    onClick={() => locateInFiles(file)}
                                    title={!accessible ? "Drive disconnected - file temporarily unavailable" : file.name}
                                >
                                    <div className="flex min-w-0 flex-1 items-center gap-3 sm:col-span-5">
                                        <Icon className={cn("h-5 w-5 flex-shrink-0", getFileColor(file.type))} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex min-w-0 items-center gap-2">
                                                <span className="truncate text-sm font-medium text-card-foreground">
                                                    {file.name}
                                                </span>
                                                {file.starred === 1 && (
                                                    <Star className="h-4 w-4 flex-shrink-0 fill-yellow-400 text-yellow-400" />
                                                )}
                                                {Number(file.shared_count || 0) > 0 && (
                                                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                                        Shared
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:hidden">
                                                <span className="inline-flex items-center gap-1">
                                                    <FolderOpen className="h-3 w-3" />
                                                    {file.location || "My Files"}
                                                </span>
                                                <span>{file.type === "folder" ? "Folder" : formatFileSize(file.size)}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="hidden min-w-0 md:col-span-3 md:block">
                                        <p className="truncate text-sm text-muted-foreground">{file.location || "My Files"}</p>
                                    </div>
                                    <div className="hidden text-sm text-muted-foreground sm:col-span-2 sm:block">
                                        {formatDate(file.modified_at)}
                                    </div>
                                    <div className="flex flex-shrink-0 justify-end gap-1 sm:col-span-2">
                                        {file.type !== "folder" && (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="gap-2"
                                                disabled={!accessible}
                                                onClick={(event) => handleDownload(event, file)}
                                            >
                                                <Download className="h-4 w-4" />
                                                <span className="hidden md:inline">Download</span>
                                            </Button>
                                        )}
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8"
                                            onClick={(event) => {
                                                event.stopPropagation()
                                                locateInFiles(file)
                                            }}
                                            title="Locate in Files"
                                        >
                                            <ExternalLink className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            )
                        })}
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
