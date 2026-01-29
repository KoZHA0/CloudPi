"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { FileText, ImageIcon, Video, Archive, MoreVertical, Clock } from "lucide-react"
import { cn } from "@/lib/utils"

const recentActivity = [
  {
    date: "Today",
    items: [
      { id: "1", name: "Project Proposal.pdf", type: "document", size: "2.4 MB", time: "2 hours ago" },
      { id: "2", name: "Design Assets.zip", type: "archive", size: "156 MB", time: "5 hours ago" },
    ],
  },
  {
    date: "Yesterday",
    items: [
      { id: "3", name: "Team Photo.jpg", type: "image", size: "4.2 MB", time: "Yesterday at 3:45 PM" },
      { id: "4", name: "Meeting Notes.docx", type: "document", size: "84 KB", time: "Yesterday at 11:20 AM" },
    ],
  },
  {
    date: "This Week",
    items: [
      { id: "5", name: "Product Demo.mp4", type: "video", size: "245 MB", time: "3 days ago" },
      { id: "6", name: "Brand Guidelines.pdf", type: "document", size: "12 MB", time: "5 days ago" },
    ],
  },
]

const getIcon = (type: string) => {
  const icons: Record<string, typeof FileText> = {
    document: FileText,
    image: ImageIcon,
    video: Video,
    archive: Archive,
  }
  return icons[type] || FileText
}

const getColor = (type: string) => {
  const colors: Record<string, string> = {
    document: "text-red-400",
    image: "text-green-400",
    video: "text-purple-400",
    archive: "text-orange-400",
  }
  return colors[type] || "text-muted-foreground"
}

export function RecentContent() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Recent</h1>
        <p className="text-muted-foreground">Files you've recently accessed</p>
      </div>

      {recentActivity.map((group) => (
        <div key={group.date} className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Clock className="h-4 w-4" />
            {group.date}
          </h2>
          <Card className="bg-card border-border">
            <CardContent className="p-0">
              {group.items.map((item, index) => {
                const Icon = getIcon(item.type)
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-center justify-between p-4 hover:bg-secondary cursor-pointer transition-colors",
                      index < group.items.length - 1 && "border-b border-border",
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className="rounded-lg bg-secondary p-2">
                        <Icon className={cn("h-5 w-5", getColor(item.type))} />
                      </div>
                      <div>
                        <p className="font-medium text-card-foreground">{item.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {item.size} · {item.time}
                        </p>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>Open</DropdownMenuItem>
                        <DropdownMenuItem>Download</DropdownMenuItem>
                        <DropdownMenuItem>Share</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  )
}
