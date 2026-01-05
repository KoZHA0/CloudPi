"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { FileText, ImageIcon, Folder, MoreVertical, Trash2, RotateCcw, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

const trashedItems = [
  { id: "1", name: "Old Project", type: "folder", size: "1.2 GB", deletedAt: "2 days ago", expiresIn: "28 days" },
  {
    id: "2",
    name: "Draft Document.docx",
    type: "document",
    size: "245 KB",
    deletedAt: "5 days ago",
    expiresIn: "25 days",
  },
  { id: "3", name: "Screenshot.png", type: "image", size: "2.1 MB", deletedAt: "1 week ago", expiresIn: "23 days" },
]

const getIcon = (type: string) => {
  const icons: Record<string, typeof FileText> = {
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

export function TrashContent() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Trash</h1>
          <p className="text-muted-foreground">Items in trash will be permanently deleted after 30 days</p>
        </div>
        <Button variant="destructive" className="gap-2">
          <Trash2 className="h-4 w-4" />
          Empty Trash
        </Button>
      </div>

      <Alert className="border-yellow-500/50 bg-yellow-500/10">
        <AlertTriangle className="h-4 w-4 text-yellow-500" />
        <AlertTitle className="text-yellow-500">Automatic deletion</AlertTitle>
        <AlertDescription className="text-yellow-500/80">
          Items in trash are automatically permanently deleted after 30 days.
        </AlertDescription>
      </Alert>

      <Card className="bg-card border-border">
        <CardContent className="p-0">
          {trashedItems.map((item, index) => {
            const Icon = getIcon(item.type)
            return (
              <div
                key={item.id}
                className={cn(
                  "flex items-center justify-between p-4 hover:bg-secondary transition-colors",
                  index < trashedItems.length - 1 && "border-b border-border",
                )}
              >
                <div className="flex items-center gap-4">
                  <div className="rounded-lg bg-secondary p-2 opacity-50">
                    <Icon className={cn("h-5 w-5", getColor(item.type))} />
                  </div>
                  <div>
                    <p className="font-medium text-card-foreground/70">{item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.size} · Deleted {item.deletedAt} · Expires in {item.expiresIn}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="gap-2">
                    <RotateCcw className="h-4 w-4" />
                    Restore
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>Restore</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive">Delete Permanently</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
