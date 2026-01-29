"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Folder, FileText, ImageIcon, Star, MoreVertical } from "lucide-react"
import { cn } from "@/lib/utils"

const starredItems = [
  { id: "1", name: "Projects", type: "folder", size: "2.4 GB", modified: "2 hours ago" },
  { id: "2", name: "Images", type: "folder", size: "1.2 GB", modified: "Yesterday" },
  { id: "3", name: "Team Photo.jpg", type: "image", size: "4.2 MB", modified: "Yesterday" },
  { id: "4", name: "Brand Guidelines.pdf", type: "document", size: "12 MB", modified: "5 days ago" },
]

const getIcon = (type: string) => {
  const icons: Record<string, typeof Folder> = {
    folder: Folder,
    document: FileText,
    image: ImageIcon,
  }
  return icons[type] || FileText
}

const getColor = (type: string) => {
  const colors: Record<string, string> = {
    folder: "text-blue-400",
    document: "text-red-400",
    image: "text-green-400",
  }
  return colors[type] || "text-muted-foreground"
}

export function StarredContent() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Starred</h1>
        <p className="text-muted-foreground">Your favorite files and folders</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {starredItems.map((item) => {
          const Icon = getIcon(item.type)
          return (
            <Card
              key={item.id}
              className="group bg-card border-border hover:bg-secondary transition-colors cursor-pointer"
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-4">
                  <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>Open</DropdownMenuItem>
                      <DropdownMenuItem>Download</DropdownMenuItem>
                      <DropdownMenuItem>Remove from Starred</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex flex-col items-center">
                  <Icon className={cn("h-12 w-12 mb-3", getColor(item.type))} />
                  <p className="text-sm font-medium text-card-foreground text-center truncate w-full">{item.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">{item.size}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
