"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Checkbox } from "@/components/ui/checkbox"
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
  Upload,
  FolderPlus,
  Download,
  Trash2,
  Share2,
  Star,
  Search,
} from "lucide-react"
import { cn } from "@/lib/utils"

type FileItem = {
  id: string
  name: string
  type: "folder" | "document" | "image" | "video" | "audio" | "archive"
  size: string
  modified: string
  starred: boolean
}

const files: FileItem[] = [
  { id: "1", name: "Projects", type: "folder", size: "2.4 GB", modified: "2 hours ago", starred: true },
  { id: "2", name: "Documents", type: "folder", size: "856 MB", modified: "5 hours ago", starred: false },
  { id: "3", name: "Images", type: "folder", size: "1.2 GB", modified: "Yesterday", starred: true },
  { id: "4", name: "Project Proposal.pdf", type: "document", size: "2.4 MB", modified: "2 hours ago", starred: false },
  { id: "5", name: "Design Assets.zip", type: "archive", size: "156 MB", modified: "5 hours ago", starred: false },
  { id: "6", name: "Team Photo.jpg", type: "image", size: "4.2 MB", modified: "Yesterday", starred: true },
  { id: "7", name: "Product Demo.mp4", type: "video", size: "245 MB", modified: "2 days ago", starred: false },
  { id: "8", name: "Podcast Episode.mp3", type: "audio", size: "48 MB", modified: "3 days ago", starred: false },
  { id: "9", name: "Meeting Notes.docx", type: "document", size: "84 KB", modified: "4 days ago", starred: false },
  { id: "10", name: "Brand Guidelines.pdf", type: "document", size: "12 MB", modified: "5 days ago", starred: true },
]

const getFileIcon = (type: FileItem["type"]) => {
  const icons = {
    folder: Folder,
    document: FileText,
    image: ImageIcon,
    video: Video,
    audio: Music,
    archive: Archive,
  }
  return icons[type]
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
  return colors[type]
}

export function FilesContent() {
  const [view, setView] = useState<"grid" | "list">("grid")
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState("")

  const filteredFiles = files.filter((file) => file.name.toLowerCase().includes(searchQuery.toLowerCase()))

  const toggleFileSelection = (id: string) => {
    setSelectedFiles((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]))
  }

  return (
    <div className="space-y-6">
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
          <Button variant="outline" size="icon">
            <FolderPlus className="h-4 w-4" />
          </Button>
          <Button className="gap-2">
            <Upload className="h-4 w-4" />
            Upload
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
              <Button variant="outline" size="icon">
                <SortAsc className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>Name</DropdownMenuItem>
              <DropdownMenuItem>Date modified</DropdownMenuItem>
              <DropdownMenuItem>Size</DropdownMenuItem>
              <DropdownMenuItem>Type</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Selected Actions */}
      {selectedFiles.length > 0 && (
        <Card className="bg-secondary border-border">
          <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3">
            <span className="text-sm text-secondary-foreground">{selectedFiles.length} item(s) selected</span>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="ghost" size="sm" className="gap-2">
                <Download className="h-4 w-4" />
                <span className="hidden xs:inline">Download</span>
              </Button>
              <Button variant="ghost" size="sm" className="gap-2">
                <Share2 className="h-4 w-4" />
                <span className="hidden xs:inline">Share</span>
              </Button>
              <Button variant="ghost" size="sm" className="gap-2 text-destructive">
                <Trash2 className="h-4 w-4" />
                <span className="hidden xs:inline">Delete</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Files Grid/List */}
      {view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filteredFiles.map((file) => {
            const Icon = getFileIcon(file.type)
            return (
              <Card
                key={file.id}
                className={cn(
                  "group relative cursor-pointer transition-colors hover:bg-secondary",
                  selectedFiles.includes(file.id) && "ring-2 ring-primary",
                )}
              >
                <CardContent className="p-4">
                  <div className="absolute left-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Checkbox
                      checked={selectedFiles.includes(file.id)}
                      onCheckedChange={() => toggleFileSelection(file.id)}
                    />
                  </div>
                  <div className="absolute right-2 top-2 flex items-center gap-1">
                    {file.starred && <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>Open</DropdownMenuItem>
                        <DropdownMenuItem>Download</DropdownMenuItem>
                        <DropdownMenuItem>Share</DropdownMenuItem>
                        <DropdownMenuItem>Rename</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex flex-col items-center pt-4">
                    <Icon className={cn("h-12 w-12 mb-3", getFileColor(file.type))} />
                    <p className="text-sm font-medium text-card-foreground text-center truncate w-full">{file.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">{file.size}</p>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : (
        <Card className="bg-card border-border overflow-hidden">
          <CardHeader className="border-b border-border py-3 hidden sm:block">
            <div className="grid grid-cols-12 gap-4 text-xs font-medium text-muted-foreground">
              <div className="col-span-1">
                <Checkbox />
              </div>
              <div className="col-span-6 sm:col-span-5">Name</div>
              <div className="col-span-2 hidden sm:block">Size</div>
              <div className="col-span-3 hidden md:block">Modified</div>
              <div className="col-span-1" />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {filteredFiles.map((file) => {
              const Icon = getFileIcon(file.type)
              return (
                <div
                  key={file.id}
                  className={cn(
                    "flex sm:grid sm:grid-cols-12 gap-2 sm:gap-4 items-center px-4 sm:px-6 py-3 border-b border-border last:border-0 hover:bg-secondary cursor-pointer",
                    selectedFiles.includes(file.id) && "bg-secondary",
                  )}
                >
                  <div className="sm:col-span-1 flex-shrink-0">
                    <Checkbox
                      checked={selectedFiles.includes(file.id)}
                      onCheckedChange={() => toggleFileSelection(file.id)}
                    />
                  </div>
                  <div className="flex-1 sm:col-span-6 md:col-span-5 flex items-center gap-3 min-w-0">
                    <Icon className={cn("h-5 w-5 flex-shrink-0", getFileColor(file.type))} />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium text-card-foreground truncate block">{file.name}</span>
                      <span className="text-xs text-muted-foreground sm:hidden">{file.size}</span>
                    </div>
                    {file.starred && <Star className="h-4 w-4 fill-yellow-400 text-yellow-400 flex-shrink-0" />}
                  </div>
                  <div className="hidden sm:block sm:col-span-2 text-sm text-muted-foreground">{file.size}</div>
                  <div className="hidden md:block md:col-span-3 text-sm text-muted-foreground">{file.modified}</div>
                  <div className="sm:col-span-1 flex justify-end flex-shrink-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>Open</DropdownMenuItem>
                        <DropdownMenuItem>Download</DropdownMenuItem>
                        <DropdownMenuItem>Share</DropdownMenuItem>
                        <DropdownMenuItem>Rename</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
